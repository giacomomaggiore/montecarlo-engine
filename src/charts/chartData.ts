import type {
  RepresentativePath,
  SimulationResult,
} from '../core/simulation/simulationTypes'

export type PortfolioChartData = {
  readonly periods: Float64Array
  // Ordered ascending by quantileLevel (p10, p25, p50, p75, p90) — the same
  // order runSimulation's selectRepresentativePaths already builds them in.
  readonly representativePaths: readonly RepresentativePath[]
}

// Pure mapping from one SimulationResult to one uPlot-ready data shape — no
// DOM or uPlot dependency, kept in its own module so it can be unit-tested
// without ever loading the uplot package (which touches browser globals
// like matchMedia as soon as it is imported). The x-axis is the period
// index (0..periods), not a calendar date: the placeholder and future real
// datasets both align periods to a common row count, and a chart concerned
// with "how did each representative path move over period t" only needs
// that index.
export function toChartData(result: SimulationResult): PortfolioChartData {
  // Read the period count from config rather than from
  // representativePaths[0] — this stays correct even in the edge case
  // where every path failed and representativePaths is empty.
  const periodCount = result.metadata.config.periods + 1
  const periods = new Float64Array(periodCount)
  for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
    periods[periodIndex] = periodIndex
  }

  return { periods, representativePaths: result.representativePaths }
}
