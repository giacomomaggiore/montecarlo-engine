import { useEffect, useRef } from 'react'
import type uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { createPortfolioChart } from '../../charts/portfolioChart'
import type { SimulationResult } from '../../core/simulation/simulationTypes'

// A thin lifecycle wrapper: construct on mount, update on a new result,
// destroy on unmount. No simulation or Worker logic belongs here.
export function PortfolioChart({
  result,
}: {
  readonly result: SimulationResult
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<uPlot | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    chartRef.current = createPortfolioChart(container, result)
    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [result])

  return <div ref={containerRef} aria-label="Simulation result chart" />
}
