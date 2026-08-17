import { createCsvExports } from '../../core/export/csvExport'
import type { SimulationResult } from '../../core/simulation/simulationTypes'
import { downloadCsvExport } from './csvDownload'

const EXPORT_LABELS = [
  'Run metadata',
  'Metric summaries',
  'Terminal outcomes',
  'Retained path details',
] as const

export function ExportDownloads({
  result,
}: {
  readonly result: SimulationResult
}) {
  const exports = createCsvExports(result)

  return (
    <section aria-labelledby="export-heading">
      <h3 id="export-heading">Export completed run</h3>
      <p className="input-hint">
        Downloads use this completed run&apos;s immutable settings and outcomes.
      </p>
      <div className="engine-controls">
        {exports.map((csvExport, index) => (
          <button
            key={csvExport.filename}
            onClick={() => downloadCsvExport(csvExport)}
            type="button"
          >
            Download {EXPORT_LABELS[index]} CSV
          </button>
        ))}
      </div>
    </section>
  )
}
