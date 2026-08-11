import type { AlignedDataset } from '../data/datasetTypes'
import { computeQuantileSeries, QUANTILE_VERSION } from '../math/quantiles'
import {
  allocateInitialInvestment,
  stepPortfolioPeriod,
} from '../portfolio/cashFlows'
import type { ValidationResult } from '../validation'
import type { SimulationEngine } from './simulationEngine'
import type {
  PeriodScenario,
  RetainedPath,
  SimulationConfig,
  SimulationFailure,
  SimulationResult,
} from './simulationTypes'
import { validateSimulationConfig } from './simulationTypes'

// Always retain the first N paths by index. Every path is an equally valid,
// independent draw, so a fixed prefix is not a biased sample, and it is
// trivially deterministic to test — unlike a random or percentile-based pick.
export const RETAINED_PATH_COUNT = 50

export type RunSimulationInput = {
  // Already constructed by the caller (e.g. createHistoricalBootstrapEngine).
  // runSimulation never builds an engine itself, so it works unchanged for any
  // future engine that implements the same SimulationEngine contract.
  readonly engine: SimulationEngine
  // Only dataset.assetIds.length and dataset.identity are read here. Asset
  // returns are reached exclusively through the engine's scenarios.
  readonly dataset: AlignedDataset
  readonly config: SimulationConfig
  // The caller knows which engine and PRNG produced the scenarios; this file
  // only knows its own quantile rule.
  readonly modelVersion: string
  readonly prngVersion: string
  // Optional progress cadence for a Worker host (Phase 2). Defaults to one
  // implicit batch covering the whole run, so every call site that omits
  // these two fields keeps its exact pre-Phase-2 behavior unchanged.
  readonly batchSize?: number
  readonly onBatchComplete?: (
    pathsCompleted: number,
    totalPaths: number,
  ) => void
}

export function runSimulation(
  input: RunSimulationInput,
): ValidationResult<SimulationResult> {
  const { engine, dataset, config } = input

  const configResult = validateSimulationConfig(
    config,
    dataset.assetIds.length,
    dataset.identity.frequency,
  )
  if (!configResult.ok) {
    return configResult
  }

  const { weights, initialInvestment, cashFlow, paths, periods } = config
  const periodCount = periods + 1
  const batchSize = input.batchSize ?? paths

  // One flat typed array instead of nested arrays: paths * periods is already
  // capped at 10,000,000 by validateSimulationConfig, so this stays bounded
  // and avoids the per-number boxing overhead of a plain number[][].
  const equityByPeriod = new Float64Array(periodCount * paths)
  const terminalWealth = new Float64Array(paths)
  const failures: SimulationFailure[] = []
  const retainedPaths: RetainedPath[] = []
  const retainedCount = Math.min(RETAINED_PATH_COUNT, paths)

  // Time complexity: O(N * T) — one engine draw and one accounting step per
  // path per period, matching the N (paths) * T (periods) work budget already
  // enforced by validateSimulationConfig. Space complexity: O(N * T) for the
  // flat equityByPeriod buffer below, plus O(T) per retained path.
  //
  // onBatchComplete is a pure notification hook layered on this single pass —
  // it never restarts the engine's PRNG stream or re-derives a scenario, so a
  // batched Worker run and an unbatched direct call draw an identical
  // sequence for the same seed. Batching only changes how often progress is
  // reported, never what is computed.
  for (let pathIndex = 0; pathIndex < paths; pathIndex += 1) {
    const isRetained = pathIndex < retainedCount
    const retainedValues = isRetained ? new Float64Array(periodCount) : null
    const retainedScenarios: PeriodScenario[] | null = isRetained ? [] : null

    let holdings: readonly number[] = allocateInitialInvestment(
      initialInvestment,
      weights,
    )
    let equity = sum(holdings)
    equityByPeriod[pathIndex] = equity
    retainedValues?.set([equity], 0)

    let failedAtPeriod = -1

    for (let periodIndex = 1; periodIndex <= periods; periodIndex += 1) {
      const scenario = engine.nextScenario()
      const result = stepPortfolioPeriod(
        holdings,
        scenario,
        cashFlow,
        weights,
        periodIndex,
        initialInvestment,
      )

      if (!Number.isFinite(result.equity)) {
        failures.push({
          pathIndex,
          periodIndex,
          code: 'non-finite-equity',
          message: 'Portfolio equity became non-finite during accounting.',
        })
        failedAtPeriod = periodIndex
        break
      }

      holdings = result.holdings
      equity = result.equity
      equityByPeriod[periodIndex * paths + pathIndex] = equity
      retainedValues?.set([equity], periodIndex)
      retainedScenarios?.push(scenario)
    }

    const failed = failedAtPeriod !== -1

    if (failed) {
      // Every never-written period from the failure onward defaults to 0 in the
      // typed array. Overwrite with NaN so quantile computation can tell "this
      // path failed here" from "this path was legitimately worth $0 here".
      for (
        let periodIndex = failedAtPeriod;
        periodIndex <= periods;
        periodIndex += 1
      ) {
        equityByPeriod[periodIndex * paths + pathIndex] = NaN
        retainedValues?.set([NaN], periodIndex)
      }
    }

    terminalWealth[pathIndex] = failed ? NaN : equity

    if (isRetained && retainedValues && retainedScenarios) {
      retainedPaths.push({
        pathIndex,
        values: retainedValues,
        scenarios: retainedScenarios,
      })
    }

    const pathsCompleted = pathIndex + 1
    const isBatchBoundary = pathsCompleted % batchSize === 0
    const isLastPath = pathsCompleted === paths
    if (isBatchBoundary || isLastPath) {
      input.onBatchComplete?.(pathsCompleted, paths)
    }
  }

  const periodSamples: number[][] = []
  for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
    const sample = new Array<number>(paths)
    for (let pathIndex = 0; pathIndex < paths; pathIndex += 1) {
      sample[pathIndex] = equityByPeriod[periodIndex * paths + pathIndex]
    }
    periodSamples.push(sample)
  }

  return {
    ok: true,
    value: {
      metadata: {
        config,
        dataset: dataset.identity,
        algorithms: {
          model: input.modelVersion,
          prng: input.prngVersion,
          quantile: QUANTILE_VERSION,
        },
      },
      terminalWealth,
      quantiles: computeQuantileSeries(periodSamples),
      retainedPaths,
      failures,
    },
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
