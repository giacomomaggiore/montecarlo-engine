import { useEffect, useRef } from 'react'
import type uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { DisplayMode } from '../../charts/chartData'
import { createPortfolioChart } from '../../charts/portfolioChart'
import type { SimulationResult } from '../../core/simulation/simulationTypes'

// A thin lifecycle wrapper: construct on mount, update on a new result or a
// nominal/real display toggle, destroy on unmount. No simulation or Worker
// logic belongs here.
export function PortfolioChart({
  result,
  displayMode,
}: {
  readonly result: SimulationResult
  readonly displayMode: DisplayMode
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<uPlot | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Rebuilding the chart on a display-mode flip (rather than patching data
    // in place) keeps this wrapper trivially correct: uPlot re-derives every
    // scale from the deflated series, and a full rebuild for <= 7 series of
    // <= 1560 points is far below any perceptible cost.
    chartRef.current = createPortfolioChart(container, result, displayMode)
    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [result, displayMode])

  return <div ref={containerRef} aria-label="Simulation result chart" />
}
