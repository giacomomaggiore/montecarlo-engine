import { describe, expect, it } from 'vitest'
import {
  MAX_DEGREES_OF_FREEDOM,
  MIN_DEGREES_OF_FREEDOM,
  computePooledExcessKurtosis,
  estimateDegreesOfFreedom,
  sampleCovarianceMatrix,
  sampleMean,
  sampleVariance,
  toLogReturns,
} from './statistics'

describe('toLogReturns', () => {
  it('maps each simple return through ln(1 + r)', () => {
    // Plain number[] input: no Float32 rounding involved, so the comparison
    // against the float64 literals can be exact-precision.
    const logReturns = toLogReturns([0.05, -0.02, 0])

    expect(logReturns[0]).toBeCloseTo(Math.log(1.05), 12)
    expect(logReturns[1]).toBeCloseTo(Math.log(0.98), 12)
    expect(logReturns[2]).toBe(0)
  })

  it('reads Float32 transport values exactly as stored', () => {
    // 0.05 is not representable in Float32; the conversion must use the
    // rounded value the typed array actually holds, not the decimal literal.
    const stored = new Float32Array([0.05])[0]
    expect(toLogReturns(new Float32Array([0.05]))[0]).toBe(Math.log(1 + stored))
  })
})

describe('sampleMean and sampleVariance', () => {
  it('matches hand arithmetic', () => {
    const values = [1, 2, 3, 4]
    const mean = sampleMean(values)

    expect(mean).toBe(2.5)
    // (2.25 + 0.25 + 0.25 + 2.25) / 3 = 5/3, the unbiased n - 1 divisor.
    expect(sampleVariance(values, mean)).toBeCloseTo(5 / 3, 12)
  })

  it('rejects empty and single-observation samples', () => {
    expect(() => sampleMean([])).toThrow(RangeError)
    expect(() => sampleVariance([1], 1)).toThrow(RangeError)
  })
})

describe('sampleCovarianceMatrix', () => {
  it('matches a hand-calculated two-column example', () => {
    // x = [1,2,3] (mean 2), y = [2,4,7] (mean 13/3):
    // var(x) = (1 + 0 + 1) / 2 = 1
    // var(y) = (49/9 + 1/9 + 64/9) / 2 = 57/9
    // cov(x,y) = (7/3 + 0 + 8/3) / 2 = 2.5
    const covariance = sampleCovarianceMatrix([
      [1, 2, 3],
      [2, 4, 7],
    ])

    expect(covariance[0][0]).toBeCloseTo(1, 12)
    expect(covariance[1][1]).toBeCloseTo(57 / 9, 12)
    expect(covariance[0][1]).toBeCloseTo(2.5, 12)
    expect(covariance[1][0]).toBe(covariance[0][1])
  })

  it('rejects mismatched column lengths and short samples', () => {
    expect(() => sampleCovarianceMatrix([[1, 2], [1]])).toThrow(RangeError)
    expect(() => sampleCovarianceMatrix([[1], [2]])).toThrow(RangeError)
    expect(() => sampleCovarianceMatrix([])).toThrow(RangeError)
  })
})

describe('computePooledExcessKurtosis', () => {
  it('matches a hand-calculated single-column example', () => {
    // x = [-2,-1,1,2], mean 0, sample variance 10/3.
    // z^2 values: x^2 / (10/3), so m2 = 2.5 / (10/3) = 0.75 and
    // m4 = 8.5 / (100/9) = 0.765; gamma_2 = 0.765 / 0.5625 - 3 = -1.64.
    const kurtosis = computePooledExcessKurtosis([[-2, -1, 1, 2]])

    expect(kurtosis).toBeCloseTo(-1.64, 12)
  })

  it('pools standardized residuals so scale does not matter', () => {
    // The second column is the first scaled by 1000: after per-column
    // standardization both contribute identical z values, so the pooled
    // kurtosis equals the single-column value.
    const single = computePooledExcessKurtosis([[-2, -1, 1, 2]])
    const pooled = computePooledExcessKurtosis([
      [-2, -1, 1, 2],
      [-2000, -1000, 1000, 2000],
    ])

    expect(pooled).toBeCloseTo(single, 12)
  })

  it('rejects a zero-variance column', () => {
    expect(() => computePooledExcessKurtosis([[1, 1, 1]])).toThrow(RangeError)
  })
})

describe('estimateDegreesOfFreedom', () => {
  it('returns the Gaussian ceiling for non-positive excess kurtosis', () => {
    expect(estimateDegreesOfFreedom(0)).toBe(MAX_DEGREES_OF_FREEDOM)
    expect(estimateDegreesOfFreedom(-1.5)).toBe(MAX_DEGREES_OF_FREEDOM)
  })

  it('inverts the t kurtosis formula for interior values', () => {
    // gamma_2 = 0.5 -> nu = 4 + 6 / 0.5 = 16.
    expect(estimateDegreesOfFreedom(0.5)).toBe(16)
  })

  it('clamps to the [5, 100] range at both ends', () => {
    // gamma_2 = 10 -> 4.6, below the floor.
    expect(estimateDegreesOfFreedom(10)).toBe(MIN_DEGREES_OF_FREEDOM)
    // gamma_2 = 6 maps exactly onto the floor.
    expect(estimateDegreesOfFreedom(6)).toBe(MIN_DEGREES_OF_FREEDOM)
    // gamma_2 = 0.05 -> 124, above the ceiling.
    expect(estimateDegreesOfFreedom(0.05)).toBe(MAX_DEGREES_OF_FREEDOM)
  })

  it('rejects non-finite input', () => {
    expect(() => estimateDegreesOfFreedom(Number.NaN)).toThrow(RangeError)
  })
})
