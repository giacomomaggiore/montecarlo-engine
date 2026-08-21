import type { AlignedDataset } from '../data/datasetTypes'
import {
  computeQuantile,
  QUANTILE_VERSION,
  REPRESENTATIVE_PATH_QUANTILE_LEVELS,
} from '../math/quantiles'
import {
  applyPeriodReturn,
  computeScheduledContribution,
  stepPortfolioPeriod,
} from '../portfolio/cashFlows'
import {
  accrueDebt,
  createProportionalSaleTrades,
  createTargetWeightBuyTrades,
  initializeLeveragedPortfolio,
  isLeverageResetDue,
  requiresMarginCall,
  snapshotLeverage,
} from '../portfolio/leverage'
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
  LeverageConfig,
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
  const borrowingInterestPerPath = new Float64Array(paths)
  const marginCallPerPath = new Uint8Array(paths)
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
  const leverage = config.leverage?.mode === 'enabled' ? config.leverage : null

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
    const retainedLeverage =
      isRetained && leverage !== null
        ? {
            debts: new Float64Array(periodCount),
            grossAssets: new Float64Array(periodCount),
            grossLeverages: new Float64Array(periodCount),
            maintenanceMargins: new Float64Array(periodCount),
            marginCalls: new Uint8Array(periodCount),
            leverageResets: new Uint8Array(periodCount),
          }
        : null

    const opening = initializeLeveragedPortfolio(
      initialInvestment,
      weights,
      leverage ?? undefined,
    )
    let holdings: readonly number[] = opening.holdings
    let debt = opening.debt
    let taxState = initializeTaxState(
      leverage === null ? initialInvestment : sum(holdings),
      weights,
    )
    let cumulativeTransactionCosts = 0
    let cumulativeRealizedGainLoss = 0
    let cumulativeTaxesPaid = 0
    let cumulativeBorrowingInterest = 0
    let equity = sum(holdings) - debt
    let benchmarkValue =
      selection.benchmarkAssetIndex === null
        ? null
        : initializeBenchmark(initialInvestment)
    equityByPeriod[pathIndex] = equity
    priceLevelByPeriod[pathIndex] = 1
    retainedValues?.set([equity], 0)
    retainedPriceLevels?.set([1], 0)
    retainedCostBases?.set([sum(taxState.costBases)], 0)
    const openingLeverage = snapshotLeverage(holdings, debt)
    retainedLeverage?.debts.set([debt], 0)
    retainedLeverage?.grossAssets.set([openingLeverage.grossAssets], 0)
    retainedLeverage?.grossLeverages.set(
      [openingLeverage.grossLeverage ?? NaN],
      0,
    )
    retainedLeverage?.maintenanceMargins.set(
      [openingLeverage.maintenanceMargin ?? NaN],
      0,
    )
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
      let contribution: number
      let periodNeutralReturn: number
      let intendedTrades: readonly import('../portfolio/rebalancing').PortfolioTrade[] =
        []
      let executedTrades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[] =
        []
      let periodTransactionCosts = 0
      let periodRealizedGainLoss = 0
      let periodTaxesPaid = 0
      let periodBorrowingInterest = 0
      let marginCall = false
      let leverageReset = false

      if (leverage !== null) {
        const leveraged = executeLeveragedPortfolioPeriod({
          holdings,
          debt,
          taxState,
          assetReturns: portfolioScenario.assetReturns,
          riskFreeRate: scenario.riskFreeRate,
          cashFlow,
          initialInvestment,
          weights,
          rebalancing: config.rebalancing,
          leverage,
          periodIndex,
          transactionCosts: config.transactionCosts,
          tax: config.tax,
        })
        if (!leveraged.ok) {
          failures.push({
            pathIndex,
            periodIndex,
            code: leveraged.errors[0].code,
            message: leveraged.errors[0].message,
          })
          failedAtPeriod = periodIndex
          break
        }
        holdings = leveraged.value.holdings
        debt = leveraged.value.debt
        taxState = leveraged.value.taxState
        equity = sum(holdings) - debt
        contribution = leveraged.value.contribution
        periodNeutralReturn =
          startEquity > 0 ? (equity - contribution) / startEquity - 1 : NaN
        intendedTrades = leveraged.value.intendedTrades
        executedTrades = leveraged.value.executedTrades
        periodTransactionCosts = leveraged.value.transactionCosts
        periodRealizedGainLoss = leveraged.value.realizedGainLoss
        periodTaxesPaid = leveraged.value.taxesPaid
        periodBorrowingInterest = leveraged.value.borrowingInterest
        marginCall = leveraged.value.marginCall
        leverageReset = leveraged.value.leverageReset
      } else {
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
        contribution = result.contribution
        periodNeutralReturn = result.neutralReturn

        if (hasPortfolioFriction) {
          const ledger = executeCostedPortfolioPeriod({
            holdings,
            assetReturns: portfolioScenario.assetReturns,
            contribution,
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
            startEquity > 0 ? (equity - contribution) / startEquity - 1 : NaN
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
      }

      if (benchmarkValue !== null && selection.benchmarkAssetIndex !== null) {
        const benchmarkResult = stepBenchmarkPeriod(
          benchmarkValue,
          scenario.assetReturns[selection.benchmarkAssetIndex],
          contribution,
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

      cumulativeTransactionCosts += periodTransactionCosts
      cumulativeRealizedGainLoss += periodRealizedGainLoss
      cumulativeTaxesPaid += periodTaxesPaid
      cumulativeBorrowingInterest += periodBorrowingInterest
      if (marginCall) marginCallPerPath[pathIndex] = 1
      equityByPeriod[periodIndex * paths + pathIndex] = equity

      cumulativeLogInflation += scenario.inflation
      const priceLevel = Math.exp(cumulativeLogInflation)
      priceLevelByPeriod[periodIndex * paths + pathIndex] = priceLevel

      // The terminal period is finalized only after the one mandatory
      // liquidation below. Earlier periods can stream directly into metrics.
      if (periodIndex === periods) {
        finalPeriodMetric = {
          startEquity,
          contribution,
          riskFreeRate: scenario.riskFreeRate,
          neutralReturn: periodNeutralReturn,
        }
      } else {
        metricsAccumulator.recordPeriod(
          contribution,
          periodNeutralReturn,
          scenario.riskFreeRate,
        )
      }
      // Investor-perspective flow: a contribution is money leaving the
      // investor's pocket, hence negative in the IRR schedule.
      cashFlowScratch[periodIndex] = -contribution

      retainedValues?.set([equity], periodIndex)
      retainedContributions?.set([contribution], periodIndex)
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
      const leverageSnapshot = snapshotLeverage(holdings, debt)
      retainedLeverage?.debts.set([debt], periodIndex)
      retainedLeverage?.grossAssets.set(
        [leverageSnapshot.grossAssets],
        periodIndex,
      )
      retainedLeverage?.grossLeverages.set(
        [leverageSnapshot.grossLeverage ?? NaN],
        periodIndex,
      )
      retainedLeverage?.maintenanceMargins.set(
        [leverageSnapshot.maintenanceMargin ?? NaN],
        periodIndex,
      )
      retainedLeverage?.marginCalls.set([marginCall ? 1 : 0], periodIndex)
      retainedLeverage?.leverageResets.set([leverageReset ? 1 : 0], periodIndex)
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

    if (!failed && (hasPortfolioFriction || leverage !== null)) {
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
        const terminalEquity = liquidation.value.terminalWealth - debt
        if (leverage !== null && terminalEquity < -1e-10) {
          failures.push({
            pathIndex,
            periodIndex: periods,
            code: 'insolvent',
            message: 'Final liquidation proceeds could not repay debt.',
          })
          failedAtPeriod = periods
        }
        equity = Math.max(0, terminalEquity)
        debt = 0
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

    const isInsolvent = failures.some(
      (failure) =>
        failure.pathIndex === pathIndex && failure.code === 'insolvent',
    )
    if (failedAfterLiquidation && !failed && !isInsolvent) {
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

    terminalWealth[pathIndex] = failedAfterLiquidation
      ? isInsolvent
        ? 0
        : NaN
      : equity
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
      borrowingInterestPerPath[pathIndex] = NaN
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
      borrowingInterestPerPath[pathIndex] = cumulativeBorrowingInterest

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
        leverage: retainedLeverage,
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
    borrowingInterest: summarizeAcrossPaths(borrowingInterestPerPath),
    marginCallProbability:
      leverage === null
        ? null
        : marginCallPerPath.reduce((total, value) => total + value, 0) / paths,
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
        portfolioAssetIds: selection.portfolioAssetIndices.map(
          (assetIndex) => dataset.assetIds[assetIndex],
        ),
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

type LeveragedPeriodResult = CostedPeriodResult & {
  readonly contribution: number
  readonly debt: number
  readonly borrowingInterest: number
  readonly marginCall: boolean
  readonly leverageReset: boolean
}

type SaleLedgerResult = {
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly trades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[]
  readonly transactionCosts: number
  readonly realizedGainLoss: number
  readonly taxesPaid: number
  readonly netProceeds: number
}

function executeSaleLedger({
  holdings,
  taxState,
  saleTrades,
  transactionCosts,
  tax,
}: {
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly saleTrades: readonly import('../portfolio/rebalancing').PortfolioTrade[]
  readonly transactionCosts: TransactionCostConfig | undefined
  readonly tax: TaxConfig | undefined
}): ValidationResult<SaleLedgerResult> {
  const pricedSales = priceTrades(saleTrades, transactionCosts)
  const taxSales = applyTaxableSales(
    taxState,
    holdings,
    pricedSales.trades,
    tax,
  )
  if (!taxSales.ok) return taxSales
  const afterSales = applyExecutedTrades(holdings, pricedSales.trades)
  if (!afterSales.ok) return afterSales
  const netProceeds =
    pricedSales.grossSells - pricedSales.sellCosts - taxSales.value.taxPaid
  if (!Number.isFinite(netProceeds) || netProceeds < -1e-10) {
    return {
      ok: false,
      errors: [
        {
          code: 'leverage.sale.invalid',
          message: 'A leveraged sale produced invalid net proceeds.',
        },
      ],
    }
  }
  return {
    ok: true,
    value: {
      holdings: afterSales.value,
      taxState: taxSales.value.state,
      trades: pricedSales.trades,
      transactionCosts: pricedSales.sellCosts,
      realizedGainLoss: taxSales.value.realizedGainLoss,
      taxesPaid: taxSales.value.taxPaid,
      netProceeds,
    },
  }
}

function executeBuyLedger({
  holdings,
  taxState,
  buyTrades,
  transactionCosts,
}: {
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly buyTrades: readonly import('../portfolio/rebalancing').PortfolioTrade[]
  readonly transactionCosts: TransactionCostConfig | undefined
}): ValidationResult<{
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly trades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[]
  readonly transactionCosts: number
  readonly grossBuys: number
}> {
  const pricedBuys = priceTrades(buyTrades, transactionCosts)
  const afterBuys = applyExecutedTrades(holdings, pricedBuys.trades)
  if (!afterBuys.ok) return afterBuys
  return {
    ok: true,
    value: {
      holdings: afterBuys.value,
      taxState: applyTaxableBuys(taxState, pricedBuys.trades),
      trades: pricedBuys.trades,
      transactionCosts: pricedBuys.buyCosts,
      grossBuys: pricedBuys.grossBuys,
    },
  }
}

// Financial intuition: sale proceeds first pay fees and tax, then reduce
// debt. Bisection finds the smallest proportional sale that restores the
// target leverage after those frictions change equity.
function solveDebtRepayingSales({
  holdings,
  taxState,
  debt,
  targetGrossExposure,
  transactionCosts,
  tax,
}: {
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly debt: number
  readonly targetGrossExposure: number
  readonly transactionCosts: TransactionCostConfig | undefined
  readonly tax: TaxConfig | undefined
}): ValidationResult<SaleLedgerResult & { readonly debt: number }> {
  let lower = 0
  let upper = 1
  let best: (SaleLedgerResult & { readonly debt: number }) | null = null
  // Time O(60 * D), space O(D): 60 bisection steps exceed Float64 precision.
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const fraction = (lower + upper) / 2
    const sales = executeSaleLedger({
      holdings,
      taxState,
      saleTrades: createProportionalSaleTrades(holdings, fraction),
      transactionCosts,
      tax,
    })
    if (!sales.ok) return sales
    const nextDebt = debt - sales.value.netProceeds
    const snapshot = snapshotLeverage(sales.value.holdings, nextDebt)
    const achievesTarget =
      nextDebt >= -1e-10 &&
      snapshot.equity > 0 &&
      snapshot.grossLeverage !== null &&
      snapshot.grossLeverage <= targetGrossExposure + 1e-10
    if (achievesTarget) {
      best = { ...sales.value, debt: Math.max(0, nextDebt) }
      upper = fraction
    } else {
      lower = fraction
    }
  }
  return best === null
    ? {
        ok: false,
        errors: [
          {
            code: 'insolvent',
            message: 'Assets cannot be sold far enough to restore leverage.',
          },
        ],
      }
    : { ok: true, value: best }
}

// Financial intuition: a leveraged purchase raises gross assets and debt,
// while its order fee reduces equity. Bisection therefore solves the actual
// post-fee leverage instead of trusting a frictionless purchase formula.
function solveDebtFinancedBuys({
  holdings,
  taxState,
  debt,
  weights,
  targetGrossExposure,
  transactionCosts,
}: {
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly debt: number
  readonly weights: readonly number[]
  readonly targetGrossExposure: number
  readonly transactionCosts: TransactionCostConfig | undefined
}): ValidationResult<{
  readonly holdings: readonly number[]
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly trades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[]
  readonly transactionCosts: number
  readonly debt: number
}> {
  const opening = snapshotLeverage(holdings, debt)
  if (!(opening.equity > 0)) {
    return {
      ok: false,
      errors: [
        {
          code: 'insolvent',
          message: 'Equity cannot finance a leverage reset.',
        },
      ],
    }
  }
  let lower = 0
  let upper = opening.equity
  let bracketed = false
  for (let expansion = 0; expansion < 20; expansion += 1) {
    const trial = executeBuyLedger({
      holdings,
      taxState,
      buyTrades: createTargetWeightBuyTrades(weights, upper),
      transactionCosts,
    })
    if (!trial.ok) return trial
    const snapshot = snapshotLeverage(
      trial.value.holdings,
      debt + trial.value.grossBuys + trial.value.transactionCosts,
    )
    if (
      snapshot.grossLeverage !== null &&
      snapshot.grossLeverage >= targetGrossExposure
    ) {
      bracketed = true
      break
    }
    upper *= 2
  }
  if (!bracketed) {
    return {
      ok: false,
      errors: [
        {
          code: 'insolvent',
          message: 'Debt-financed buys cannot reach target leverage.',
        },
      ],
    }
  }

  let best: {
    readonly holdings: readonly number[]
    readonly taxState: ReturnType<typeof initializeTaxState>
    readonly trades: readonly import('../portfolio/transactionCosts').ExecutedPortfolioTrade[]
    readonly transactionCosts: number
    readonly debt: number
  } | null = null
  // Time O(60 * D), space O(D): the fixed iteration count is deterministic.
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const grossBuys = (lower + upper) / 2
    const trial = executeBuyLedger({
      holdings,
      taxState,
      buyTrades: createTargetWeightBuyTrades(weights, grossBuys),
      transactionCosts,
    })
    if (!trial.ok) return trial
    const nextDebt = debt + trial.value.grossBuys + trial.value.transactionCosts
    const snapshot = snapshotLeverage(trial.value.holdings, nextDebt)
    if (
      snapshot.grossLeverage !== null &&
      snapshot.grossLeverage >= targetGrossExposure
    ) {
      best = { ...trial.value, debt: nextDebt }
      upper = grossBuys
    } else {
      lower = grossBuys
    }
  }
  return best === null
    ? {
        ok: false,
        errors: [
          { code: 'insolvent', message: 'Leverage reset did not converge.' },
        ],
      }
    : { ok: true, value: best }
}

function executeLeveragedPortfolioPeriod({
  holdings,
  debt,
  taxState,
  assetReturns,
  riskFreeRate,
  cashFlow,
  initialInvestment,
  weights,
  rebalancing,
  leverage,
  periodIndex,
  transactionCosts,
  tax,
}: {
  readonly holdings: readonly number[]
  readonly debt: number
  readonly taxState: ReturnType<typeof initializeTaxState>
  readonly assetReturns: readonly number[]
  readonly riskFreeRate: number
  readonly cashFlow: import('./simulationTypes').CashFlowConfig
  readonly initialInvestment: number
  readonly weights: readonly number[]
  readonly rebalancing: RebalancingConfig | undefined
  readonly leverage: Extract<LeverageConfig, { readonly mode: 'enabled' }>
  readonly periodIndex: number
  readonly transactionCosts: TransactionCostConfig | undefined
  readonly tax: TaxConfig | undefined
}): ValidationResult<LeveragedPeriodResult> {
  const accrued = accrueDebt(debt, riskFreeRate, leverage.annualBorrowingSpread)
  if (!accrued.ok) return accrued
  let nextDebt = accrued.value.debt
  let nextHoldings: readonly number[] = applyPeriodReturn(
    holdings,
    assetReturns,
  )
  let nextTaxState = taxState
  let totalCosts = 0
  let totalGainLoss = 0
  let totalTaxes = 0
  const intendedTrades: import('../portfolio/rebalancing').PortfolioTrade[] = []
  const executedTrades: import('../portfolio/transactionCosts').ExecutedPortfolioTrade[] =
    []

  const preContribution = snapshotLeverage(nextHoldings, nextDebt)
  if (!(preContribution.equity > 0)) {
    return {
      ok: false,
      errors: [
        {
          code: 'insolvent',
          message: 'Equity is non-positive after returns and debt interest.',
        },
      ],
    }
  }
  const contribution = computeScheduledContribution(
    cashFlow,
    periodIndex,
    initialInvestment,
    preContribution.equity,
  )
  const contributionTrades = createContributionTrades(
    contribution,
    weights,
    transactionCosts,
  )
  if (!contributionTrades.ok) return contributionTrades
  const contributionBuys = executeBuyLedger({
    holdings: nextHoldings,
    taxState: nextTaxState,
    buyTrades: contributionTrades.value,
    transactionCosts,
  })
  if (!contributionBuys.ok) return contributionBuys
  nextHoldings = contributionBuys.value.holdings
  nextTaxState = contributionBuys.value.taxState
  totalCosts += contributionBuys.value.transactionCosts
  executedTrades.push(...contributionBuys.value.trades)

  let marginCall = false
  let leverageReset = false
  const afterContribution = snapshotLeverage(nextHoldings, nextDebt)
  if (requiresMarginCall(afterContribution, leverage.maintenanceMargin)) {
    const forcedSales = solveDebtRepayingSales({
      holdings: nextHoldings,
      taxState: nextTaxState,
      debt: nextDebt,
      targetGrossExposure: leverage.targetGrossExposure,
      transactionCosts,
      tax,
    })
    if (!forcedSales.ok) return forcedSales
    nextHoldings = forcedSales.value.holdings
    nextTaxState = forcedSales.value.taxState
    nextDebt = forcedSales.value.debt
    totalCosts += forcedSales.value.transactionCosts
    totalGainLoss += forcedSales.value.realizedGainLoss
    totalTaxes += forcedSales.value.taxesPaid
    intendedTrades.push(
      ...forcedSales.value.trades.map((trade) => ({
        assetIndex: trade.assetIndex,
        value: trade.value,
      })),
    )
    executedTrades.push(...forcedSales.value.trades)
    marginCall = true
  } else {
    const rebalanced = rebalancePortfolio(
      nextHoldings,
      weights,
      rebalancing,
      periodIndex,
    )
    intendedTrades.push(...rebalanced.trades)
    const rebalanceSales = executeSaleLedger({
      holdings: nextHoldings,
      taxState: nextTaxState,
      saleTrades: rebalanced.trades.filter((trade) => trade.value < 0),
      transactionCosts,
      tax,
    })
    if (!rebalanceSales.ok) return rebalanceSales
    const rebalanceBuys = fundRebalanceBuys(
      rebalanced.trades.filter((trade) => trade.value > 0),
      rebalanceSales.value.netProceeds,
      transactionCosts,
    )
    if (!rebalanceBuys.ok) return rebalanceBuys
    const executedRebalanceBuys = executeBuyLedger({
      holdings: rebalanceSales.value.holdings,
      taxState: rebalanceSales.value.taxState,
      buyTrades: rebalanceBuys.value,
      transactionCosts,
    })
    if (!executedRebalanceBuys.ok) return executedRebalanceBuys
    nextHoldings = executedRebalanceBuys.value.holdings
    nextTaxState = executedRebalanceBuys.value.taxState
    totalCosts +=
      rebalanceSales.value.transactionCosts +
      executedRebalanceBuys.value.transactionCosts
    totalGainLoss += rebalanceSales.value.realizedGainLoss
    totalTaxes += rebalanceSales.value.taxesPaid
    executedTrades.push(
      ...rebalanceSales.value.trades,
      ...executedRebalanceBuys.value.trades,
    )

    const beforeReset = snapshotLeverage(nextHoldings, nextDebt)
    if (
      isLeverageResetDue(
        leverage.reset,
        periodIndex,
        beforeReset.grossLeverage,
        leverage.targetGrossExposure,
      ) &&
      beforeReset.grossLeverage !== null
    ) {
      if (beforeReset.grossLeverage > leverage.targetGrossExposure) {
        const resetSales = solveDebtRepayingSales({
          holdings: nextHoldings,
          taxState: nextTaxState,
          debt: nextDebt,
          targetGrossExposure: leverage.targetGrossExposure,
          transactionCosts,
          tax,
        })
        if (!resetSales.ok) return resetSales
        nextHoldings = resetSales.value.holdings
        nextTaxState = resetSales.value.taxState
        nextDebt = resetSales.value.debt
        totalCosts += resetSales.value.transactionCosts
        totalGainLoss += resetSales.value.realizedGainLoss
        totalTaxes += resetSales.value.taxesPaid
        intendedTrades.push(
          ...resetSales.value.trades.map((trade) => ({
            assetIndex: trade.assetIndex,
            value: trade.value,
          })),
        )
        executedTrades.push(...resetSales.value.trades)
      } else {
        const resetBuys = solveDebtFinancedBuys({
          holdings: nextHoldings,
          taxState: nextTaxState,
          debt: nextDebt,
          weights,
          targetGrossExposure: leverage.targetGrossExposure,
          transactionCosts,
        })
        if (!resetBuys.ok) return resetBuys
        nextHoldings = resetBuys.value.holdings
        nextTaxState = resetBuys.value.taxState
        nextDebt = resetBuys.value.debt
        totalCosts += resetBuys.value.transactionCosts
        intendedTrades.push(
          ...resetBuys.value.trades.map((trade) => ({
            assetIndex: trade.assetIndex,
            value: trade.value,
          })),
        )
        executedTrades.push(...resetBuys.value.trades)
      }
      leverageReset = true
    }
  }

  const ending = snapshotLeverage(nextHoldings, nextDebt)
  if (!(ending.equity > 0) || !Number.isFinite(ending.equity)) {
    return {
      ok: false,
      errors: [
        {
          code: 'insolvent',
          message: 'Leverage accounting produced non-positive equity.',
        },
      ],
    }
  }
  return {
    ok: true,
    value: {
      holdings: nextHoldings,
      taxState: nextTaxState,
      intendedTrades,
      executedTrades,
      transactionCosts: totalCosts,
      realizedGainLoss: totalGainLoss,
      taxesPaid: totalTaxes,
      contribution,
      debt: nextDebt,
      borrowingInterest: accrued.value.borrowingInterest,
      marginCall,
      leverageReset,
    },
  }
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
