// Estimation statistics for the parametric Student's t engine (Phase 3.1).
// Every function is pure and framework-independent: plain inputs, new outputs,
// no simulation state, no React, no randomness.

// Degrees-of-freedom bounds from the README's Simulation Engines section.
// The floor keeps the fourth moment finite (a Student's t needs nu > 4 for
// kurtosis to exist) with margin; at the ceiling the t is numerically
// indistinguishable from a Gaussian in double precision.
export const MIN_DEGREES_OF_FREEDOM = 5
export const MAX_DEGREES_OF_FREEDOM = 100

// Log returns add across periods and are unbounded in both directions, which
// is what makes a symmetric elliptical model (Student's t) a defensible shape
// for them -- a simple return is floored at -100% and cannot be symmetric.
// Reads the dataset's Float32 transport column, computes in float64.
// Time O(n), Space O(n) for n observations.
export function toLogReturns(
  simpleReturns: Float32Array | readonly number[],
): Float64Array {
  const logReturns = new Float64Array(simpleReturns.length)

  for (let index = 0; index < simpleReturns.length; index += 1) {
    // l = ln(1 + r): the continuously compounded return for the period.
    logReturns[index] = Math.log(1 + simpleReturns[index])
  }

  return logReturns
}

// Arithmetic sample mean. For log returns this is the per-period drift whose
// annualization is the historical geometric return of the series.
// Time O(n), Space O(1).
export function sampleMean(values: Float64Array | readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('Sample mean requires at least one observation.')
  }

  let total = 0
  for (let index = 0; index < values.length; index += 1) {
    total += values[index]
  }

  return total / values.length
}

// Unbiased sample variance (n - 1 divisor). Time O(n), Space O(1).
export function sampleVariance(
  values: Float64Array | readonly number[],
  mean: number,
): number {
  if (values.length < 2) {
    throw new RangeError('Sample variance requires at least two observations.')
  }

  let sumOfSquares = 0
  for (let index = 0; index < values.length; index += 1) {
    const deviation = values[index] - mean
    sumOfSquares += deviation * deviation
  }

  return sumOfSquares / (values.length - 1)
}

// D x D sample covariance matrix with the unbiased n - 1 divisor:
// cov[i][j] = sum_t (x_it - mean_i)(x_jt - mean_j) / (n - 1).
// Covariance is what couples assets in the parametric engine -- it is the
// object the Cholesky factor later turns into correlated joint draws.
// Matrices in Phase 3 are plain number[][]: at D <= 6 this is a <= 36-element
// structure where readability beats any typed-array layout gain, and the
// per-period hot loop only ever touches the precomputed Cholesky factor.
// Time O(D^2 n), Space O(D^2) for D assets and n observations.
export function sampleCovarianceMatrix(
  columns: readonly (Float64Array | readonly number[])[],
): number[][] {
  if (columns.length === 0) {
    throw new RangeError('Covariance requires at least one column.')
  }

  const observationCount = columns[0].length
  for (const column of columns) {
    if (column.length !== observationCount) {
      throw new RangeError('Covariance columns must share one row count.')
    }
  }
  if (observationCount < 2) {
    throw new RangeError('Covariance requires at least two observations.')
  }

  const means = columns.map((column) => sampleMean(column))
  const dimension = columns.length
  const covariance: number[][] = []

  for (let row = 0; row < dimension; row += 1) {
    covariance.push(new Array<number>(dimension).fill(0))
  }

  // Fill the upper triangle once and mirror it: covariance is symmetric by
  // construction, so computing both triangles would double the work for the
  // same numbers.
  for (let i = 0; i < dimension; i += 1) {
    for (let j = i; j < dimension; j += 1) {
      let crossSum = 0
      for (let t = 0; t < observationCount; t += 1) {
        crossSum += (columns[i][t] - means[i]) * (columns[j][t] - means[j])
      }
      const value = crossSum / (observationCount - 1)
      covariance[i][j] = value
      covariance[j][i] = value
    }
  }

  return covariance
}

// Pooled excess kurtosis of standardized residuals, the evidence for one
// shared tail-thickness parameter nu. Each column is standardized by its OWN
// sample mean and sample standard deviation first -- otherwise a
// high-volatility asset would dominate the pooled fourth moment and drag the
// estimate toward its private tail behavior. The pooled statistic is the
// plain moment ratio gamma_2 = m4 / m2^2 - 3 over all n * D standardized
// values (population moments of the pooled sample, not per-column
// bias-corrected estimators -- documented so the independent check can
// reproduce it exactly). Time O(D n), Space O(D n) for the pooled buffer.
export function computePooledExcessKurtosis(
  columns: readonly (Float64Array | readonly number[])[],
): number {
  if (columns.length === 0) {
    throw new RangeError('Pooled kurtosis requires at least one column.')
  }

  const pooled: number[] = []

  for (const column of columns) {
    const mean = sampleMean(column)
    const standardDeviation = Math.sqrt(sampleVariance(column, mean))
    if (standardDeviation === 0) {
      throw new RangeError(
        'Pooled kurtosis requires every column to have nonzero variance.',
      )
    }

    for (let index = 0; index < column.length; index += 1) {
      // z = (x - mean) / sd: unit-scale residual, so each asset contributes
      // tail-shape information on an equal footing.
      pooled.push((column[index] - mean) / standardDeviation)
    }
  }

  let secondMoment = 0
  let fourthMoment = 0
  for (const value of pooled) {
    const squared = value * value
    secondMoment += squared
    fourthMoment += squared * squared
  }
  secondMoment /= pooled.length
  fourthMoment /= pooled.length

  // Excess kurtosis: fourth standardized moment minus the Gaussian's 3.
  // Positive means fatter tails than a normal distribution.
  return fourthMoment / (secondMoment * secondMoment) - 3
}

// Moment-matching estimator for the shared degrees of freedom: a Student's t
// with nu degrees of freedom has excess kurtosis 6 / (nu - 4) for nu > 4, so
// inverting gives nu = 4 + 6 / gamma_2. Non-positive excess kurtosis means
// the tails are no fatter than Gaussian, and nu = 100 (the effectively
// Gaussian ceiling) is used, per the README rule. Time O(1).
export function estimateDegreesOfFreedom(excessKurtosis: number): number {
  if (!Number.isFinite(excessKurtosis)) {
    throw new RangeError('Excess kurtosis must be finite.')
  }

  if (excessKurtosis <= 0) {
    return MAX_DEGREES_OF_FREEDOM
  }

  const degreesOfFreedom = 4 + 6 / excessKurtosis

  return Math.min(
    MAX_DEGREES_OF_FREEDOM,
    Math.max(MIN_DEGREES_OF_FREEDOM, degreesOfFreedom),
  )
}
