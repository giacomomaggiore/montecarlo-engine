import { describe, expect, it } from 'vitest'
import type {
  RepresentativePath,
  SimulationResult,
} from '../core/simulation/simulationTypes'
import { toChartData } from './chartData'

function representativePath(
  quantileLevel: number,
  pathIndex: number,
  values: number[],
  priceLevels?: number[],
): RepresentativePath {
  return {
    quantileLevel,
    pathIndex,
    terminalWealth: values[values.length - 1],
    values: new Float64Array(values),
    priceLevels: new Float64Array(priceLevels ?? values.map(() => 1)),
  }
}

function resultWithPaths(
  periods: number,
  representativePaths: readonly RepresentativePath[],
): SimulationResult {
  return {
    metadata: {
      config: {
        weights: [1],
        initialInvestment: 1,
        cashFlow: { mode: 'lumpSum' },
        paths: 1,
        periods,
        seed: 0,
      },
      dataset: {
        version: 'v',
        checksum: 'c',
        frequency: 'weekly',
        baseCurrency: 'USD',
      },
      datasetDates: ['2020-01-05'],
      benchmarkAssetId: null,
      algorithms: { model: 'm', prng: 'p', quantile: 'q', metrics: 'x' },
    },
    terminalWealth: new Float64Array(
      representativePaths.map((path) => path.terminalWealth),
    ),
    benchmarkTerminalWealth: null,
    metrics: {
      terminalWealth: null,
      lossProbability: 0,
      ruinProbability: 0,
      growth: { kind: 'cagr', summary: null },
      annualizedVolatility: null,
      sharpeRatio: null,
      maxDrawdown: null,
      transactionCosts: null,
      realizedGainLoss: null,
      taxesPaid: null,
      lossCarryforward: null,
      benchmark: null,
    },
    representativePaths,
    retainedPaths: [],
    failures: [],
  }
}

describe('toChartData', () => {
  it('builds a 0..periods index axis from config, independent of representativePaths length', () => {
    const result = resultWithPaths(2, [representativePath(0.5, 0, [1, 2, 3])])
    const chartData = toChartData(result)
    expect(Array.from(chartData.periods)).toEqual([0, 1, 2])
  })

  it('builds the axis correctly even when every path failed (no representative paths)', () => {
    const result = resultWithPaths(2, [])
    const chartData = toChartData(result)
    expect(Array.from(chartData.periods)).toEqual([0, 1, 2])
    expect(chartData.representativePaths).toEqual([])
  })

  it('passes representativePaths through unchanged, preserving their order', () => {
    const p10 = representativePath(0.1, 4, [1000, 900, 950])
    const p50 = representativePath(0.5, 7, [1000, 1050, 1100])
    const p90 = representativePath(0.9, 2, [1000, 1300, 1500])
    const result = resultWithPaths(2, [p10, p50, p90])

    const chartData = toChartData(result)

    expect(chartData.representativePaths).toEqual([p10, p50, p90])
  })

  it('deflates each path by its OWN price level in real mode, leaving nominal arrays untouched', () => {
    // 10% cumulative inflation by period 2 on this path: a nominal 1100 is
    // only worth 1000 in period-0 purchasing power.
    const path = representativePath(0.5, 0, [1000, 1050, 1100], [1, 1.05, 1.1])
    const result = resultWithPaths(2, [path])

    const real = toChartData(result, 'real')
    const realValues = Array.from(real.representativePaths[0].values)
    // Binary floating point makes 1100/1.1 land one ulp below 1000, so the
    // comparison is per-element toBeCloseTo, not exact equality.
    realValues.forEach((value) => expect(value).toBeCloseTo(1000, 10))
    // The nominal source array must never be mutated by the display-layer
    // division (the user can toggle back).
    expect(Array.from(path.values)).toEqual([1000, 1050, 1100])
    expect(toChartData(result, 'nominal').representativePaths[0]).toBe(path)
  })

  it('keeps NaN (failed-path periods) as NaN in real mode, never a number', () => {
    const path = representativePath(0.5, 0, [1000, NaN], [1, NaN])
    const real = toChartData(resultWithPaths(1, [path]), 'real')
    expect(Number.isNaN(real.representativePaths[0].values[1])).toBe(true)
  })

  it('allows two representative paths to cross at an intermediate period', () => {
    // Each series is one independent real path chosen only by its terminal
    // value -- p10 <= p50 <= ... is only guaranteed at the period they were
    // selected on, not at every period along the way. A dip like this is
    // expected, not a mapping bug.
    const p10 = representativePath(0.1, 1, [1000, 1200, 800])
    const p90 = representativePath(0.9, 2, [1000, 1100, 1600])
    const result = resultWithPaths(2, [p10, p90])

    const chartData = toChartData(result)

    expect(chartData.representativePaths[0].values[1]).toBeGreaterThan(
      chartData.representativePaths[1].values[1],
    )
  })
})
