import type {
  QuantileSeries,
  SimulationResult,
} from '../core/simulation/simulationTypes'

export type PortfolioChartData = {
  readonly periods: Float64Array
} & QuantileSeries

// Pure mapping from one SimulationResult to one uPlot-ready data shape — no
// DOM or uPlot dependency, kept in its own module so it can be unit-tested
// without ever loading the uplot package (which touches browser globals
// like matchMedia as soon as it is imported). The x-axis is the period
// index (0..periods), not a calendar date: the placeholder and future real
// datasets both align periods to a common row count, and a chart concerned
// with "how outcomes vary across paths at period t" only needs that index.
export function toChartData(result: SimulationResult): PortfolioChartData {
  const periodCount = result.quantiles.p50.length
  const periods = new Float64Array(periodCount)
  for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
    periods[periodIndex] = periodIndex
  }

  return { periods, ...result.quantiles }
}
