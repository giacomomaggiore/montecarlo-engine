import { describe, expect, it } from 'vitest'
import { nextChiSquare, nextGamma, nextStandardNormal } from './distributions'
import { createXoshiro128StarStar } from './random'

// The exact expected values below were produced by an INDEPENDENT Python
// reimplementation of xoshiro128**, Box-Muller, and Marsaglia-Tsang written
// from the README's Phase 3 prose (see validation/phase_3_independent_check.py)
// -- not by running this TypeScript module and pasting its own output back.
// They therefore guard both the draw-order contract and cross-language
// portability of the transcendental chain (log/cos/sqrt), at float64
// precision.

describe('nextStandardNormal', () => {
  it('reproduces the independent fixed-seed reference sequence', () => {
    const random = createXoshiro128StarStar(42)
    const expected = [
      1.0271775679456403, 0.1931295978853847, 0.40042869885474475,
      -0.009860904918430322,
    ]

    for (const value of expected) {
      expect(nextStandardNormal(random)).toBeCloseTo(value, 12)
    }
  })

  it('is reproducible for the same seed and diverges for different seeds', () => {
    const first = createXoshiro128StarStar(2024)
    const second = createXoshiro128StarStar(2024)
    const different = createXoshiro128StarStar(2025)

    let diverged = false
    for (let draw = 0; draw < 100; draw += 1) {
      const a = nextStandardNormal(first)
      expect(nextStandardNormal(second)).toBe(a)
      if (nextStandardNormal(different) !== a) {
        diverged = true
      }
    }
    expect(diverged).toBe(true)
  })

  it('has sample mean near 0 and variance near 1 on a fixed-seed sample', () => {
    const random = createXoshiro128StarStar(99)
    const sampleSize = 20_000
    let sum = 0
    let sumOfSquares = 0

    for (let draw = 0; draw < sampleSize; draw += 1) {
      const value = nextStandardNormal(random)
      sum += value
      sumOfSquares += value * value
    }

    const mean = sum / sampleSize
    const variance = sumOfSquares / sampleSize - mean * mean

    // Predeclared regression tolerances (~4 standard errors), not a proof of
    // asymptotic correctness.
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(Math.abs(variance - 1)).toBeLessThan(0.05)
  })
})

describe('nextGamma', () => {
  it('reproduces the independent fixed-seed reference sequence', () => {
    const random = createXoshiro128StarStar(7)
    const expected = [1.262334872889975, 1.437862963621408, 1.243335227010616]

    for (const value of expected) {
      expect(nextGamma(random, 2.5)).toBeCloseTo(value, 12)
    }
  })

  it('has sample mean near the shape parameter (unit scale)', () => {
    const random = createXoshiro128StarStar(31)
    const shape = 3
    const sampleSize = 20_000
    let sum = 0

    for (let draw = 0; draw < sampleSize; draw += 1) {
      sum += nextGamma(random, shape)
    }

    // Gamma(shape, 1) has mean = shape and variance = shape; 4 standard
    // errors at n = 20,000 is about 0.05.
    expect(Math.abs(sum / sampleSize - shape)).toBeLessThan(0.06)
  })

  it('rejects shapes below 1, where Marsaglia-Tsang does not apply', () => {
    const random = createXoshiro128StarStar(1)
    expect(() => nextGamma(random, 0.5)).toThrow(RangeError)
    expect(() => nextGamma(random, Number.NaN)).toThrow(RangeError)
  })
})

describe('nextChiSquare', () => {
  it('reproduces the independent fixed-seed reference sequence', () => {
    const random = createXoshiro128StarStar(123)
    const expected = [1.2090457563564119, 8.212813485132747, 8.107183878627787]

    for (const value of expected) {
      expect(nextChiSquare(random, 5)).toBeCloseTo(value, 12)
    }
  })

  it('has sample mean near the degrees of freedom', () => {
    const random = createXoshiro128StarStar(77)
    const degreesOfFreedom = 5
    const sampleSize = 20_000
    let sum = 0

    for (let draw = 0; draw < sampleSize; draw += 1) {
      sum += nextChiSquare(random, degreesOfFreedom)
    }

    // chi2(k) has mean k and variance 2k; 4 standard errors ~ 0.09.
    expect(Math.abs(sum / sampleSize - degreesOfFreedom)).toBeLessThan(0.1)
  })

  it('rejects degrees of freedom below 2', () => {
    const random = createXoshiro128StarStar(1)
    expect(() => nextChiSquare(random, 1.5)).toThrow(RangeError)
  })
})
