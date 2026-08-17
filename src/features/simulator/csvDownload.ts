import type { CsvExport } from '../../core/export/csvExport'

export function downloadCsvExport(csvExport: CsvExport): void {
  const blob = new Blob([csvExport.content], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = csvExport.filename
  anchor.click()
  URL.revokeObjectURL(url)
}
