import type { DatasetIdentity, Frequency } from '../data/datasetTypes'
import type { SimulationMetrics } from '../portfolio/metrics'
import type { PortfolioTrade } from '../portfolio/rebalancing'
import type { ExecutedPortfolioTrade } from '../portfolio/transactionCosts'
import type { ValidationError, ValidationResult } from '../validation'

export const MAX_ASSET_COUNT = 6
export const MAX_PATHS = 50_000
export const MAX_YEARS = 30
export const MAX_SIMULATION_WORK = 10_000_000
export const WEIGHT_TOLERANCE = 0.0001

export type CashFlowConfig =
  | {
      readonly mode: 'lumpSum'
    }
  | {
      readonly mode: 'dca'
      readonly amount: number
    }
  | {
      readonly mode: 'valueAveraging'
      readonly targetIncrease: number
    }

export type RebalancingConfig =
  | { readonly mode: 'none' }
  | { readonly mode: 'time'; readonly everyPeriods: number }
  | { readonly mode: 'toleranceBand'; readonly percentagePoints: number }

export type TransactionCostConfig = {
  readonly fixedPerOrder: number
  readonly proportionalRate: number
}

export type TaxConfig = {
  readonly capitalGainsRate: number
  readonly initialCostBasis: number | null
}

export type SimulationConfig = {
  readonly weights: readonly number[]
  readonly initialInvestment: number
  readonly cashFlow: CashFlowConfig
  readonly rebalancing?: RebalancingConfig
  readonly transactionCosts?: TransactionCostConfig
  readonly tax?: TaxConfig
  readonly paths: number
  readonly periods: number
  readonly seed: number
}

// The aligned dataset can contain one optional benchmark column in addition
// to portfolio holdings. This projection keeps the benchmark out of weights
// while both engines still sample one joint return vector.
export type SimulationAssetSelection = {
  readonly portfolioAssetIndices: readonly number[]
  readonly benchmarkAssetIndex: number | null
}

export type PeriodScenario = {
  readonly assetReturns: readonly number[]
  readonly inflation: number
  readonly riskFreeRate: number
  // The historical row a bootstrap draw came from. `null` for engines whose
  // scenarios have no historical source row (the parametric Student's t
  // engine samples from a fitted distribution, not from history) -- an
  // explicit null rather than a -1 sentinel, so a missing row can never be
  // silently misused as an array index.
  readonly sourceRowIndex: number | null
}

export type AlgorithmVersions = {
  readonly model: string
  readonly prng: string
  readonly quantile: string
  // Which metric definitions (CAGR/IRR/volatility/Sharpe/drawdown formulas)
  // produced result.metrics -- versioned like every other rule, per the
  // Financial Rules' "include the algorithm versions in every result".
  readonly metrics: string
  readonly accounting?: string
}

export type SimulationRunMetadata = {
  readonly config: SimulationConfig
  readonly dataset: DatasetIdentity
  // The aligned dataset's common-history date axis (one ISO date per aligned
  // row). Carried so the UI can translate a bootstrap scenario's
  // sourceRowIndex back into the real historical week it was copied from --
  // sourceRowIndex indexes THIS filtered axis, not the raw released matrix,
  // so only the runner (which holds the AlignedDataset) can provide it.
  // ~13 KB for the full weekly release: negligible next to the path buffers.
  readonly datasetDates: readonly string[]
  readonly benchmarkAssetId: string | null
  readonly algorithms: AlgorithmVersions
}

export type RetainedPath = {
  readonly pathIndex: number
  readonly values: Float64Array
  // This path's external contribution per period (index 0 is always 0: the
  // initial investment is not a scheduled contribution). Value averaging
  // makes this path-dependent, so it must be recorded, not recomputed.
  readonly contributions: Float64Array
  // Cumulative price level per period (period 0 = 1), compounded from this
  // path's own jointly sampled log-inflation increments. Display-layer only:
  // real values are nominal values divided by this series, per the Financial
  // Rules' "simulate nominal, deflate for display".
  readonly priceLevels: Float64Array
  // Period 0 is always empty. Later entries preserve the canonical orders
  // that Phase 7 will price and tax; they are never inferred from balances.
  readonly trades: readonly (readonly PortfolioTrade[])[]
  // Friction changes Phase 6's intent into an executed order ledger. The
  // original intent remains above for auditability; this is the actual order
  // that changed holdings and incurred the adjacent transaction cost.
  readonly executedTrades: readonly (readonly ExecutedPortfolioTrade[])[]
  readonly transactionCosts: Float64Array
  readonly realizedGainLosses: Float64Array
  readonly taxesPaid: Float64Array
  readonly costBases: Float64Array
  readonly lossCarryforwards: Float64Array
  readonly scenarios: readonly PeriodScenario[]
}

// One canonical percentile shape, still used by core/math/quantiles.ts's
// computeQuantileSeries -- a valid, independently tested cross-sectional
// aggregate ("every path's value at period t") kept available as a building
// block (e.g. a future metrics table's terminal p10-p90 row) even though
// runSimulation no longer computes a full per-period series of it: see
// RepresentativePath below for what the chart renders instead, and LOG.MD's
// entry on why a synthetic aggregate line was replaced with real paths.
export type QuantileSeries = {
  readonly p10: Float64Array
  readonly p25: Float64Array
  readonly p50: Float64Array
  readonly p75: Float64Array
  readonly p90: Float64Array
}

// One real, actually-simulated path per terminal-wealth quantile level,
// selected by which path's OWN terminal wealth lands nearest that quantile
// -- see runSimulation.ts's selectRepresentativePaths for the selection
// rule and LOG.MD for why this replaced a cross-sectional QuantileSeries as
// the chart's data source. Because each entry is a single independent path
// chosen only by its terminal value, two entries' `values` can cross at
// intermediate periods (e.g. the p10 path can sit above the p90 path at
// period 100) -- this is expected, not a bug: p10 <= p25 <= ... <= p90 is
// only guaranteed to hold at the terminal period these paths were selected on.
export type RepresentativePath = {
  readonly quantileLevel: number
  readonly pathIndex: number
  readonly terminalWealth: number
  readonly values: Float64Array
  // Same per-path cumulative price level as RetainedPath.priceLevels, so the
  // chart's real-value display can deflate each representative trajectory by
  // ITS OWN sampled inflation path (never by an average of other paths').
  readonly priceLevels: Float64Array
}

export type SimulationFailure = {
  readonly pathIndex: number
  readonly periodIndex: number
  readonly code: string
  readonly message: string
}

export type SimulationResult = {
  readonly metadata: SimulationRunMetadata
  readonly terminalWealth: Float64Array
  // One terminal benchmark value per portfolio path. Kept without a full
  // period matrix because value-averaging makes each benchmark path unique.
  readonly benchmarkTerminalWealth: Float64Array | null
  // Cross-sectional performance metrics (Phase 4.2), computed streaming in
  // the runner's path loop -- see core/portfolio/metrics.ts for definitions.
  readonly metrics: SimulationMetrics
  readonly representativePaths: readonly RepresentativePath[]
  readonly retainedPaths: readonly RetainedPath[]
  readonly failures: readonly SimulationFailure[]
}

export function validateSimulationConfig(
  config: SimulationConfig,
  assetCount: number,
  frequency: Frequency,
): ValidationResult<SimulationConfig> {
  const errors: ValidationError[] = []

  if (
    !Number.isInteger(assetCount) ||
    assetCount < 1 ||
    assetCount > MAX_ASSET_COUNT
  ) {
    errors.push(
      error(
        'config.assets.count',
        `A simulation requires between 1 and ${MAX_ASSET_COUNT} assets.`,
      ),
    )
  }

  if (config.weights.length !== assetCount) {
    errors.push(
      error(
        'config.weights.count',
        'Provide one weight for each selected asset.',
      ),
    )
  }

  let totalWeight = 0
  for (const weight of config.weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push(
        error(
          'config.weights.values',
          'Weights must be finite and non-negative.',
        ),
      )
      break
    }

    totalWeight += weight
  }

  if (Math.abs(totalWeight - 1) > WEIGHT_TOLERANCE) {
    errors.push(
      error(
        'config.weights.total',
        'Weights must sum to 100% within 0.01 percentage points.',
      ),
    )
  }

  if (!isFiniteNonNegative(config.initialInvestment)) {
    errors.push(
      error(
        'config.initialInvestment',
        'Initial investment must be finite and non-negative.',
      ),
    )
  }

  validateCashFlow(config.cashFlow, errors)
  validatePathsAndPeriods(config.paths, config.periods, frequency, errors)
  validateRebalancing(config.rebalancing, config.periods, errors)
  validateTransactionCosts(config.transactionCosts, errors)
  validateTax(config.tax, errors)

  if (!isUint32(config.seed)) {
    errors.push(
      error('config.seed', 'Seed must be an unsigned 32-bit integer.'),
    )
  }

  return errors.length === 0
    ? { ok: true, value: config }
    : { ok: false, errors }
}

function validateRebalancing(
  rebalancing: RebalancingConfig | undefined,
  periods: number,
  errors: ValidationError[],
): void {
  if (rebalancing === undefined || rebalancing.mode === 'none') return

  if (
    rebalancing.mode === 'time' &&
    (!Number.isInteger(rebalancing.everyPeriods) ||
      rebalancing.everyPeriods < 1 ||
      rebalancing.everyPeriods > periods)
  ) {
    errors.push(
      error(
        'config.rebalancing.everyPeriods',
        'Rebalancing interval must be an integer within the simulation horizon.',
      ),
    )
  }

  if (
    rebalancing.mode === 'toleranceBand' &&
    (!Number.isFinite(rebalancing.percentagePoints) ||
      rebalancing.percentagePoints <= 0 ||
      rebalancing.percentagePoints > 100)
  ) {
    errors.push(
      error(
        'config.rebalancing.percentagePoints',
        'Tolerance band must be greater than 0 and no more than 100 percentage points.',
      ),
    )
  }
}

function validateTransactionCosts(
  transactionCosts: TransactionCostConfig | undefined,
  errors: ValidationError[],
): void {
  if (transactionCosts === undefined) return

  if (!isFiniteNonNegative(transactionCosts.fixedPerOrder)) {
    errors.push(
      error(
        'config.transactionCosts.fixedPerOrder',
        'Fixed transaction cost must be finite and non-negative.',
      ),
    )
  }

  if (!isFiniteNonNegative(transactionCosts.proportionalRate)) {
    errors.push(
      error(
        'config.transactionCosts.proportionalRate',
        'Proportional transaction cost must be finite and non-negative.',
      ),
    )
  }
}

function validateTax(
  tax: TaxConfig | undefined,
  errors: ValidationError[],
): void {
  if (tax === undefined) return

  if (
    !Number.isFinite(tax.capitalGainsRate) ||
    tax.capitalGainsRate < 0 ||
    tax.capitalGainsRate > 1
  ) {
    errors.push(
      error(
        'config.tax.capitalGainsRate',
        'Capital-gains tax rate must be finite and between 0% and 100%.',
      ),
    )
  }

  if (
    tax.initialCostBasis !== null &&
    !isFiniteNonNegative(tax.initialCostBasis)
  ) {
    errors.push(
      error(
        'config.tax.initialCostBasis',
        'Initial cost basis must be blank or a finite non-negative amount.',
      ),
    )
  }
}

function validateCashFlow(
  cashFlow: CashFlowConfig,
  errors: ValidationError[],
): void {
  if (cashFlow.mode === 'dca' && !isFiniteNonNegative(cashFlow.amount)) {
    errors.push(
      error(
        'config.cashFlow.amount',
        'DCA amount must be finite and non-negative.',
      ),
    )
  }

  if (
    cashFlow.mode === 'valueAveraging' &&
    !isFiniteNonNegative(cashFlow.targetIncrease)
  ) {
    errors.push(
      error(
        'config.cashFlow.targetIncrease',
        'Value-averaging target increase must be finite and non-negative.',
      ),
    )
  }
}

function validatePathsAndPeriods(
  paths: number,
  periods: number,
  frequency: Frequency,
  errors: ValidationError[],
): void {
  if (!Number.isInteger(paths) || paths < 1 || paths > MAX_PATHS) {
    errors.push(
      error('config.paths', `Paths must be an integer from 1 to ${MAX_PATHS}.`),
    )
  }

  const maximumPeriods = MAX_YEARS * (frequency === 'weekly' ? 52 : 12)
  if (!Number.isInteger(periods) || periods < 1 || periods > maximumPeriods) {
    errors.push(
      error(
        'config.periods',
        `Periods must be an integer from 1 to ${maximumPeriods} for ${frequency} data.`,
      ),
    )
  }

  if (
    Number.isInteger(paths) &&
    Number.isInteger(periods) &&
    paths * periods > MAX_SIMULATION_WORK
  ) {
    errors.push(
      error(
        'config.work',
        `Paths multiplied by periods cannot exceed ${MAX_SIMULATION_WORK}.`,
      ),
    )
  }
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff
}

function error(code: string, message: string): ValidationError {
  return { code, message }
}
