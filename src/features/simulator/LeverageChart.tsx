import { useEffect, useRef } from 'react'
import type uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { createLeverageChart } from '../../charts/leverageChart'
import type { RetainedPath } from '../../core/simulation/simulationTypes'

export function LeverageChart({
  path,
  targetGrossExposure,
  maintenanceMargin,
}: {
  readonly path: RetainedPath
  readonly targetGrossExposure: number
  readonly maintenanceMargin: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<uPlot | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    chartRef.current = createLeverageChart(
      container,
      path,
      targetGrossExposure,
      maintenanceMargin,
    )
    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [path, targetGrossExposure, maintenanceMargin])

  return <div ref={containerRef} aria-label="Weekly leverage ratio chart" />
}
