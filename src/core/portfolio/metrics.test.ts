import { describe, expect, it } from 'vitest'
import {
  computeAnnualizedIrr,
  computeCagr,
  computeTerminalWealthPercentiles,
  createPathMetricsAccumulator,
  METRICS_VERSION,
  summarizeAcrossPaths,
} from './metrics'

// Expected values below are recomputed from the raw textbook definitions
// (explicit deviations from the mean, closed-form roots), i.e. by a DIFFERENT
// algebraic route than the implementation's streaming sum/sumSq identity —
// so a slip in either formulation breaks the match.

describe('METRICS_VERSION', () => {
  it('is the versioned identifier carried into result metadata', () => {
    expect(METRICS_VERSION).toBe('metrics-v1')
  })
})

describe('createPathMetricsAccumulator', () => {
  it('computes annualized volatility, Sharpe, and max drawdown for a hand-checked 3-period path', () => {
    const accumulator = createPathMetricsAccumulator(52)
    // Neutral returns 10%, -5%, +2% against a constant 1% risk-free rate.
    accumulator.recordPeriod(0, 0.1, 0.01)
    accumulator.recordPeriod(0, -0.05, 0.01)
    accumulator.recordPeriod(0, 0.02, 0.01)
    const metrics = accumulator.finish()

    // Deviation-form sample variance (ddof = 1), the spreadsheet VAR.S route:
    const mean = (0.1 - 0.05 + 0.02) / 3
    const variance =
      ((0.1 - mean) ** 2 + (-0.05 - mean) ** 2 + (0.02 - mean) ** 2) / 2
    expect(metrics.annualizedVolatility).toBeCloseTo(
      Math.sqrt(variance) * Math.sqrt(52),
      12,
    )

    // Excess returns are the same series shifted by the constant 1%, so the
    // standard deviation is identical and only the mean moves — a useful
    // internal cross-check of the two parallel sum pairs.
    const excessMean = (0.09 - 0.06 + 0.01) / 3
    expect(metrics.sharpeRatio).toBeCloseTo(
      (excessMean / Math.sqrt(variance)) * Math.sqrt(52),
      12,
    )

    // Unitized index: 1.1, then 1.1*0.95 = 1.045 (5% below the 1.1 peak),
    // then 1.045*1.02 = 1.0659 (3.1% below peak). Deepest trough: 5%.
    expect(metrics.maxDrawdown).toBeCloseTo(0.05, 12)
  })

  it('ignores contributions in the drawdown and volatility, but sums them for loss probability', () => {
    const withContributions = createPathMetricsAccumulator(52)
    const withoutContributions = createPathMetricsAccumulator(52)
    for (const [neutral, rf] of [
      [0.1, 0.01],
      [-0.05, 0.01],
    ] as const) {
      withContributions.recordPeriod(500, neutral, rf)
      withoutContributions.recordPeriod(0, neutral, rf)
    }
    const a = withContributions.finish()
    const b = withoutContributions.finish()

    // External cash must never look like investment performance: identical
    // neutral-return series => identical risk metrics regardless of flows.
    expect(a.annualizedVolatility).toBe(b.annualizedVolatility)
    expect(a.sharpeRatio).toBe(b.sharpeRatio)
    expect(a.maxDrawdown).toBe(b.maxDrawdown)
    expect(a.totalContributions).toBe(1000)
    expect(b.totalContributions).toBe(0)
  })

  it('returns NaN volatility and Sharpe for a single-period path (ddof = 1 needs two observations)', () => {
    const accumulator = createPathMetricsAccumulator(52)
    accumulator.recordPeriod(0, 0.05, 0.01)
    const metrics = accumulator.finish()
    expect(Number.isNaN(metrics.annualizedVolatility)).toBe(true)
    expect(Number.isNaN(metrics.sharpeRatio)).toBe(true)
  })

  it('returns NaN Sharpe (never Infinity) when excess returns have zero variance', () => {
    const accumulator = createPathMetricsAccumulator(52)
    accumulator.recordPeriod(0, 0.01, 0.01)
    accumulator.recordPeriod(0, 0.01, 0.01)
    const metrics = accumulator.finish()
    expect(metrics.annualizedVolatility).toBe(0)
    expect(Number.isNaN(metrics.sharpeRatio)).toBe(true)
  })
})

describe('computeCagr', () => {
  it('matches the hand calculation for a doubling over ten years', () => {
    // (2000/1000)^(1/10) - 1 = 2^0.1 - 1
    expect(computeCagr(1000, 2000, 10)).toBeCloseTo(2 ** 0.1 - 1, 12)
  })

  it('is NaN for a wiped-out, failed, or unfunded path', () => {
    expect(Number.isNaN(computeCagr(1000, 0, 10))).toBe(true)
    expect(Number.isNaN(computeCagr(1000, NaN, 10))).toBe(true)
    expect(Number.isNaN(computeCagr(0, 2000, 10))).toBe(true)
  })
})

describe('computeAnnualizedIrr', () => {
  it('matches the closed-form root of a two-contribution schedule', () => {
    // CF = [-100, -100, +210] at periodsPerYear = 1. In x = 1/(1+r):
    // 210 x^2 - 100 x - 100 = 0  =>  x = (100 + sqrt(94000)) / 420,
    // the single positive root Descartes' rule guarantees.
    const x = (100 + Math.sqrt(94_000)) / 420
    const expected = 1 / x - 1
    expect(computeAnnualizedIrr([-100, -100, 210], 1)).toBeCloseTo(expected, 10)
  })

  it('annualizes the periodic rate geometrically', () => {
    // One outflow of 1000, terminal 1210 after 104 weekly periods (2 years):
    // periodic r solves 1000 (1+r)^104 = 1210, so the ANNUAL rate is
    // (1210/1000)^(52/104) - 1 = sqrt(1.21) - 1 = 10% exactly.
    const cashFlows = new Array<number>(105).fill(0)
    cashFlows[0] = -1000
    cashFlows[104] = 1210
    expect(computeAnnualizedIrr(cashFlows, 52)).toBeCloseTo(0.1, 8)
  })

  it('equals CAGR for a lump-sum-shaped schedule (the money-weighted/time-weighted identity)', () => {
    const cashFlows = new Array<number>(521).fill(0)
    cashFlows[0] = -10_000
    cashFlows[520] = 17_500
    const irr = computeAnnualizedIrr(cashFlows, 52)
    const cagr = computeCagr(10_000, 17_500, 10)
    expect(irr).toBeCloseTo(cagr, 8)
  })

  it('finds the strongly negative root of a losing schedule (still admissible)', () => {
    const irr = computeAnnualizedIrr([-100, -100, 50], 1)
    expect(Number.isFinite(irr)).toBe(true)
    expect(irr).toBeLessThan(0)
    expect(irr).toBeGreaterThan(-1)
  })

  it('is NaN when no admissible root exists (money only ever flowed in)', () => {
    expect(Number.isNaN(computeAnnualizedIrr([-100, -100, 0], 1))).toBe(true)
    expect(Number.isNaN(computeAnnualizedIrr([0, 0, 0], 1))).toBe(true)
    expect(Number.isNaN(computeAnnualizedIrr([-100, NaN, 50], 1))).toBe(true)
  })
})

describe('summarizeAcrossPaths', () => {
  it('excludes NaN paths and reports the honest available count', () => {
    const summary = summarizeAcrossPaths(new Float64Array([3, NaN, 1, 2]))
    expect(summary).not.toBeNull()
    // Sorted finite cross-section [1, 2, 3]: h = (3-1)q gives
    // p10 -> h = 0.2 -> 1.2; p50 -> 2; p90 -> h = 1.8 -> 2.8.
    expect(summary?.p10).toBeCloseTo(1.2, 12)
    expect(summary?.p50).toBe(2)
    expect(summary?.p90).toBeCloseTo(2.8, 12)
    expect(summary?.availablePathCount).toBe(3)
  })

  it('is null when no path produced a defined value', () => {
    expect(summarizeAcrossPaths(new Float64Array([NaN, NaN]))).toBeNull()
  })
})

describe('computeTerminalWealthPercentiles', () => {
  it('matches the hand-checked five-value interpolation', () => {
    const percentiles = computeTerminalWealthPercentiles(
      new Float64Array([5000, 1000, 3000, 2000, 4000]),
    )
    // Sorted [1000..5000], h = 4q: p10 -> h = 0.4 -> 1400; p25 -> h = 1 ->
    // 2000; p50 -> 3000; p75 -> 4000; p90 -> h = 3.6 -> 4600.
    expect(percentiles).toEqual({
      p10: 1400,
      p25: 2000,
      p50: 3000,
      p75: 4000,
      p90: 4600,
    })
  })

  it('is null when every path failed', () => {
    expect(computeTerminalWealthPercentiles(new Float64Array([NaN]))).toBeNull()
  })
})
