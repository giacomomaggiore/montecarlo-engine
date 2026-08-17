import { describe, expect, it } from 'vitest'
import {
  computeQuantile,
  computeQuantileSeries,
  QUANTILE_VERSION,
} from './quantiles'

describe('computeQuantile', () => {
  it('reports its versioned identifier', () => {
    expect(QUANTILE_VERSION).toBe('quantile-linear-interpolation-v1')
  })

  it('returns the only value for a single-element sample', () => {
    expect(computeQuantile([42], 0.5)).toBe(42)
  })

  it('returns an exact order statistic when h is an integer', () => {
    // n=5, q=0.5 -> h = 4 * 0.5 = 2 -> the third value exactly, no interpolation
    const values = [10, 20, 30, 40, 50]
    expect(computeQuantile(values, 0.5)).toBe(30)
  })

  it('interpolates linearly between order statistics when h is fractional', () => {
    // n=4, q=0.25 -> h = 3 * 0.25 = 0.75 -> 3/4 of the way from values[0] to values[1]
    const values = [10, 20, 30, 40]
    expect(computeQuantile(values, 0.25)).toBeCloseTo(17.5)
  })

  it('matches a hand-checked textbook example for p10 and p90', () => {
    // n=10, q=0.1 -> h = 9 * 0.1 = 0.9 -> between values[0] and values[1]
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(computeQuantile(values, 0.1)).toBeCloseTo(1.9)
    // q=0.9 -> h = 9 * 0.9 = 8.1 -> between values[8] and values[9]
    expect(computeQuantile(values, 0.9)).toBeCloseTo(9.1)
  })
})

describe('computeQuantileSeries', () => {
  it('aggregates across paths at each period, not across one path over time', () => {
    // Period 0: all paths start at 1000. Period 1: five distinct outcomes.
    const periodSamples = [
      [1000, 1000, 1000, 1000, 1000],
      [900, 950, 1000, 1050, 1100],
    ]

    const series = computeQuantileSeries(periodSamples)

    expect(series.p50[0]).toBe(1000)
    expect(series.p50[1]).toBe(1000)
    // n=5, q=0.1 -> h=0.4 -> 900 + 0.4*(950-900) = 920
    expect(series.p10[1]).toBeCloseTo(920)
    // q=0.9 -> h=3.6 -> 1050 + 0.6*(1100-1050) = 1080
    expect(series.p90[1]).toBeCloseTo(1080)
  })

  it('ignores non-finite entries instead of treating them as zero', () => {
    const periodSamples = [[100, 200, NaN, 300, 400]]

    const series = computeQuantileSeries(periodSamples)

    // The NaN is dropped, so the median of [100, 200, 300, 400] is used
    expect(series.p50[0]).toBeCloseTo(250)
  })
})
