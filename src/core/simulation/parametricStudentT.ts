// Parametric Student's t scenario engine (Phase 3.4). Fits a multivariate
// Student's t distribution to the aligned dataset's periodic log returns,
// then samples joint scenarios from it behind the exact same
// SimulationEngine boundary the historical bootstrap uses -- runSimulation
// and the portfolio accounting loop are reused byte-for-byte unchanged.
//
// Model identity: this version string covers the entire deterministic chain
// -- the estimation rules in core/math/statistics.ts, the repair/factor
// rules in core/math/matrix.ts, the Box-Muller/Marsaglia-Tsang samplers in
// core/math/distributions.ts, and the per-scenario draw order defined in
// createParametricStudentTEngine below. Changing any of them changes every
// seed's output and requires a version bump plus new reference vectors.

import type { AlignedDataset } from '../data/datasetTypes'
import { nextChiSquare, nextStandardNormal } from '../math/distributions'
import {
  choleskyDecompose,
  correlationToCovariance,
  covarianceToCorrelation,
  nearestCorrelationMatrix,
} from '../math/matrix'
import { createXoshiro128StarStar } from '../math/random'
import {
  MAX_DEGREES_OF_FREEDOM,
  MIN_DEGREES_OF_FREEDOM,
  computePooledExcessKurtosis,
  estimateDegreesOfFreedom,
  sampleCovarianceMatrix,
  sampleMean,
  toLogReturns,
} from '../math/statistics'
import type { ValidationError, ValidationResult } from '../validation'
import type { SimulationEngine } from './simulationEngine'
import type { PeriodScenario } from './simulationTypes'

export const PARAMETRIC_STUDENT_T_MODEL_VERSION = 'parametric-student-t-v1'

// A correlation entry moved by more than this during Higham repair counts as
// "the repair actually changed something" in the fit diagnostics --
// comfortably above the algorithm's own convergence tolerance, comfortably
// below any economically meaningful correlation change.
const REPAIR_CHANGE_TOLERANCE = 1e-9

export type ParametricStudentTOptions = {
  // Per the Financial Rules, parametric mode uses user-entered constants for
  // inflation and the risk-free rate, not sampled history.
  readonly annualInflation: number
  readonly annualRiskFreeRate: number
  // Optional per-asset annual geometric return overrides (one per asset, in
  // dataset assetIds order). Absent means "use historical means".
  readonly annualGeometricReturns?: readonly number[]
  // Optional manual degrees of freedom. Absent means "estimate from pooled
  // excess kurtosis". Validated to the same [5, 100] range as the estimator.
  readonly degreesOfFreedom?: number
}

export type ParametricStudentTModel = {
  // Per-period location (drift) of the log-return distribution, one entry
  // per asset in dataset order.
  readonly location: readonly number[]
  // Lower-triangular Cholesky factor of the REPAIRED Student's t scale
  // matrix S -- the one matrix the per-scenario hot loop touches.
  readonly choleskyFactor: readonly (readonly number[])[]
  readonly degreesOfFreedom: number
  // Constant per-period values, unit-matched to the dataset columns they
  // stand in for: inflation as a per-period LOG increment (the CPI column
  // ships log increments), the risk-free rate as an effective per-period
  // SIMPLE rate (the risk-free column ships simple returns).
  readonly periodInflation: number
  readonly periodRiskFreeRate: number
  readonly diagnostics: {
    readonly pooledExcessKurtosis: number
    readonly correlationWasRepaired: boolean
  }
}

// Pure fit: already-validated AlignedDataset + user options -> frozen model,
// or structured errors. Fitting is separated from sampling so every
// numerical failure (bad option, degenerate covariance, Cholesky failure)
// surfaces as a ValidationResult BEFORE any Worker loop starts, and so the
// fit is testable without drawing a single sample.
// Time O(D^2 n + D^3) for D assets and n observations; Space O(D n).
export function fitParametricStudentT(
  dataset: AlignedDataset,
  options: ParametricStudentTOptions,
): ValidationResult<ParametricStudentTModel> {
  const optionErrors = validateOptions(options, dataset.assetIds.length)
  if (optionErrors.length > 0) {
    return { ok: false, errors: optionErrors }
  }

  // Fit on log returns: they add across periods and are unbounded in both
  // directions, which is what makes the symmetric elliptical t defensible.
  const logReturnColumns = dataset.assetReturns.map((column) =>
    toLogReturns(column),
  )
  const periodsPerYear = dataset.identity.frequency === 'weekly' ? 52 : 12

  // Location: historical sample mean per asset (the drift whose
  // annualization IS the historical geometric return), unless the user
  // entered an annual geometric return g, which becomes ln(1+g)/p.
  const location = logReturnColumns.map((column, assetIndex) => {
    const override = options.annualGeometricReturns?.[assetIndex]
    return override === undefined
      ? sampleMean(column)
      : Math.log(1 + override) / periodsPerYear
  })

  // Covariance ALWAYS comes from the aligned data (the frontend spec
  // deliberately exposes no editable matrix): a return override moves the
  // distribution without reshaping it.
  const covariance = sampleCovarianceMatrix(logReturnColumns)
  for (let assetIndex = 0; assetIndex < covariance.length; assetIndex += 1) {
    if (!(covariance[assetIndex][assetIndex] > 0)) {
      return {
        ok: false,
        errors: [
          {
            code: 'parametric.fit.zeroVariance',
            message: `Asset ${dataset.assetIds[assetIndex]} has zero log-return variance; a Student's t model cannot be fitted to a constant series.`,
          },
        ],
      }
    }
  }

  // One shared tail parameter, estimated from pooled standardized residuals
  // -- or the user's manual value, validated to the same [5, 100] range.
  const pooledExcessKurtosis = computePooledExcessKurtosis(logReturnColumns)
  const degreesOfFreedom =
    options.degreesOfFreedom ?? estimateDegreesOfFreedom(pooledExcessKurtosis)

  // Scale conversion: a t_nu with scale S has covariance S * nu / (nu - 2),
  // so S = Sigma * (nu - 2) / nu makes the simulated covariance match the
  // measured Sigma instead of overstating it by the tail factor.
  const scaleFactor = (degreesOfFreedom - 2) / degreesOfFreedom
  const scaleMatrix = covariance.map((row) =>
    row.map((value) => value * scaleFactor),
  )

  // Repair in correlation space, preserving per-asset scale: split S into
  // correlation and standard deviations, run Higham's nearest-correlation
  // algorithm on the correlation only, reassemble with the untouched
  // standard deviations.
  const { correlation, standardDeviations } =
    covarianceToCorrelation(scaleMatrix)
  const repairResult = nearestCorrelationMatrix(correlation)
  if (!repairResult.ok) {
    return repairResult
  }

  let correlationWasRepaired = false
  for (let i = 0; i < correlation.length && !correlationWasRepaired; i += 1) {
    for (let j = 0; j < correlation.length; j += 1) {
      if (
        Math.abs(repairResult.value[i][j] - correlation[i][j]) >
        REPAIR_CHANGE_TOLERANCE
      ) {
        correlationWasRepaired = true
        break
      }
    }
  }

  const repairedScale = correlationToCovariance(
    repairResult.value,
    standardDeviations,
  )
  const choleskyResult = choleskyDecompose(repairedScale)
  if (!choleskyResult.ok) {
    // A repaired matrix can still legitimately fail here: Higham's answer
    // may sit exactly ON the PSD boundary (a zero eigenvalue), which is not
    // factorable. That is an explicit run failure, never a silently
    // regularized matrix, per the Financial Rules.
    return choleskyResult
  }

  return {
    ok: true,
    value: {
      location,
      choleskyFactor: choleskyResult.value,
      degreesOfFreedom,
      // Annual -> per-period, unit-matched to the dataset columns (see the
      // model type's field comments): inflation as the log increment
      // ln(1 + pi)/p, the risk-free rate geometrically de-annualized to an
      // effective simple rate (1 + rf)^(1/p) - 1.
      periodInflation: Math.log(1 + options.annualInflation) / periodsPerYear,
      periodRiskFreeRate:
        Math.pow(1 + options.annualRiskFreeRate, 1 / periodsPerYear) - 1,
      diagnostics: { pooledExcessKurtosis, correlationWasRepaired },
    },
  }
}

// Sampling factory: one private deterministic generator per engine, exactly
// like the bootstrap factory. The per-scenario draw order is a contract:
// z_1..z_D standard normals in asset order first, then one chi-square --
// documented in the README's Phase 3.4 plan and reproduced verbatim by the
// independent Python check.
export function createParametricStudentTEngine(
  model: ParametricStudentTModel,
  seed: number,
): SimulationEngine {
  const random = createXoshiro128StarStar(seed)
  const dimension = model.location.length

  // Per scenario: O(D) draws + O(D^2) for the triangular multiply -- the
  // whole point of factoring once at fit time. Space O(D) per call (fresh
  // arrays, never a reused mutable buffer, matching the bootstrap's
  // isolation rule).
  function nextScenario(): PeriodScenario {
    const normals: number[] = []
    for (let index = 0; index < dimension; index += 1) {
      normals.push(nextStandardNormal(random))
    }

    // The t's mixing variable: dividing the whole Gaussian vector by
    // sqrt(chi2/nu) stretches ALL assets together in a fat-tailed period --
    // the joint-crash behavior independent per-asset t draws would miss.
    const chiSquare = nextChiSquare(random, model.degreesOfFreedom)
    const tailMultiplier = Math.sqrt(model.degreesOfFreedom / chiSquare)

    const assetReturns: number[] = []
    for (let i = 0; i < dimension; i += 1) {
      // L * z builds the correlated Gaussian body (lower-triangular, so
      // only j <= i contribute)...
      let correlated = 0
      for (let j = 0; j <= i; j += 1) {
        correlated += model.choleskyFactor[i][j] * normals[j]
      }
      // ...then l = mu + (L z) * sqrt(nu/chi2) is the joint log return, and
      // expm1 converts back to the simple return accounting expects.
      // e^l - 1 > -1 always, so the dataset's -100% floor holds by
      // construction.
      assetReturns.push(
        Math.expm1(model.location[i] + correlated * tailMultiplier),
      )
    }

    return {
      assetReturns,
      inflation: model.periodInflation,
      riskFreeRate: model.periodRiskFreeRate,
      // A sampled scenario has no historical source row.
      sourceRowIndex: null,
    }
  }

  return { nextScenario }
}

function validateOptions(
  options: ParametricStudentTOptions,
  assetCount: number,
): ValidationError[] {
  const errors: ValidationError[] = []

  // Both annual rates must be finite and above -100%: the log/geometric
  // de-annualizations below are undefined at or beyond that boundary.
  if (
    !Number.isFinite(options.annualInflation) ||
    options.annualInflation <= -1
  ) {
    errors.push({
      code: 'parametric.options.annualInflation',
      message: 'Annual inflation must be a finite rate above -100%.',
    })
  }

  if (
    !Number.isFinite(options.annualRiskFreeRate) ||
    options.annualRiskFreeRate <= -1
  ) {
    errors.push({
      code: 'parametric.options.annualRiskFreeRate',
      message: 'Annual risk-free rate must be a finite rate above -100%.',
    })
  }

  if (options.annualGeometricReturns !== undefined) {
    if (options.annualGeometricReturns.length !== assetCount) {
      errors.push({
        code: 'parametric.options.annualGeometricReturns.count',
        message: 'Provide one annual geometric return per selected asset.',
      })
    } else if (
      options.annualGeometricReturns.some(
        (value) => !Number.isFinite(value) || value <= -1,
      )
    ) {
      errors.push({
        code: 'parametric.options.annualGeometricReturns.values',
        message: 'Annual geometric returns must be finite rates above -100%.',
      })
    }
  }

  if (
    options.degreesOfFreedom !== undefined &&
    (!Number.isFinite(options.degreesOfFreedom) ||
      options.degreesOfFreedom < MIN_DEGREES_OF_FREEDOM ||
      options.degreesOfFreedom > MAX_DEGREES_OF_FREEDOM)
  ) {
    errors.push({
      code: 'parametric.options.degreesOfFreedom',
      message: `Manual degrees of freedom must be between ${MIN_DEGREES_OF_FREEDOM} and ${MAX_DEGREES_OF_FREEDOM}.`,
    })
  }

  return errors
}
