import type { ValidationError, ValidationResult } from '../validation'
import type { BaseCurrency, Frequency } from './datasetTypes'
import { minimumObservations } from './datasetTypes'

// Phase 4.3 — the runtime contract for the browser-facing assets.json
// catalogue. assets.json is UNTRUSTED JSON (a deployment can ship a stale or
// corrupted file no matter what the offline pipeline validated), so every
// field the UI consumes is schema-checked here once, before anything renders
// from it — the same posture loadDataset.ts already takes for manifest.json.
//
// The catalogue's job is everything the user does BEFORE a simulation run:
// searching and picking ETFs, showing names and asset classes, and previewing
// how much joint history a selection has. The heavy return matrix is only
// fetched later, at Run time, by loadDataset.ts.

const DATA_BASE_PATH = '/data/releases'

// Per-asset history span, produced by the pipeline from that asset's own
// finite return observations. This is a PREVIEW input, not the binding
// history check — see estimateCommonHistory below.
export type AssetHistorySummary = {
  readonly firstDate: string
  readonly lastDate: string
  readonly rowCount: number
  readonly meetsWeeklyMinimum: boolean
}

export type AssetCatalogueRecord = {
  readonly assetId: string
  readonly ticker: string
  readonly name: string
  readonly assetClass: string
  readonly history: AssetHistorySummary
}

export type AssetsCatalogue = {
  readonly schemaVersion: string
  readonly datasetVersion: string
  readonly baseCurrency: BaseCurrency
  readonly assets: readonly AssetCatalogueRecord[]
}

function error(code: string, message: string): ValidationError {
  return { code, message }
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  field: string,
  errorPrefix: string,
  errors: ValidationError[],
): string | undefined {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(
      error(
        `${errorPrefix}.${field}`,
        `${errorPrefix}.${field} must be a non-empty string.`,
      ),
    )
    return undefined
  }
  return value
}

// ISO calendar dates (YYYY-MM-DD) compare correctly as plain strings, which
// is why the overlap math below never constructs a Date object until it
// needs day arithmetic.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseHistory(
  raw: unknown,
  errorPrefix: string,
  errors: ValidationError[],
): AssetHistorySummary | undefined {
  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : undefined
  if (record === undefined) {
    errors.push(
      error(`${errorPrefix}.history`, `${errorPrefix}.history must be an object.`),
    )
    return undefined
  }

  const firstDate = record['firstDate']
  const lastDate = record['lastDate']
  const rowCount = record['rowCount']
  const meetsWeeklyMinimum = record['meetsWeeklyMinimum']

  const datesValid =
    typeof firstDate === 'string' &&
    ISO_DATE_PATTERN.test(firstDate) &&
    typeof lastDate === 'string' &&
    ISO_DATE_PATTERN.test(lastDate) &&
    firstDate <= lastDate
  const rowCountValid =
    typeof rowCount === 'number' && Number.isInteger(rowCount) && rowCount > 0

  if (!datesValid || !rowCountValid || typeof meetsWeeklyMinimum !== 'boolean') {
    errors.push(
      error(
        `${errorPrefix}.history`,
        `${errorPrefix}.history must provide ISO firstDate <= lastDate, a positive integer rowCount, and a boolean meetsWeeklyMinimum.`,
      ),
    )
    return undefined
  }

  return { firstDate, lastDate, rowCount, meetsWeeklyMinimum }
}

export function parseAssetsCatalogue(
  raw: unknown,
): ValidationResult<AssetsCatalogue> {
  const errors: ValidationError[] = []

  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      errors: [
        error('assetsCatalogue.shape', 'assets.json must be a JSON object.'),
      ],
    }
  }

  const catalogue = raw as Record<string, unknown>

  requireNonEmptyString(catalogue, 'schemaVersion', 'assetsCatalogue', errors)
  requireNonEmptyString(catalogue, 'datasetVersion', 'assetsCatalogue', errors)

  const baseCurrency = catalogue['baseCurrency']
  if (baseCurrency !== 'USD' && baseCurrency !== 'EUR') {
    errors.push(
      error(
        'assetsCatalogue.baseCurrency',
        'assetsCatalogue.baseCurrency must be "USD" or "EUR".',
      ),
    )
  }

  const assets = catalogue['assets']
  if (!Array.isArray(assets)) {
    errors.push(
      error('assetsCatalogue.assets', 'assetsCatalogue.assets must be an array.'),
    )
    return { ok: false, errors }
  }

  const records: AssetCatalogueRecord[] = []
  const seenAssetIds = new Set<string>()
  assets.forEach((entry, index) => {
    const record =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)
        : undefined
    const errorPrefix = `assets[${index}]`

    const assetId = record?.['assetId']
    const ticker = record?.['ticker']
    const name = record?.['name']
    const assetClass = record?.['assetClass']

    if (
      typeof assetId !== 'string' ||
      assetId.length === 0 ||
      typeof ticker !== 'string' ||
      typeof name !== 'string' ||
      typeof assetClass !== 'string'
    ) {
      errors.push(
        error(
          'assetsCatalogue.record',
          `${errorPrefix} is missing a string assetId, ticker, name, or assetClass.`,
        ),
      )
      return
    }

    // assetId is the binary matrix's column key: a duplicate would make two
    // catalogue entries silently claim the same return series.
    if (seenAssetIds.has(assetId)) {
      errors.push(
        error(
          'assetsCatalogue.duplicateAssetId',
          `${errorPrefix} repeats assetId '${assetId}'.`,
        ),
      )
      return
    }
    seenAssetIds.add(assetId)

    const history = parseHistory(record?.['history'], errorPrefix, errors)
    if (history === undefined) {
      return
    }

    records.push({ assetId, ticker, name, assetClass, history })
  })

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      schemaVersion: catalogue['schemaVersion'] as string,
      datasetVersion: catalogue['datasetVersion'] as string,
      baseCurrency: baseCurrency as BaseCurrency,
      assets: records,
    },
  }
}

// ---------------------------------------------------------------------------
// Estimated common history — advisory preview, not the binding gate
// ---------------------------------------------------------------------------

export type CommonHistoryEstimate = {
  readonly firstDate: string
  readonly lastDate: string
  // ESTIMATED joint observation count over the span intersection. The
  // authoritative count is only known after loadDataset.ts's finite-row
  // alignment, because an interior gap in ANY required series (e.g. the
  // released matrix's real nine-week CPI hole — see LOG.MD) removes rows
  // this span arithmetic cannot see. The picker displays this estimate; the
  // loader's validateAlignedDataset minimum remains the binding check that
  // can still fail a run.
  readonly estimatedRowCount: number
  readonly meetsMinimum: boolean
}

const MILLISECONDS_PER_DAY = 86_400_000

// Intersection of the selected assets' history spans. ISO strings order
// lexicographically, so max/min over strings IS max/min over dates.
// Time O(selected assets), space O(1).
export function estimateCommonHistory(
  selectedRecords: readonly AssetCatalogueRecord[],
  frequency: Frequency,
): CommonHistoryEstimate | null {
  if (selectedRecords.length === 0) {
    return null
  }

  let firstDate = selectedRecords[0].history.firstDate
  let lastDate = selectedRecords[0].history.lastDate
  for (const record of selectedRecords) {
    // The joint history can only START once the LATEST-starting asset exists,
    // and must END when the earliest-ending one stops.
    if (record.history.firstDate > firstDate) firstDate = record.history.firstDate
    if (record.history.lastDate < lastDate) lastDate = record.history.lastDate
  }

  const spanDays =
    (Date.parse(lastDate) - Date.parse(firstDate)) / MILLISECONDS_PER_DAY
  const daysPerPeriod = frequency === 'weekly' ? 7 : 30.44 // mean month length
  const estimatedRowCount =
    spanDays < 0 ? 0 : Math.floor(spanDays / daysPerPeriod) + 1

  return {
    firstDate,
    lastDate,
    estimatedRowCount,
    meetsMinimum: estimatedRowCount >= minimumObservations(frequency),
  }
}

// ---------------------------------------------------------------------------
// Fetching, with the same per-session cache discipline as the dataset loader
// ---------------------------------------------------------------------------

const catalogueCache = new Map<string, Promise<ValidationResult<AssetsCatalogue>>>()

function catalogueKey(frequency: Frequency, baseCurrency: BaseCurrency): string {
  return `${frequency}:${baseCurrency}`
}

function assetsCataloguePath(frequency: Frequency, baseCurrency: BaseCurrency): string {
  return `${DATA_BASE_PATH}/${frequency}-${baseCurrency.toLowerCase()}/assets.json`
}

async function fetchAssetsCatalogueForRelease(
  frequency: Frequency,
  baseCurrency: BaseCurrency,
): Promise<ValidationResult<AssetsCatalogue>> {
  try {
    const response = await fetch(assetsCataloguePath(frequency, baseCurrency))
    if (!response.ok) {
      return {
        ok: false,
        errors: [
          error(
            'assetsCatalogue.fetch.failed',
            `Failed to download assets.json (HTTP ${response.status}).`,
          ),
        ],
      }
    }
    return parseAssetsCatalogue(await response.json())
  } catch (caught) {
    // fetch() throws (rather than resolving) on network failure and
    // response.json() throws on malformed JSON — both become the same
    // structured failure shape every other loader error already uses.
    const message = caught instanceof Error ? caught.message : String(caught)
    return {
      ok: false,
      errors: [
        error(
          'assetsCatalogue.fetch.exception',
          `Fetching assets.json failed: ${message}`,
        ),
      ],
    }
  }
}

// One fetch per session (the catalogue backs every keystroke of the ETF
// search, so it must be memory-resident, not re-fetched per query). A failed
// fetch is NOT cached: a transient network error must not permanently break
// the picker for the whole session.
export function fetchAssetsCatalogueCached(
  frequency: Frequency = 'weekly',
  baseCurrency: BaseCurrency = 'USD',
): Promise<
  ValidationResult<AssetsCatalogue>
> {
  const key = catalogueKey(frequency, baseCurrency)
  const cached = catalogueCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  const pending = fetchAssetsCatalogueForRelease(frequency, baseCurrency)
  catalogueCache.set(key, pending)
  pending.then((result) => {
    if (!result.ok) {
      catalogueCache.delete(key)
    }
  })
  return pending
}

// Test-only escape hatch: module-level caches survive across Vitest cases in
// the same file, so tests that stub fetch differently must reset first.
export function resetAssetsCatalogueCacheForTests(): void {
  catalogueCache.clear()
}
