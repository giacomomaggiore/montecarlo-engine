import type { DatasetIdentity, Frequency } from '../data/datasetTypes'
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

export type SimulationConfig = {
  readonly weights: readonly number[]
  readonly initialInvestment: number
  readonly cashFlow: CashFlowConfig
  readonly paths: number
  readonly periods: number
  readonly seed: number
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
}

export type SimulationRunMetadata = {
  readonly config: SimulationConfig
  readonly dataset: DatasetIdentity
  readonly algorithms: AlgorithmVersions
}

export type RetainedPath = {
  readonly pathIndex: number
  readonly values: Float64Array
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

  if (!isUint32(config.seed)) {
    errors.push(
      error('config.seed', 'Seed must be an unsigned 32-bit integer.'),
    )
  }

  return errors.length === 0
    ? { ok: true, value: config }
    : { ok: false, errors }
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
