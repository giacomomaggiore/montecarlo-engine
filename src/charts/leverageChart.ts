import uPlot from 'uplot'
import type { RetainedPath } from '../core/simulation/simulationTypes'

// The leverage path is retained only for inspectable paths, not all N paths.
// It shows gross assets divided by equity; the two flat lines make the target
// and margin-implied maximum directly comparable to the realised path.
export function createLeverageChart(
  container: HTMLElement,
  path: RetainedPath,
  targetGrossExposure: number,
  maintenanceMargin: number,
): uPlot | null {
  const evidence = path.leverage
  if (evidence == null) return null
  const periods = Float64Array.from(
    evidence.grossLeverages,
    (_, index) => index,
  )
  const target = new Float64Array(periods.length).fill(targetGrossExposure)
  const marginLimit = new Float64Array(periods.length).fill(
    1 / maintenanceMargin,
  )
  return new uPlot(
    {
      width: container.clientWidth || 800,
      height: 240,
      scales: { x: { time: false } },
      series: [
        { label: 'Week' },
        { label: 'Gross leverage', stroke: 'rgb(185, 28, 28)', width: 2 },
        { label: 'Target', stroke: 'rgb(29, 78, 216)', dash: [6, 4] },
        { label: 'Margin limit', stroke: 'rgb(146, 64, 14)', dash: [3, 3] },
      ],
    },
    [periods, evidence.grossLeverages, target, marginLimit],
    container,
  )
}
