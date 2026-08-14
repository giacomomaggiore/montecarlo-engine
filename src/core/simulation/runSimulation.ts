import type { AlignedDataset } from '../data/datasetTypes'
import {
  computeQuantile,
  QUANTILE_VERSION,
  REPRESENTATIVE_PATH_QUANTILE_LEVELS,
} from '../math/quantiles'
import {
  allocateInitialInvestment,
  stepPortfolioPeriod,
} from '../portfolio/cashFlows'
import type { ValidationResult } from '../validation'
import type { SimulationEngine } from './simulationEngine'
import type {
  PeriodScenario,
  RepresentativePath,
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
      // typed array. Overwrite with NaN so downstream consumers (terminal
      // wealth, representative-path selection) can tell "this path failed
      // here" from "this path was legitimately worth $0 here".
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
      representativePaths: selectRepresentativePaths(
        terminalWealth,
        equityByPeriod,
        paths,
        periodCount,
      ),
      retainedPaths,
      failures,
    },
  }
}

// For each of REPRESENTATIVE_PATH_QUANTILE_LEVELS (p1, p10, p25, p50, p75,
// p90, p99), picks the one actually simulated path whose OWN terminal
// wealth lands nearest that quantile of the cross-sectional terminal-wealth
// distribution, then returns that path's full period-by-period equity
// series. This replaced an earlier per-period cross-sectional QuantileSeries
// (see quantiles.ts) as the chart's data source: that aggregate's "p50 at
// period 100" could come from a different path than its "p50 at period
// 101", so it never corresponded to anything a user actually experienced. A
// real path's terminal wealth is a fact about one simulated future; a
// cross-sectional statistic at each period is a fact about the whole
// distribution. Consequence, not a bug: two returned paths' values can
// cross at intermediate periods, since each is one independent trajectory
// chosen only by where it ends up -- verified directly against the real
// released dataset's demo portfolio, the p10 and p90 paths sit on the
// "wrong" side of each other for roughly 45% of the run's periods (see
// LOG.MD). With few candidate paths (small `paths`), adjacent levels such
// as p1/p10 or p90/p99 can also resolve to the very same nearest path.
//
// Time complexity: O(paths log paths) to sort finite terminal wealth once,
// plus O(quantileLevelCount * paths) to find each nearest path and
// O(quantileLevelCount * periods) to copy out the selected trajectories --
// all far cheaper than the O(periods * paths log paths) a full per-period
// cross-sectional sort would have cost. Space complexity:
// O(quantileLevelCount * periods) for the returned trajectories, reusing
// the already-allocated equityByPeriod buffer rather than a second copy of
// the whole N*T matrix.
function selectRepresentativePaths(
  terminalWealth: Float64Array,
  equityByPeriod: Float64Array,
  paths: number,
  periodCount: number,
): RepresentativePath[] {
  const finitePathIndices: number[] = []
  for (let pathIndex = 0; pathIndex < paths; pathIndex += 1) {
    if (Number.isFinite(terminalWealth[pathIndex])) {
      finitePathIndices.push(pathIndex)
    }
  }

  // Every path failed (insolvent/non-finite) -- there is no terminal wealth
  // distribution to pick a representative path from.
  if (finitePathIndices.length === 0) {
    return []
  }

  const sortedFiniteTerminalWealth = finitePathIndices
    .map((pathIndex) => terminalWealth[pathIndex])
    .sort((a, b) => a - b)

  return REPRESENTATIVE_PATH_QUANTILE_LEVELS.map((quantileLevel) => {
    const target = computeQuantile(sortedFiniteTerminalWealth, quantileLevel)
    const pathIndex = nearestFinitePathIndex(
      finitePathIndices,
      terminalWealth,
      target,
    )

    const values = new Float64Array(periodCount)
    for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
      values[periodIndex] = equityByPeriod[periodIndex * paths + pathIndex]
    }

    return {
      quantileLevel,
      pathIndex,
      terminalWealth: terminalWealth[pathIndex],
      values,
    }
  })
}

// Ties (equidistant candidates) resolve to the lower path index -- the
// first strictly-closer candidate wins, so this stays deterministic for a
// given seed without an extra tie-breaking rule.
function nearestFinitePathIndex(
  candidatePathIndices: readonly number[],
  terminalWealth: Float64Array,
  target: number,
): number {
  let bestIndex = candidatePathIndices[0]
  let bestDistance = Math.abs(terminalWealth[bestIndex] - target)

  for (const pathIndex of candidatePathIndices) {
    const distance = Math.abs(terminalWealth[pathIndex] - target)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = pathIndex
    }
  }

  return bestIndex
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
