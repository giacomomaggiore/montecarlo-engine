import type {
  RepresentativePath,
  SimulationResult,
} from '../core/simulation/simulationTypes'

// Nominal: the simulated base-currency values exactly as accounted. Real:
// each path's values deflated by that path's OWN cumulative price level (the
// jointly sampled inflation trajectory carried on every representative and
// retained path). Per the Financial Rules, accounting always stays nominal —
// real display is a pure presentation-layer division performed here.
export type DisplayMode = 'nominal' | 'real'

export type PortfolioChartData = {
  readonly periods: Float64Array
  // Ordered ascending by quantileLevel (p1..p99) — the same order
  // runSimulation's selectRepresentativePaths already builds them in.
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
export function toChartData(
  result: SimulationResult,
  displayMode: DisplayMode = 'nominal',
): PortfolioChartData {
  // Read the period count from config rather than from
  // representativePaths[0] — this stays correct even in the edge case
  // where every path failed and representativePaths is empty.
  const periodCount = result.metadata.config.periods + 1
  const periods = new Float64Array(periodCount)
  for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
    periods[periodIndex] = periodIndex
  }

  const representativePaths =
    displayMode === 'nominal'
      ? result.representativePaths
      : result.representativePaths.map(deflateToRealValues)

  return { periods, representativePaths }
}

// Real value at period t = nominal value / that path's price level at t
// (price level starts at 1, so period 0 is unchanged). Division by a NaN
// price level (a failed path's post-failure periods) correctly yields NaN —
// "no observation" stays "no observation" in real terms too.
// Time O(T) per path, space O(T) for the deflated copy; the nominal arrays
// are never mutated (they may be rendered again when the user toggles back).
function deflateToRealValues(path: RepresentativePath): RepresentativePath {
  const realValues = new Float64Array(path.values.length)
  for (
    let periodIndex = 0;
    periodIndex < path.values.length;
    periodIndex += 1
  ) {
    realValues[periodIndex] =
      path.values[periodIndex] / path.priceLevels[periodIndex]
  }
  return { ...path, values: realValues }
}
