import uPlot from 'uplot'
import type { SimulationResult } from '../core/simulation/simulationTypes'
import { toChartData } from './chartData'

const OUTER_BAND_FILL = 'rgba(37, 99, 235, 0.12)' // fills between p10 and p90
const INNER_BAND_FILL = 'rgba(37, 99, 235, 0.28)' // fills between p25 and p75
const MEDIAN_STROKE = 'rgb(29, 78, 216)'

// Renders exactly the aggregate bands the Visualization spec requires: a
// p10-p90 band, a p25-p75 band, and a single p50 line. No per-path lines yet
// — those are Interactive Highlights, deferred to Phase 4 along with the
// full retained-path click-through. This function touches the DOM and the
// uplot package directly, so it is verified manually in a running browser,
// not by Vitest — see chartData.test.ts for the pure mapping it relies on.
export function createPortfolioChart(
  container: HTMLElement,
  result: SimulationResult,
): uPlot {
  const chartData = toChartData(result)

  // uPlot's native `bands` option fills the area between two series by
  // index (see uPlot.Band: "series indices of upper and lower band edges"),
  // which keeps the fan chart inside one well-tested library feature
  // instead of hand-rolled canvas fill paths. The band-edge series
  // themselves are drawn transparent so only their fill — and the explicit
  // p50 line — are visible; percentile bands are aggregate statistics and
  // must never look like selectable individual paths.
  const data: uPlot.AlignedData = [
    chartData.periods,
    chartData.p90,
    chartData.p10,
    chartData.p75,
    chartData.p25,
    chartData.p50,
  ]

  const options: uPlot.Options = {
    width: container.clientWidth || 800,
    height: 360,
    scales: { x: { time: false } },
    series: [
      { label: 'Period' },
      { label: 'p90', stroke: 'transparent', width: 0 },
      { label: 'p10', stroke: 'transparent', width: 0 },
      { label: 'p75', stroke: 'transparent', width: 0 },
      { label: 'p25', stroke: 'transparent', width: 0 },
      { label: 'p50 (median)', stroke: MEDIAN_STROKE, width: 2 },
    ],
    bands: [
      { series: [1, 2], fill: OUTER_BAND_FILL },
      { series: [3, 4], fill: INNER_BAND_FILL },
    ],
  }

  return new uPlot(options, data, container)
}
