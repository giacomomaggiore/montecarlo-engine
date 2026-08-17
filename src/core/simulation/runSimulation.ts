import type { AlignedDataset } from '../data/datasetTypes'
import {
  computeQuantile,
  QUANTILE_VERSION,
  REPRESENTATIVE_PATH_QUANTILE_LEVELS,
} from '../math/quantiles'
import {
  allocateInitialInvestment,
  applyPeriodReturn,
  stepPortfolioPeriod,
} from '../portfolio/cashFlows'
import {
  initializeBenchmark,
  stepBenchmarkPeriod,
} from '../portfolio/benchmark'
import { rebalancePortfolio } from '../portfolio/rebalancing'
import {
  applyExecutedTrades,
  createContributionTrades,
  fundRebalanceBuys,
  priceTrades,
} from '../portfolio/transactionCosts'
import {
  applyTaxableBuys,
  applyTaxableSales,
  initializeTaxState,
} from '../portfolio/taxes'
import {
  computeAnnualizedIrr,
  computeCagr,
  computeTerminalWealthPercentiles,
  createPathMetricsAccumulator,
  METRICS_VERSION,
  summarizeAcrossPaths,
  summarizeBenchmarkComparison,
} from '../portfolio/metrics'
import type { SimulationMetrics } from '../portfolio/metrics'
import type { ValidationResult } from '../validation'
import type { SimulationEngine } from './simulationEngine'
import type {
  PeriodScenario,
  RepresentativePath,
  RebalancingConfig,
  RetainedPath,
  SimulationAssetSelection,
  SimulationConfig,
  SimulationFailure,
  SimulationResult,
  TaxConfig,
  TransactionCostConfig,
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
  // Only dataset.assetIds.length, dataset.identity, and dataset.dates are
  // read here. Asset returns are reached exclusively through the engine's
  // scenarios.
  readonly dataset: AlignedDataset
  readonly config: SimulationConfig
  // The caller knows which engine and PRNG produced the scenarios; this file
  // only knows its own quantile and metrics rules.
  readonly modelVersion: string
  readonly prngVersion: string
  // Omitted only by legacy/direct callers: the identity projection preserves
  // the existing "every dataset column is a holding" behavior.
  readonly selection?: SimulationAssetSelection
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

  const selection = input.selection ?? {
    portfolioAssetIndices: dataset.assetIds.map((_, index) => index),
    benchmarkAssetIndex: null,
  }
  const selectionResult = validateSelection(selection, dataset.assetIds.length)
  if (!selectionResult.ok) {
    return selectionResult
  }

  const configResult = validateSimulationConfig(
    config,
    selection.portfolioAssetIndices.length,
    dataset.identity.frequency,
  )
  if (!configResult.ok) {
    return configResult
  }

  const { weights, initialInvestment, cashFlow, paths, periods } = config
  const periodCount = periods + 1
  const batchSize = input.batchSize ?? paths
  const periodsPerYear = dataset.identity.frequency === 'weekly' ? 52 : 12
  const horizonYears = periods / periodsPerYear
  // The Key Metrics Panel rule: a time-weighted CAGR is only honest with no
  // external flows after period 0; once contributions recur, the growth
  // number must be money-weighted (IRR).
  const growthKind = cashFlow.mode === 'lumpSum' ? 'cagr' : 'irr'

  // One flat typed array instead of nested arrays: paths * periods is already
  // capped at 10,000,000 by validateSimulationConfig, so this stays bounded
  // and avoids the per-number boxing overhead of a plain number[][].
  const equityByPeriod = new Float64Array(periodCount * paths)
  // Cumulative price level per path per period (period 0 = 1), compounded
  // from each path's own jointly sampled log-inflation increments. Needed for
  // the whole matrix because representative paths are only chosen AFTER the
  // loop, from terminal wealth — their identities are unknowable while
  // sampling. Float32 (not Float64) deliberately: this series is display-only
  // deflation, the same "transport precision, not accounting precision"
  // budget the dataset itself ships in, and it halves the extra memory to
  // +4 bytes/cell (~40 MB at the absolute work cap, ~4 MB at defaults). The
  // buffer is discarded when this function returns — only the <= 57 selected
  // paths' copies survive, so nothing here grows the Worker transfer.
  const priceLevelByPeriod = new Float32Array(periodCount * paths)
  const terminalWealth = new Float64Array(paths)
  const benchmarkTerminalWealth =
    selection.benchmarkAssetIndex === null ? null : new Float64Array(paths)

  // Per-path metric values (Phase 4.2), NaN = "unavailable for this path".
  // O(N) space each — the price of reporting metric DISTRIBUTIONS across all
  // paths rather than one arbitrary path's number.
  const growthPerPath = new Float64Array(paths)
  const volatilityPerPath = new Float64Array(paths)
  const sharpePerPath = new Float64Array(paths)
  const drawdownPerPath = new Float64Array(paths)
  const transactionCostsPerPath = new Float64Array(paths)
  const realizedGainLossPerPath = new Float64Array(paths)
  const taxesPaidPerPath = new Float64Array(paths)
  const lossCarryforwardPerPath = new Float64Array(paths)
  // Reusable IRR schedule scratch (investor-perspective net cash flows):
  // one O(T) buffer reused by every path, never O(N * T) storage.
  const cashFlowScratch = new Float64Array(periodCount)
  let lossCount = 0

  const failures: SimulationFailure[] = []
  const retainedPaths: RetainedPath[] = []
  const retainedCount = Math.min(RETAINED_PATH_COUNT, paths)
  const hasPortfolioFriction =
    (config.transactionCosts?.fixedPerOrder ?? 0) > 0 ||
    (config.transactionCosts?.proportionalRate ?? 0) > 0 ||
    (config.tax?.capitalGainsRate ?? 0) > 0

  // Time complexity: O(N * T) — one engine draw, one accounting step, and one
  // O(1) metrics update per path per period, matching the N (paths) * T
  // (periods) work budget already enforced by validateSimulationConfig; plus
  // O(T log(1/tol)) per contributing path for the IRR root (see metrics.ts).
  // Space complexity: O(N * T) for the flat equity and price-level buffers,
  // plus O(N) for the per-path metric arrays and O(T) per retained path.
  //
  // onBatchComplete is a pure notification hook layered on this single pass —
  // it never restarts the engine's PRNG stream or re-derives a scenario, so a
  // batched Worker run and an unbatched direct call draw an identical
  // sequence for the same seed. Batching only changes how often progress is
  // reported, never what is computed.
  for (let pathIndex = 0; pathIndex < paths; pathIndex += 1) {
    const isRetained = pathIndex < retainedCount
    const retainedValues = isRetained ? new Float64Array(periodCount) : null
    const retainedContributions = isRetained
      ? new Float64Array(periodCount)
      : null
    const retainedPriceLevels = isRetained
      ? new Float64Array(periodCount)
      : null
    const retainedScenarios: PeriodScenario[] | null = isRetained ? [] : null
    const retainedTrades:
      (readonly import('../portfolio/rebalancing').PortfolioTrade[])[] | null =
      isRetained ? Array.from({ length: periodCount }, () => []) : null
    const retainedExecutedTrades:
      | (readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[])[]
      | null = isRetained ? Array.from({ length: periodCount }, () => []) : null
    const retainedTransactionCosts = isRetained
      ? new Float64Array(periodCount)
      : null
    const retainedRealizedGainLosses = isRetained
      ? new Float64Array(periodCount)
      : null
    const retainedTaxesPaid = isRetained ? new Float64Array(periodCount) : null
    const retainedCostBases = isRetained ? new Float64Array(periodCount) : null
    const retainedLossCarryforwards = isRetained
      ? new Float64Array(periodCount)
      : null

    let holdings: readonly number[] = allocateInitialInvestment(
      initialInvestment,
      weights,
    )
    let taxState = initializeTaxState(initialInvestment, weights, config.tax)
    let cumulativeTransactionCosts = 0
    let cumulativeRealizedGainLoss = 0
    let cumulativeTaxesPaid = 0
    let equity = sum(holdings)
    let benchmarkValue =
      selection.benchmarkAssetIndex === null
        ? null
        : initializeBenchmark(initialInvestment)
    equityByPeriod[pathIndex] = equity
    priceLevelByPeriod[pathIndex] = 1
    retainedValues?.set([equity], 0)
    retainedPriceLevels?.set([1], 0)
    retainedCostBases?.set([sum(taxState.costBases)], 0)
    // retainedContributions[0] stays 0: the initial investment is capital
    // allocation, not a scheduled contribution.

    // Metrics accumulate streaming, from the very numbers the accounting
    // step just produced — never recovered later from the equity buffer.
    const metricsAccumulator = createPathMetricsAccumulator(periodsPerYear)
    // Price level compounds in log space (the CPI column and the parametric
    // engine both emit LOG inflation increments): P_t = exp(sum of
    // increments), so P is exact under addition and can never go negative.
    let cumulativeLogInflation = 0
    cashFlowScratch.fill(0)

    let failedAtPeriod = -1
    let finalPeriodMetric:
      | {
          readonly startEquity: number
          readonly contribution: number
          readonly riskFreeRate: number
          readonly neutralReturn: number
        }
      | undefined

    for (let periodIndex = 1; periodIndex <= periods; periodIndex += 1) {
      const startEquity = equity
      const scenario = engine.nextScenario()
      const portfolioScenario: PeriodScenario = {
        ...scenario,
        assetReturns: selection.portfolioAssetIndices.map(
          (assetIndex) => scenario.assetReturns[assetIndex],
        ),
      }
      const result = stepPortfolioPeriod(
        holdings,
        portfolioScenario,
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

      if (benchmarkValue !== null && selection.benchmarkAssetIndex !== null) {
        const benchmarkResult = stepBenchmarkPeriod(
          benchmarkValue,
          scenario.assetReturns[selection.benchmarkAssetIndex],
          result.contribution,
        )
        if (!Number.isFinite(benchmarkResult.value)) {
          failures.push({
            pathIndex,
            periodIndex,
            code: 'non-finite-benchmark',
            message: 'Benchmark value became non-finite during accounting.',
          })
          failedAtPeriod = periodIndex
          break
        }
        benchmarkValue = benchmarkResult.value
      }

      let periodNeutralReturn = result.neutralReturn
      let intendedTrades: readonly import('../portfolio/rebalancing').PortfolioTrade[] =
        []
      let executedTrades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[] =
        []
      let periodTransactionCosts = 0
      let periodRealizedGainLoss = 0
      let periodTaxesPaid = 0

      if (hasPortfolioFriction) {
        const ledger = executeCostedPortfolioPeriod({
          holdings,
          assetReturns: portfolioScenario.assetReturns,
          contribution: result.contribution,
          weights,
          rebalancing: config.rebalancing,
          periodIndex,
          transactionCosts: config.transactionCosts,
          tax: config.tax,
          taxState,
        })
        if (!ledger.ok) {
          failures.push({
            pathIndex,
            periodIndex,
            code: ledger.errors[0].code,
            message: ledger.errors[0].message,
          })
          failedAtPeriod = periodIndex
          break
        }

        holdings = ledger.value.holdings
        taxState = ledger.value.taxState
        equity = sum(holdings)
        periodNeutralReturn =
          startEquity > 0
            ? (equity - result.contribution) / startEquity - 1
            : NaN
        intendedTrades = ledger.value.intendedTrades
        executedTrades = ledger.value.executedTrades
        periodTransactionCosts = ledger.value.transactionCosts
        periodRealizedGainLoss = ledger.value.realizedGainLoss
        periodTaxesPaid = ledger.value.taxesPaid
      } else {
        // The Phase 6 path is left byte-for-byte equivalent when friction is
        // disabled: its zero-cost trades are still exposed as executed events.
        const rebalanced = rebalancePortfolio(
          result.holdings,
          weights,
          config.rebalancing,
          periodIndex,
        )
        holdings = rebalanced.holdings
        equity = result.equity
        intendedTrades = rebalanced.trades
        executedTrades = priceTrades(rebalanced.trades, undefined).trades
      }

      cumulativeTransactionCosts += periodTransactionCosts
      cumulativeRealizedGainLoss += periodRealizedGainLoss
      cumulativeTaxesPaid += periodTaxesPaid
      equityByPeriod[periodIndex * paths + pathIndex] = equity

      cumulativeLogInflation += scenario.inflation
      const priceLevel = Math.exp(cumulativeLogInflation)
      priceLevelByPeriod[periodIndex * paths + pathIndex] = priceLevel

      // The terminal period is finalized only after the one mandatory
      // liquidation below. Earlier periods can stream directly into metrics.
      if (periodIndex === periods) {
        finalPeriodMetric = {
          startEquity,
          contribution: result.contribution,
          riskFreeRate: scenario.riskFreeRate,
          neutralReturn: periodNeutralReturn,
        }
      } else {
        metricsAccumulator.recordPeriod(
          result.contribution,
          periodNeutralReturn,
          scenario.riskFreeRate,
        )
      }
      // Investor-perspective flow: a contribution is money leaving the
      // investor's pocket, hence negative in the IRR schedule.
      cashFlowScratch[periodIndex] = -result.contribution

      retainedValues?.set([equity], periodIndex)
      retainedContributions?.set([result.contribution], periodIndex)
      // Retained paths get the full-precision float64 price level for free
      // (we are inside the loop); representative paths, chosen only after
      // the loop, are copied from the float32 buffer instead.
      retainedPriceLevels?.set([priceLevel], periodIndex)
      retainedScenarios?.push(scenario)
      if (retainedTrades !== null) {
        retainedTrades[periodIndex] = intendedTrades
      }
      if (retainedExecutedTrades !== null) {
        retainedExecutedTrades[periodIndex] = executedTrades
      }
      retainedTransactionCosts?.set([periodTransactionCosts], periodIndex)
      retainedRealizedGainLosses?.set([periodRealizedGainLoss], periodIndex)
      retainedTaxesPaid?.set([periodTaxesPaid], periodIndex)
      retainedCostBases?.set([sum(taxState.costBases)], periodIndex)
      retainedLossCarryforwards?.set([taxState.lossCarryforward], periodIndex)
    }

    const failed = failedAtPeriod !== -1

    if (failed) {
      // Every never-written period from the failure onward defaults to 0 in the
      // typed array. Overwrite with NaN so downstream consumers (terminal
      // wealth, representative-path selection, real-value deflation) can tell
      // "this path failed here" from "this path was legitimately worth $0 here".
      for (
        let periodIndex = failedAtPeriod;
        periodIndex <= periods;
        periodIndex += 1
      ) {
        equityByPeriod[periodIndex * paths + pathIndex] = NaN
        priceLevelByPeriod[periodIndex * paths + pathIndex] = NaN
        retainedValues?.set([NaN], periodIndex)
        retainedContributions?.set([NaN], periodIndex)
        retainedPriceLevels?.set([NaN], periodIndex)
      }
    }

    if (!failed && hasPortfolioFriction) {
      const liquidation = liquidatePortfolio(
        holdings,
        taxState,
        config.transactionCosts,
        config.tax,
      )
      if (!liquidation.ok) {
        failures.push({
          pathIndex,
          periodIndex: periods,
          code: liquidation.errors[0].code,
          message: liquidation.errors[0].message,
        })
        failedAtPeriod = periods
      } else {
        equity = liquidation.value.terminalWealth
        taxState = liquidation.value.taxState
        cumulativeTransactionCosts += liquidation.value.transactionCosts
        cumulativeRealizedGainLoss += liquidation.value.realizedGainLoss
        cumulativeTaxesPaid += liquidation.value.taxesPaid
        equityByPeriod[periods * paths + pathIndex] = equity
        retainedValues?.set([equity], periods)
        if (retainedExecutedTrades !== null) {
          retainedExecutedTrades[periods] = [
            ...retainedExecutedTrades[periods],
            ...liquidation.value.executedTrades,
          ]
        }
        retainedTransactionCosts?.set(
          [
            retainedTransactionCosts[periods] +
              liquidation.value.transactionCosts,
          ],
          periods,
        )
        retainedRealizedGainLosses?.set(
          [
            retainedRealizedGainLosses[periods] +
              liquidation.value.realizedGainLoss,
          ],
          periods,
        )
        retainedTaxesPaid?.set(
          [retainedTaxesPaid[periods] + liquidation.value.taxesPaid],
          periods,
        )
        retainedCostBases?.set([sum(taxState.costBases)], periods)
        retainedLossCarryforwards?.set([taxState.lossCarryforward], periods)
      }
    }

    const failedAfterLiquidation = failedAtPeriod !== -1
    if (!failedAfterLiquidation && finalPeriodMetric !== undefined) {
      const finalNeutralReturn = hasPortfolioFriction
        ? finalPeriodMetric.startEquity > 0
          ? (equity - finalPeriodMetric.contribution) /
              finalPeriodMetric.startEquity -
            1
          : NaN
        : finalPeriodMetric.neutralReturn
      metricsAccumulator.recordPeriod(
        finalPeriodMetric.contribution,
        finalNeutralReturn,
        finalPeriodMetric.riskFreeRate,
      )
    }

    if (failedAfterLiquidation && !failed) {
      equityByPeriod[periods * paths + pathIndex] = NaN
      priceLevelByPeriod[periods * paths + pathIndex] = NaN
      retainedValues?.set([NaN], periods)
      retainedContributions?.set([NaN], periods)
      retainedPriceLevels?.set([NaN], periods)
      retainedTransactionCosts?.set([NaN], periods)
      retainedRealizedGainLosses?.set([NaN], periods)
      retainedTaxesPaid?.set([NaN], periods)
      retainedCostBases?.set([NaN], periods)
      retainedLossCarryforwards?.set([NaN], periods)
    }

    terminalWealth[pathIndex] = failedAfterLiquidation ? NaN : equity
    if (benchmarkTerminalWealth !== null) {
      benchmarkTerminalWealth[pathIndex] =
        failedAfterLiquidation || benchmarkValue === null ? NaN : benchmarkValue
    }

    // Per-path metric values. A failed path has NO defined metrics (NaN
    // everywhere) but DOES count as a loss: it certainly did not beat its
    // own contributed capital.
    if (failedAfterLiquidation) {
      growthPerPath[pathIndex] = NaN
      volatilityPerPath[pathIndex] = NaN
      sharpePerPath[pathIndex] = NaN
      drawdownPerPath[pathIndex] = NaN
      transactionCostsPerPath[pathIndex] = NaN
      realizedGainLossPerPath[pathIndex] = NaN
      taxesPaidPerPath[pathIndex] = NaN
      lossCarryforwardPerPath[pathIndex] = NaN
      lossCount += 1
    } else {
      const pathMetrics = metricsAccumulator.finish()
      volatilityPerPath[pathIndex] = pathMetrics.annualizedVolatility
      sharpePerPath[pathIndex] = pathMetrics.sharpeRatio
      drawdownPerPath[pathIndex] = pathMetrics.maxDrawdown
      transactionCostsPerPath[pathIndex] = cumulativeTransactionCosts
      realizedGainLossPerPath[pathIndex] = cumulativeRealizedGainLoss
      taxesPaidPerPath[pathIndex] = cumulativeTaxesPaid
      lossCarryforwardPerPath[pathIndex] = taxState.lossCarryforward

      if (growthKind === 'cagr') {
        growthPerPath[pathIndex] = computeCagr(
          initialInvestment,
          terminalWealth[pathIndex],
          horizonYears,
        )
      } else {
        // Complete the schedule: initial outflow at t = 0, terminal value in
        // at t = T (net of the contribution that also happened at T).
        cashFlowScratch[0] = -initialInvestment
        cashFlowScratch[periods] += terminalWealth[pathIndex]
        growthPerPath[pathIndex] = computeAnnualizedIrr(
          cashFlowScratch,
          periodsPerYear,
        )
      }

      // Loss = the portfolio ended below everything the investor put in
      // (initial investment plus this path's own realized contributions —
      // value averaging makes that total path-dependent).
      const totalPaidIn = initialInvestment + pathMetrics.totalContributions
      if (terminalWealth[pathIndex] < totalPaidIn) {
        lossCount += 1
      }
    }

    if (
      isRetained &&
      retainedValues &&
      retainedContributions &&
      retainedPriceLevels &&
      retainedScenarios &&
      retainedTrades &&
      retainedExecutedTrades &&
      retainedTransactionCosts &&
      retainedRealizedGainLosses &&
      retainedTaxesPaid &&
      retainedCostBases &&
      retainedLossCarryforwards
    ) {
      retainedPaths.push({
        pathIndex,
        values: retainedValues,
        contributions: retainedContributions,
        priceLevels: retainedPriceLevels,
        trades: retainedTrades,
        executedTrades: retainedExecutedTrades,
        transactionCosts: retainedTransactionCosts,
        realizedGainLosses: retainedRealizedGainLosses,
        taxesPaid: retainedTaxesPaid,
        costBases: retainedCostBases,
        lossCarryforwards: retainedLossCarryforwards,
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

  const metrics: SimulationMetrics = {
    terminalWealth: computeTerminalWealthPercentiles(terminalWealth),
    lossProbability: lossCount / paths,
    // Ruin is future leverage insolvency, not every defensive accounting
    // failure. A fee/tax execution error is surfaced in failures and counts
    // as a loss, but it must not masquerade as economic insolvency.
    ruinProbability:
      failures.filter((failure) => failure.code === 'insolvent').length / paths,
    growth: {
      kind: growthKind,
      summary: summarizeAcrossPaths(growthPerPath),
    },
    annualizedVolatility: summarizeAcrossPaths(volatilityPerPath),
    sharpeRatio: summarizeAcrossPaths(sharpePerPath),
    maxDrawdown: summarizeAcrossPaths(drawdownPerPath),
    transactionCosts: summarizeAcrossPaths(transactionCostsPerPath),
    realizedGainLoss: summarizeAcrossPaths(realizedGainLossPerPath),
    taxesPaid: summarizeAcrossPaths(taxesPaidPerPath),
    lossCarryforward: summarizeAcrossPaths(lossCarryforwardPerPath),
    benchmark:
      benchmarkTerminalWealth === null
        ? null
        : summarizeBenchmarkComparison(terminalWealth, benchmarkTerminalWealth),
  }

  return {
    ok: true,
    value: {
      metadata: {
        config,
        dataset: dataset.identity,
        // A copy, not the dataset's own array reference: the result must stay
        // self-contained once the dataset is released.
        datasetDates: [...dataset.dates],
        benchmarkAssetId:
          selection.benchmarkAssetIndex === null
            ? null
            : dataset.assetIds[selection.benchmarkAssetIndex],
        algorithms: {
          model: input.modelVersion,
          prng: input.prngVersion,
          quantile: QUANTILE_VERSION,
          metrics: METRICS_VERSION,
          accounting: 'cost-tax-accounting-v1',
        },
      },
      terminalWealth,
      benchmarkTerminalWealth,
      metrics,
      representativePaths: selectRepresentativePaths(
        terminalWealth,
        equityByPeriod,
        priceLevelByPeriod,
        paths,
        periodCount,
      ),
      retainedPaths,
      failures,
    },
  }
}

type CostedPeriodResult = {
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly intendedTrades: readonly import('../portfolio/rebalancing').PortfolioTrade[]
  readonly executedTrades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[]
  readonly transactionCosts: number
  readonly realizedGainLoss: number
  readonly taxesPaid: number
}

// This wrapper leaves Phase 1's return/contribution primitive and Phase 6's
// rebalance decision untouched. It only turns their output into cash-funded
// trades, so the accounting policy stays in one auditable place.
function executeCostedPortfolioPeriod({
  holdings,
  assetReturns,
  contribution,
  weights,
  rebalancing,
  periodIndex,
  transactionCosts,
  tax,
  taxState,
}: {
  readonly holdings: readonly number[]
  readonly assetReturns: readonly number[]
  readonly contribution: number
  readonly weights: readonly number[]
  readonly rebalancing: RebalancingConfig | undefined
  readonly periodIndex: number
  readonly transactionCosts: TransactionCostConfig | undefined
  readonly tax: TaxConfig | undefined
  readonly taxState: ReturnType<typeof initializeTaxState>
}): ValidationResult<CostedPeriodResult> {
  const grownHoldings = applyPeriodReturn(holdings, assetReturns)
  const contributionTrades = createContributionTrades(
    contribution,
    weights,
    transactionCosts,
  )
  if (!contributionTrades.ok) return contributionTrades

  const pricedContributionTrades = priceTrades(
    contributionTrades.value,
    transactionCosts,
  )
  const afterContribution = applyExecutedTrades(
    grownHoldings,
    pricedContributionTrades.trades,
  )
  if (!afterContribution.ok) return afterContribution

  let nextTaxState = applyTaxableBuys(taxState, pricedContributionTrades.trades)
  const rebalanced = rebalancePortfolio(
    afterContribution.value,
    weights,
    rebalancing,
    periodIndex,
  )
  const saleIntent = rebalanced.trades.filter((trade) => trade.value < 0)
  const pricedSales = priceTrades(saleIntent, transactionCosts)
  const taxSales = applyTaxableSales(
    nextTaxState,
    afterContribution.value,
    pricedSales.trades,
    tax,
  )
  if (!taxSales.ok) return taxSales

  const afterSales = applyExecutedTrades(
    afterContribution.value,
    pricedSales.trades,
  )
  if (!afterSales.ok) return afterSales

  // Sale proceeds first cover sell fees and tax. Only the residual can pay
  // rebalance buys and their own fees; this is why friction prevents an exact
  // target-weight reset without an explicit cash or borrowing model.
  const availableProceeds =
    pricedSales.grossSells - pricedSales.sellCosts - taxSales.value.taxPaid
  const buyIntent = rebalanced.trades.filter((trade) => trade.value > 0)
  const fundedBuys = fundRebalanceBuys(
    buyIntent,
    availableProceeds,
    transactionCosts,
  )
  if (!fundedBuys.ok) return fundedBuys

  const pricedBuys = priceTrades(fundedBuys.value, transactionCosts)
  const afterBuys = applyExecutedTrades(afterSales.value, pricedBuys.trades)
  if (!afterBuys.ok) return afterBuys

  nextTaxState = applyTaxableBuys(taxSales.value.state, pricedBuys.trades)
  return {
    ok: true,
    value: {
      holdings: afterBuys.value,
      taxState: nextTaxState,
      intendedTrades: rebalanced.trades,
      executedTrades: [
        ...pricedContributionTrades.trades,
        ...pricedSales.trades,
        ...pricedBuys.trades,
      ],
      transactionCosts:
        pricedContributionTrades.buyCosts +
        pricedSales.sellCosts +
        pricedBuys.buyCosts,
      realizedGainLoss: taxSales.value.realizedGainLoss,
      taxesPaid: taxSales.value.taxPaid,
    },
  }
}

function liquidatePortfolio(
  holdings: readonly number[],
  taxState: ReturnType<typeof initializeTaxState>,
  transactionCosts: TransactionCostConfig | undefined,
  tax: TaxConfig | undefined,
): ValidationResult<{
  readonly terminalWealth: number
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly executedTrades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[]
  readonly transactionCosts: number
  readonly realizedGainLoss: number
  readonly taxesPaid: number
}> {
  const liquidationIntent = holdings.flatMap((holding, assetIndex) =>
    holding > 0 ? [{ assetIndex, value: -holding }] : [],
  )
  const pricedSales = priceTrades(liquidationIntent, transactionCosts)
  const taxSales = applyTaxableSales(
    taxState,
    holdings,
    pricedSales.trades,
    tax,
  )
  if (!taxSales.ok) return taxSales

  const terminalWealth =
    pricedSales.grossSells - pricedSales.sellCosts - taxSales.value.taxPaid
  if (!Number.isFinite(terminalWealth) || terminalWealth < -1e-10) {
    return {
      ok: false,
      errors: [
        {
          code: 'tax.liquidation.invalid',
          message: 'Final liquidation produced invalid terminal wealth.',
        },
      ],
    }
  }

  return {
    ok: true,
    value: {
      terminalWealth: terminalWealth < 0 ? 0 : terminalWealth,
      taxState: taxSales.value.state,
      executedTrades: pricedSales.trades,
      transactionCosts: pricedSales.sellCosts,
      realizedGainLoss: taxSales.value.realizedGainLoss,
      taxesPaid: taxSales.value.taxPaid,
    },
  }
}

function validateSelection(
  selection: SimulationAssetSelection,
  datasetAssetCount: number,
): ValidationResult<SimulationAssetSelection> {
  const errors = [] as { code: string; message: string }[]
  const seenIndices = new Set<number>()

  for (const assetIndex of selection.portfolioAssetIndices) {
    if (
      !Number.isInteger(assetIndex) ||
      assetIndex < 0 ||
      assetIndex >= datasetAssetCount
    ) {
      errors.push({
        code: 'selection.portfolioAssetIndices',
        message:
          'Portfolio asset indexes must identify loaded dataset columns.',
      })
      continue
    }
    if (seenIndices.has(assetIndex)) {
      errors.push({
        code: 'selection.portfolioAssetIndices.duplicate',
        message: 'Portfolio asset indexes must be unique.',
      })
    }
    seenIndices.add(assetIndex)
  }

  if (selection.portfolioAssetIndices.length === 0) {
    errors.push({
      code: 'selection.portfolioAssetIndices.empty',
      message: 'Select at least one portfolio asset.',
    })
  }

  const benchmarkIndex = selection.benchmarkAssetIndex
  if (
    benchmarkIndex !== null &&
    (!Number.isInteger(benchmarkIndex) ||
      benchmarkIndex < 0 ||
      benchmarkIndex >= datasetAssetCount)
  ) {
    errors.push({
      code: 'selection.benchmarkAssetIndex',
      message: 'Benchmark index must identify a loaded dataset column.',
    })
  }

  return errors.length === 0
    ? { ok: true, value: selection }
    : { ok: false, errors }
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
  priceLevelByPeriod: Float32Array,
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
    const priceLevels = new Float64Array(periodCount)
    for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
      values[periodIndex] = equityByPeriod[periodIndex * paths + pathIndex]
      // Copied out of the float32 buffer: display-precision by design (see
      // the buffer's allocation comment).
      priceLevels[periodIndex] =
        priceLevelByPeriod[periodIndex * paths + pathIndex]
    }

    return {
      quantileLevel,
      pathIndex,
      terminalWealth: terminalWealth[pathIndex],
      values,
      priceLevels,
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
