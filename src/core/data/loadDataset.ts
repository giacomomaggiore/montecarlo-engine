import type { ValidationError, ValidationResult } from '../validation'
import { parseAssetsCatalogue } from './assetCatalogue'
import type { AssetsCatalogue } from './assetCatalogue'
import type { AlignedDataset, BaseCurrency, Frequency } from './datasetTypes'
import { validateAlignedDataset } from './datasetTypes'

// Catalogue parsing moved to assetCatalogue.ts in Phase 4.3 (the picker
// needs the catalogue long before any run); re-exported here so existing
// imports keep working.
export { parseAssetsCatalogue } from './assetCatalogue'
export type { AssetCatalogueRecord, AssetsCatalogue } from './assetCatalogue'

// The browser-side counterpart to pipeline/build_release.py and
// pipeline/validate_release.py: fetches the three released artifacts
// (manifest.json, assets.json, the little-endian float32 return matrix),
// validates them with the exact same rules the offline pipeline already
// checks, and slices the user's selected assets into the AlignedDataset
// shape core/simulation already validates and consumes unchanged.

const DATA_BASE_PATH = '/data/releases'

// Only this one release exists on disk today (see LOG.MD's Dataset artifact
// gate entry). Requesting any other combination must fail with a structured,
// explicit error -- never a 404 surfacing as an opaque fetch exception, and
// never a silent fallback to a different dataset than the one requested.
const RELEASED_DATASETS: ReadonlySet<string> = new Set([
  'weekly:USD',
  'monthly:USD',
])

export function isReleasedDataset(
  frequency: Frequency,
  baseCurrency: BaseCurrency,
): boolean {
  return RELEASED_DATASETS.has(datasetKey(frequency, baseCurrency))
}

export function releasedBaseCurrencies(): readonly BaseCurrency[] {
  return ['USD']
}

export type DatasetManifest = {
  readonly schemaVersion: string
  readonly datasetVersion: string
  readonly checksum: string
  readonly matrixFileName: string
  readonly frequency: Frequency
  readonly baseCurrency: BaseCurrency
  readonly dtype: string
  readonly byteOrder: string
  readonly layout: string
  readonly rowCount: number
  readonly dates: readonly string[]
  readonly columns: readonly string[]
  readonly assetColumns: readonly string[]
  readonly specialColumns: {
    readonly inflation: string
    readonly riskFreeRate: string
  }
  readonly byteOffsets: Readonly<Record<string, number>>
  readonly byteLength: number
}

export type DatasetArtifacts = {
  readonly manifest: DatasetManifest
  readonly assetsCatalogue: AssetsCatalogue
  readonly matrixBuffer: ArrayBuffer
}

function error(code: string, message: string): ValidationError {
  return { code, message }
}

function datasetKey(frequency: Frequency, baseCurrency: BaseCurrency): string {
  return `${frequency}:${baseCurrency}`
}

function releaseDirectory(frequency: Frequency, baseCurrency: BaseCurrency): string {
  return `${DATA_BASE_PATH}/${frequency}-${baseCurrency.toLowerCase()}`
}

// ---------------------------------------------------------------------------
// manifest.json / assets.json — runtime schema validation
// ---------------------------------------------------------------------------
// response.json() already enforces standard JSON syntax (this is exactly the
// gate that caught the pipeline-side bug documented in LOG.MD: assets.json
// briefly contained the bare token NaN, which Python's json.load tolerates
// but a browser's JSON parser rejects outright). What it does not enforce is
// *shape* -- an untrusted file can parse as valid JSON and still be missing
// or mistyped fields, so every field this loader depends on is checked here,
// once, before any byte offset or column name is trusted.

function requireNonEmptyString(
  record: Record<string, unknown>,
  field: string,
  errorPrefix: string,
  errors: ValidationError[],
): string | undefined {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(error(`${errorPrefix}.${field}`, `${errorPrefix}.${field} must be a non-empty string.`))
    return undefined
  }
  return value
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function parseManifest(raw: unknown): ValidationResult<DatasetManifest> {
  const errors: ValidationError[] = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: [error('manifest.shape', 'manifest.json must be a JSON object.')] }
  }

  const manifest = raw as Record<string, unknown>

  requireNonEmptyString(manifest, 'schemaVersion', 'manifest', errors)
  requireNonEmptyString(manifest, 'datasetVersion', 'manifest', errors)
  const checksum = requireNonEmptyString(manifest, 'checksum', 'manifest', errors)
  if (checksum !== undefined && !checksum.startsWith('sha256:')) {
    errors.push(error('manifest.checksum.format', "manifest.checksum must start with 'sha256:'."))
  }
  const matrixFileName = requireNonEmptyString(manifest, 'matrixFileName', 'manifest', errors)
  if (
    matrixFileName !== undefined &&
    (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.f32$/.test(matrixFileName) || matrixFileName.includes('..'))
  ) {
    errors.push(error('manifest.matrixFileName', 'manifest.matrixFileName must be a safe .f32 filename.'))
  }

  const frequency = manifest['frequency']
  if (frequency !== 'weekly' && frequency !== 'monthly') {
    errors.push(error('manifest.frequency', 'manifest.frequency must be "weekly" or "monthly".'))
  }

  const baseCurrency = manifest['baseCurrency']
  if (baseCurrency !== 'USD' && baseCurrency !== 'EUR') {
    errors.push(error('manifest.baseCurrency', 'manifest.baseCurrency must be "USD" or "EUR".'))
  }

  if (manifest['dtype'] !== 'float32') {
    errors.push(error('manifest.dtype', 'manifest.dtype must be "float32".'))
  }
  if (manifest['byteOrder'] !== 'little-endian') {
    errors.push(error('manifest.byteOrder', 'manifest.byteOrder must be "little-endian".'))
  }
  if (manifest['layout'] !== 'column-major') {
    errors.push(error('manifest.layout', 'manifest.layout must be "column-major".'))
  }

  const rowCount = manifest['rowCount']
  const rowCountValid = typeof rowCount === 'number' && Number.isInteger(rowCount) && rowCount > 0
  if (!rowCountValid) {
    errors.push(error('manifest.rowCount', 'manifest.rowCount must be a positive integer.'))
  }

  const dates = manifest['dates']
  if (!isStringArray(dates)) {
    errors.push(error('manifest.dates', 'manifest.dates must be an array of strings.'))
  } else if (rowCountValid && dates.length !== rowCount) {
    errors.push(error('manifest.dates.length', 'manifest.dates length must equal manifest.rowCount.'))
  }

  const columns = manifest['columns']
  if (!isStringArray(columns)) {
    errors.push(error('manifest.columns', 'manifest.columns must be an array of strings.'))
  }

  const assetColumns = manifest['assetColumns']
  if (!isStringArray(assetColumns)) {
    errors.push(error('manifest.assetColumns', 'manifest.assetColumns must be an array of strings.'))
  }

  const specialColumns = manifest['specialColumns']
  const specialColumnsRecord =
    typeof specialColumns === 'object' && specialColumns !== null
      ? (specialColumns as Record<string, unknown>)
      : undefined
  const specialColumnsValid =
    specialColumnsRecord !== undefined &&
    typeof specialColumnsRecord['inflation'] === 'string' &&
    typeof specialColumnsRecord['riskFreeRate'] === 'string'
  if (!specialColumnsValid) {
    errors.push(
      error(
        'manifest.specialColumns',
        'manifest.specialColumns must provide string "inflation" and "riskFreeRate" column names.',
      ),
    )
  }

  const byteOffsets = manifest['byteOffsets']
  const byteOffsetsRecord =
    typeof byteOffsets === 'object' && byteOffsets !== null && !Array.isArray(byteOffsets)
      ? (byteOffsets as Record<string, unknown>)
      : undefined
  if (byteOffsetsRecord === undefined) {
    errors.push(error('manifest.byteOffsets', 'manifest.byteOffsets must be an object mapping column name to byte offset.'))
  }

  const byteLength = manifest['byteLength']
  if (typeof byteLength !== 'number' || !Number.isInteger(byteLength) || byteLength <= 0) {
    errors.push(error('manifest.byteLength', 'manifest.byteLength must be a positive integer.'))
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  // Every referenced column name must actually resolve to both a listed
  // column and a numeric byte offset -- this is what step 4 of the loader
  // (slicing a Float32Array view straight out of the fetched buffer) trusts
  // without re-checking on every call.
  const typedColumns = columns as string[]
  const typedAssetColumns = assetColumns as string[]
  const typedSpecialColumns = specialColumnsRecord as { inflation: string; riskFreeRate: string }
  const typedByteOffsets = byteOffsetsRecord as Record<string, number>

  const referencedColumns = [...typedAssetColumns, typedSpecialColumns.inflation, typedSpecialColumns.riskFreeRate]
  for (const columnName of referencedColumns) {
    if (!typedColumns.includes(columnName)) {
      errors.push(error('manifest.columns.consistency', `Column '${columnName}' is referenced but missing from manifest.columns.`))
    }
    if (typeof typedByteOffsets[columnName] !== 'number') {
      errors.push(error('manifest.byteOffsets.consistency', `Column '${columnName}' has no numeric entry in manifest.byteOffsets.`))
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      schemaVersion: manifest['schemaVersion'] as string,
      datasetVersion: manifest['datasetVersion'] as string,
      checksum: checksum as string,
      matrixFileName: matrixFileName as string,
      frequency: frequency as Frequency,
      baseCurrency: baseCurrency as BaseCurrency,
      dtype: manifest['dtype'] as string,
      byteOrder: manifest['byteOrder'] as string,
      layout: manifest['layout'] as string,
      rowCount: rowCount as number,
      dates: dates as string[],
      columns: typedColumns,
      assetColumns: typedAssetColumns,
      specialColumns: typedSpecialColumns,
      byteOffsets: typedByteOffsets,
      byteLength: byteLength as number,
    },
  }
}

// ---------------------------------------------------------------------------
// Matrix integrity -- checksum and byte length, before any value is read
// ---------------------------------------------------------------------------

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Time complexity: O(byteLength) to hash the whole matrix once per fetched
// release (not once per simulation run, since fetchDatasetArtifactsCached
// below fetches each frequency/currency combination at most once per
// session). Space complexity: O(1) beyond the buffer already held in memory
// -- crypto.subtle.digest streams the input rather than duplicating it.
async function verifyMatrixIntegrity(
  buffer: ArrayBuffer,
  manifest: DatasetManifest,
): Promise<ValidationResult<undefined>> {
  const errors: ValidationError[] = []

  const expectedByteLength = manifest.rowCount * manifest.columns.length * 4
  if (buffer.byteLength !== expectedByteLength || buffer.byteLength !== manifest.byteLength) {
    errors.push(
      error(
        'dataset.matrix.byteLength',
        `Matrix file is ${buffer.byteLength} bytes; expected ${expectedByteLength} bytes ` +
          `(${manifest.rowCount} rows x ${manifest.columns.length} columns x 4 bytes) per manifest.byteLength.`,
      ),
    )
    // A wrong-sized buffer can't be safely digested or sliced further.
    return { ok: false, errors }
  }

  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const actualChecksum = `sha256:${toHex(digest)}`
  if (actualChecksum !== manifest.checksum) {
    errors.push(
      error(
        'dataset.matrix.checksum',
        `Matrix checksum ${actualChecksum} does not match manifest checksum ${manifest.checksum}. ` +
          'The deployed file no longer matches the manifest describing it.',
      ),
    )
  }

  return errors.length === 0 ? { ok: true, value: undefined } : { ok: false, errors }
}

// ---------------------------------------------------------------------------
// Fetching, with an in-memory, per-session cache
// ---------------------------------------------------------------------------

function fetchFailure(fileName: string, status: number): ValidationResult<never> {
  return { ok: false, errors: [error('dataset.fetch.failed', `Failed to download ${fileName} (HTTP ${status}).`)] }
}

export async function fetchDatasetArtifacts(
  frequency: Frequency,
  baseCurrency: BaseCurrency,
): Promise<ValidationResult<DatasetArtifacts>> {
  if (!RELEASED_DATASETS.has(datasetKey(frequency, baseCurrency))) {
    return {
      ok: false,
      errors: [
        error(
          'dataset.release.unavailable',
          `No released dataset exists yet for ${frequency}/${baseCurrency}.`,
        ),
      ],
    }
  }

  try {
    const directory = releaseDirectory(frequency, baseCurrency)
    const [manifestResponse, assetsResponse] = await Promise.all([
      fetch(`${directory}/manifest.json`),
      fetch(`${directory}/assets.json`),
    ])

    if (!manifestResponse.ok) return fetchFailure('manifest.json', manifestResponse.status)
    if (!assetsResponse.ok) return fetchFailure('assets.json', assetsResponse.status)

    const [manifestJson, assetsJson] = await Promise.all([
      manifestResponse.json(),
      assetsResponse.json(),
    ])

    const manifestResult = parseManifest(manifestJson)
    if (!manifestResult.ok) return manifestResult
    const manifest = manifestResult.value

    // Defends against the manifest itself disagreeing with the URL that
    // served it (e.g. a deployment that copied the wrong file into place) --
    // the same "never trust the claim, verify it" posture as the checksum
    // check just below.
    if (manifest.frequency !== frequency || manifest.baseCurrency !== baseCurrency) {
      return {
        ok: false,
        errors: [
          error(
            'dataset.manifest.mismatch',
            `manifest.json describes ${manifest.frequency}/${manifest.baseCurrency}, ` +
              `not the requested ${frequency}/${baseCurrency}.`,
          ),
        ],
      }
    }

    const matrixResponse = await fetch(`${directory}/${manifest.matrixFileName}`)
    if (!matrixResponse.ok) {
      return fetchFailure(manifest.matrixFileName, matrixResponse.status)
    }
    const matrixBuffer = await matrixResponse.arrayBuffer()

    const assetsResult = parseAssetsCatalogue(assetsJson)
    if (!assetsResult.ok) return assetsResult

    // The catalogue and the manifest must describe the same release: a
    // deployment that updates one file but not the other would otherwise let
    // the picker offer assets the matrix does not actually contain.
    if (assetsResult.value.datasetVersion !== manifest.datasetVersion) {
      return {
        ok: false,
        errors: [
          error(
            'dataset.catalogue.versionMismatch',
            `assets.json describes ${assetsResult.value.datasetVersion}, ` +
              `but manifest.json describes ${manifest.datasetVersion}.`,
          ),
        ],
      }
    }

    const integrityResult = await verifyMatrixIntegrity(matrixBuffer, manifest)
    if (!integrityResult.ok) return integrityResult

    return { ok: true, value: { manifest, assetsCatalogue: assetsResult.value, matrixBuffer } }
  } catch (caught) {
    // fetch() itself throws (rather than resolving) on a network failure
    // such as being offline -- this is the one place that exception is
    // caught and turned into the same structured ValidationResult failure
    // every other error path already returns, instead of an unhandled
    // rejection surfacing far from where it happened.
    const message = caught instanceof Error ? caught.message : String(caught)
    return { ok: false, errors: [error('dataset.fetch.exception', `Fetching the dataset artifacts failed: ${message}`)] }
  }
}

const artifactsCache = new Map<string, Promise<ValidationResult<DatasetArtifacts>>>()

// Caches the in-flight/resolved fetch per frequency+baseCurrency, per the
// Dataset Format section's "cache it in memory for the current session"
// rule. A failed fetch is deliberately *not* kept cached: a transient
// network error should not permanently block every later attempt in the same
// session the way caching a successful ~950 KB download should.
export function fetchDatasetArtifactsCached(
  frequency: Frequency,
  baseCurrency: BaseCurrency,
): Promise<ValidationResult<DatasetArtifacts>> {
  const key = datasetKey(frequency, baseCurrency)
  const cached = artifactsCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const pending = fetchDatasetArtifacts(frequency, baseCurrency)
  artifactsCache.set(key, pending)
  pending.then((result) => {
    if (!result.ok) {
      artifactsCache.delete(key)
    }
  })

  return pending
}

// ---------------------------------------------------------------------------
// Slicing the fetched matrix into an AlignedDataset
// ---------------------------------------------------------------------------

function sliceColumn(buffer: ArrayBuffer, manifest: DatasetManifest, columnName: string): Float32Array {
  const byteOffset = manifest.byteOffsets[columnName]
  return new Float32Array(buffer, byteOffset, manifest.rowCount)
}

function isFiniteRow(columns: readonly Float32Array[], row: number): boolean {
  return columns.every((column) => Number.isFinite(column[row]))
}

// The shipped matrix is a union across every released asset's own history,
// NaN-padded before each asset's inception (see LOG.MD's Dataset artifact
// gate entry) -- it is not pre-trimmed to any particular selection's common
// window. It can also carry an isolated internal gap in a series every
// selection depends on: verified directly against the real released
// usd-weekly-v1 matrix, CPI_INFLATION is NaN for exactly nine weeks
// (2025-10-05 through 2025-11-30) because the raw FRED_CPIAUCSL source has a
// single blank monthly observation (2025-10-01) that its pct_change() step
// correctly propagates as "unavailable" for two months, per the README's
// "never forward-fill, mark unavailable" rule -- rather than "a fabricated
// number."
//
// An earlier version of this function treated any such gap strictly inside
// the selected columns' first/last finite row as a hard error. That is
// stricter than what the README actually specifies ("retain only rows that
// are finite for every selected asset") and, since CPI_INFLATION is a
// required column for every possible selection, it would have made *every*
// portfolio selection whose history reaches into that nine-week hole fail
// outright -- not a plausible product behavior for one macro-data gap deep
// in an otherwise 1,150-row-plus common history. The bootstrap engine draws
// one independent joint row per period and has no notion of calendar
// adjacency (see historicalBootstrap.ts), so the correct behavior is to
// *filter out* exactly the non-finite rows and keep every other jointly
// observed row, in date order -- dates stay strictly increasing either way,
// which is all validateAlignedDataset requires.
//
// Time complexity: O(rowCount * selectedColumnCount) -- one pass over the
// full shared date axis, checking every selected column at every row.
// Space complexity: O(commonRowCount) for the returned index list; no copy
// of the full matrix is made here, only of the (typically much smaller)
// common-history rows once step 4 below applies these indices.
function selectFiniteRowIndices(
  columns: readonly Float32Array[],
  rowCount: number,
): ValidationResult<readonly number[]> {
  const indices: number[] = []

  for (let row = 0; row < rowCount; row += 1) {
    if (isFiniteRow(columns, row)) {
      indices.push(row)
    }
  }

  if (indices.length === 0) {
    return {
      ok: false,
      errors: [error('dataset.selection.empty', 'The selected assets share no jointly observed history at all.')],
    }
  }

  return { ok: true, value: indices }
}

export function sliceAlignedDataset(
  assetIds: readonly string[],
  artifacts: DatasetArtifacts,
): ValidationResult<AlignedDataset> {
  const { manifest, matrixBuffer } = artifacts
  const errors: ValidationError[] = []

  for (const assetId of assetIds) {
    if (!manifest.assetColumns.includes(assetId)) {
      errors.push(
        error(
          'dataset.selection.unknownAsset',
          `'${assetId}' is not part of the released ${manifest.datasetVersion} dataset.`,
        ),
      )
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const assetReturns = assetIds.map((assetId) => sliceColumn(matrixBuffer, manifest, assetId))
  const inflation = sliceColumn(matrixBuffer, manifest, manifest.specialColumns.inflation)
  const riskFreeRates = sliceColumn(matrixBuffer, manifest, manifest.specialColumns.riskFreeRate)

  const rowSelectionResult = selectFiniteRowIndices([...assetReturns, inflation, riskFreeRates], manifest.rowCount)
  if (!rowSelectionResult.ok) {
    return rowSelectionResult
  }

  const rowIndices = rowSelectionResult.value

  const dataset: AlignedDataset = {
    identity: {
      version: manifest.datasetVersion,
      checksum: manifest.checksum,
      frequency: manifest.frequency,
      baseCurrency: manifest.baseCurrency,
    },
    assetIds,
    // Gathering by index (rather than a single contiguous .slice()) copies
    // only the jointly-finite rows into fresh, compact arrays -- the loader
    // never holds on to a view into the full ~950 KB matrix once the
    // selection has been made.
    dates: rowIndices.map((row) => manifest.dates[row]),
    assetReturns: assetReturns.map((column) => Float32Array.from(rowIndices, (row) => column[row])),
    inflation: Float32Array.from(rowIndices, (row) => inflation[row]),
    riskFreeRates: Float32Array.from(rowIndices, (row) => riskFreeRates[row]),
  }

  return validateAlignedDataset(dataset)
}

export async function loadAlignedDataset(
  assetIds: readonly string[],
  frequency: Frequency,
  baseCurrency: BaseCurrency,
): Promise<ValidationResult<AlignedDataset>> {
  const artifactsResult = await fetchDatasetArtifactsCached(frequency, baseCurrency)
  if (!artifactsResult.ok) {
    return artifactsResult
  }

  return sliceAlignedDataset(assetIds, artifactsResult.value)
}
