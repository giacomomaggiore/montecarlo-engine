import { describe, expect, it } from 'vitest'
import type { SimulationResult } from '../core/simulation/simulationTypes'
import { toChartData } from './chartData'

function resultWithQuantiles(
  p10: number[],
  p25: number[],
  p50: number[],
  p75: number[],
  p90: number[],
): SimulationResult {
  return {
    metadata: {
      config: {
        weights: [1],
        initialInvestment: 1,
        cashFlow: { mode: 'lumpSum' },
        paths: 1,
        periods: p50.length - 1,
        seed: 0,
      },
      dataset: {
        version: 'v',
        checksum: 'c',
        frequency: 'weekly',
        baseCurrency: 'USD',
      },
      algorithms: { model: 'm', prng: 'p', quantile: 'q' },
    },
    terminalWealth: new Float64Array(p50),
    quantiles: {
      p10: new Float64Array(p10),
      p25: new Float64Array(p25),
      p50: new Float64Array(p50),
      p75: new Float64Array(p75),
      p90: new Float64Array(p90),
    },
    retainedPaths: [],
    failures: [],
  }
}

describe('toChartData', () => {
  it('builds a 0..periods index axis matching the quantile series length', () => {
    const result = resultWithQuantiles(
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    )
    const chartData = toChartData(result)
    expect(Array.from(chartData.periods)).toEqual([0, 1, 2])
  })

  it('preserves the quantile ordering p10 <= p25 <= p50 <= p75 <= p90 at every period', () => {
    const result = resultWithQuantiles(
      [900, 910, 905],
      [950, 960, 955],
      [1000, 1010, 1005],
      [1050, 1060, 1055],
      [1100, 1110, 1105],
    )
    const chartData = toChartData(result)

    for (let i = 0; i < chartData.periods.length; i += 1) {
      expect(chartData.p10[i]).toBeLessThanOrEqual(chartData.p25[i])
      expect(chartData.p25[i]).toBeLessThanOrEqual(chartData.p50[i])
      expect(chartData.p50[i]).toBeLessThanOrEqual(chartData.p75[i])
      expect(chartData.p75[i]).toBeLessThanOrEqual(chartData.p90[i])
    }
  })
})
