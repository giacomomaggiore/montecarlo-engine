import uPlot from 'uplot'
import type { SimulationResult } from '../core/simulation/simulationTypes'
import { toChartData } from './chartData'

// One stroke style per quantile level, ordered p10..p90. p50 is the most
// visually prominent; p10/p90 are the thinnest and most muted. Deliberately
// no fills/bands here: each line is one real, independently simulated path
// (see simulationTypes.ts's RepresentativePath), not two aggregate edges of
// a statistical distribution, so shading "between" them would visually
// imply a distributional spread that these five specific trajectories do
// not actually represent.
const PATH_STROKE_BY_LEVEL: ReadonlyMap<
  number,
  { readonly stroke: string; readonly width: number }
> = new Map([
  [0.01, { stroke: 'rgba(29, 78, 216, 0.18)', width: 1 }],
  [0.1, { stroke: 'rgba(29, 78, 216, 0.35)', width: 1 }],
  [0.25, { stroke: 'rgba(29, 78, 216, 0.65)', width: 1.5 }],
  [0.5, { stroke: 'rgb(29, 78, 216)', width: 2.5 }],
  [0.75, { stroke: 'rgba(29, 78, 216, 0.65)', width: 1.5 }],
  [0.9, { stroke: 'rgba(29, 78, 216, 0.35)', width: 1 }],
  [0.99, { stroke: 'rgba(29, 78, 216, 0.18)', width: 1 }],
])

function labelForLevel(level: number): string {
  const percentile = Math.round(level * 100)
  return level === 0.5 ? 'p50 (median path)' : `p${percentile} path`
}

// Renders the five representative paths the Visualization spec's quantile
// requirement now resolves to: real, traced trajectories rather than a
// synthetic cross-sectional band (see LOG.MD for why the band was
// replaced). No per-path click-through here yet — that is the broader
// Interactive Highlights feature over retainedPaths, deferred to Phase 4.
// This function touches the DOM and the uplot package directly, so it is
// verified manually in a running browser, not by Vitest — see
// chartData.test.ts for the pure mapping it relies on.
export function createPortfolioChart(
  container: HTMLElement,
  result: SimulationResult,
): uPlot {
  const chartData = toChartData(result)

  const data: uPlot.AlignedData = [
    chartData.periods,
    ...chartData.representativePaths.map((path) => path.values),
  ]

  const series: uPlot.Series[] = [
    { label: 'Period' },
    ...chartData.representativePaths.map((path) => {
      const style = PATH_STROKE_BY_LEVEL.get(path.quantileLevel) ?? {
        stroke: 'rgb(29, 78, 216)',
        width: 1.5,
      }
      return {
        label: labelForLevel(path.quantileLevel),
        stroke: style.stroke,
        width: style.width,
      }
    }),
  ]

  const options: uPlot.Options = {
    width: container.clientWidth || 800,
    height: 360,
    scales: { x: { time: false } },
    series,
  }

  return new uPlot(options, data, container)
}
