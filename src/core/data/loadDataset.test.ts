import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAssetsCatalogue, parseManifest } from './loadDataset'
import type { DatasetManifest } from './loadDataset'

// Every integration test below stubs fetch and crypto.subtle.digest instead
// of hitting the real public/data/ files or a real SHA-256 implementation:
// jsdom's SubtleCrypto rejects ArrayBuffers that were not constructed inside
// its own realm (confirmed directly while building this loader), so a real
// digest() call cannot be exercised reliably under Vitest's jsdom
// environment regardless of correctness -- exactly the situation the
// Maintenance Policy's existing matchMedia stub in src/test/setup.ts already
// works around for a different browser API.

const ZERO_DIGEST = new Uint8Array(32).fill(0).buffer
const ZERO_CHECKSUM = `sha256:${'00'.repeat(32)}`

function isoDate(weekIndex: number): string {
  const firstMonday = Date.parse('2015-01-05T00:00:00.000Z')
  const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000
  return new Date(firstMonday + weekIndex * millisecondsPerWeek).toISOString().slice(0, 10)
}

type FixtureColumn = { readonly name: string; readonly values: readonly number[] }

function buildFixture(
  columns: readonly FixtureColumn[],
  options: {
    readonly assetColumns: readonly string[]
    readonly inflation: string
    readonly riskFreeRate: string
    readonly rowCount: number
    readonly checksum?: string
  },
): { manifest: DatasetManifest; buffer: ArrayBuffer } {
  const { rowCount } = options
  const dates = Array.from({ length: rowCount }, (_, i) => isoDate(i))
  const byteOffsets: Record<string, number> = {}
  const buffer = new ArrayBuffer(columns.length * rowCount * 4)

  columns.forEach((column, index) => {
    const byteOffset = index * rowCount * 4
    byteOffsets[column.name] = byteOffset
    new Float32Array(buffer, byteOffset, rowCount).set(column.values)
  })

  const manifest = {
    schemaVersion: 'dataset-manifest-v1',
    datasetVersion: 'fixture-weekly-usd-v1',
    checksum: options.checksum ?? ZERO_CHECKSUM,
    frequency: 'weekly',
    baseCurrency: 'USD',
    dtype: 'float32',
    byteOrder: 'little-endian',
    layout: 'column-major',
    rowCount,
    dates,
    columns: columns.map((column) => column.name),
    assetColumns: options.assetColumns,
    specialColumns: { inflation: options.inflation, riskFreeRate: options.riskFreeRate },
    byteOffsets,
    byteLength: buffer.byteLength,
  } as DatasetManifest

  return { manifest, buffer }
}

function assetsCatalogueFixture(assetIds: readonly string[]) {
  return {
    schemaVersion: 'assets-catalogue-v1',
    datasetVersion: 'fixture-weekly-usd-v1',
    baseCurrency: 'USD',
    assets: assetIds.map((assetId) => ({ assetId, ticker: assetId, name: `${assetId} fixture` })),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => {
      throw new Error('this fixture response only supports .json()')
    },
  } as unknown as Response
}

function bufferResponse(buffer: ArrayBuffer, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('this fixture response only supports .arrayBuffer()')
    },
    arrayBuffer: async () => buffer,
  } as unknown as Response
}

function stubFetch(
  manifestJson: unknown,
  assetsJson: unknown,
  matrixBuffer: ArrayBuffer,
  statusByFile: { readonly manifest?: number; readonly assets?: number; readonly matrix?: number } = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return jsonResponse(manifestJson, statusByFile.manifest ?? 200)
      if (url.endsWith('assets.json')) return jsonResponse(assetsJson, statusByFile.assets ?? 200)
      return bufferResponse(matrixBuffer, statusByFile.matrix ?? 200)
    }),
  )
}

function stubDigest(digest: ArrayBuffer): void {
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    subtle: { digest: vi.fn(async () => digest) },
    randomUUID: globalThis.crypto.randomUUID?.bind(globalThis.crypto),
  })
}

describe('parseManifest', () => {
  function validManifestJson(): Record<string, unknown> {
    const { manifest } = buildFixture(
      [
        { name: 'A', values: [0.01, 0.02] },
        { name: 'CPI_INFLATION', values: [0.001, 0.001] },
        { name: 'RISK_FREE_RATE', values: [0.0005, 0.0005] },
      ],
      { assetColumns: ['A'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount: 2 },
    )
    return manifest as unknown as Record<string, unknown>
  }

  it('accepts a well-formed manifest', () => {
    const result = parseManifest(validManifestJson())
    expect(result.ok).toBe(true)
  })

  it('rejects a manifest missing a required field', () => {
    const manifest = validManifestJson()
    delete manifest['schemaVersion']
    const result = parseManifest(manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'manifest.schemaVersion')).toBe(true)
    }
  })

  it('rejects a dtype other than float32', () => {
    const manifest = validManifestJson()
    manifest['dtype'] = 'float64'
    const result = parseManifest(manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'manifest.dtype')).toBe(true)
    }
  })

  it('rejects a column referenced by assetColumns but missing from byteOffsets', () => {
    const manifest = validManifestJson()
    const byteOffsets = manifest['byteOffsets'] as Record<string, number>
    delete byteOffsets['A']
    const result = parseManifest(manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'manifest.byteOffsets.consistency')).toBe(true)
    }
  })
})

describe('parseAssetsCatalogue', () => {
  it('accepts a well-formed catalogue', () => {
    const result = parseAssetsCatalogue(assetsCatalogueFixture(['A', 'B']))
    expect(result.ok).toBe(true)
  })

  it('rejects a record missing a required string field', () => {
    const catalogue = assetsCatalogueFixture(['A'])
    // @ts-expect-error -- deliberately corrupting the fixture for this test
    delete catalogue.assets[0].name
    const result = parseAssetsCatalogue(catalogue)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'assetsCatalogue.record')).toBe(true)
    }
  })
})

describe('loadAlignedDataset — fetch, verify, and slice', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches, verifies, and slices a valid release into the expected AlignedDataset', async () => {
    const rowCount = 260
    const aValues = Array.from({ length: rowCount }, (_, i) => 0.001 * (i % 7))
    const bValues = Array.from({ length: rowCount }, (_, i) => 0.0005 * (i % 5))
    const cpiValues = Array.from({ length: rowCount }, () => 0.0002)
    const rfValues = Array.from({ length: rowCount }, () => 0.0001)

    const { manifest, buffer } = buildFixture(
      [
        { name: 'A', values: aValues },
        { name: 'B', values: bValues },
        { name: 'CPI_INFLATION', values: cpiValues },
        { name: 'RISK_FREE_RATE', values: rfValues },
      ],
      { assetColumns: ['A', 'B'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount },
    )

    stubFetch(manifest, assetsCatalogueFixture(['A', 'B']), buffer)
    stubDigest(ZERO_DIGEST)

    const { loadAlignedDataset } = await import('./loadDataset')
    const result = await loadAlignedDataset(['A', 'B'], 'weekly', 'USD')

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.assetIds).toEqual(['A', 'B'])
    expect(result.value.dates).toHaveLength(rowCount)
    expect(result.value.identity.version).toBe('fixture-weekly-usd-v1')
    expect(Array.from(result.value.assetReturns[0])).toEqual(Array.from(new Float32Array(aValues)))
    expect(Array.from(result.value.assetReturns[1])).toEqual(Array.from(new Float32Array(bValues)))
  })

  it('fails with a structured error when the matrix checksum does not match the manifest', async () => {
    const rowCount = 260
    const { manifest, buffer } = buildFixture(
      [
        { name: 'A', values: Array.from({ length: rowCount }, () => 0.001) },
        { name: 'CPI_INFLATION', values: Array.from({ length: rowCount }, () => 0.0002) },
        { name: 'RISK_FREE_RATE', values: Array.from({ length: rowCount }, () => 0.0001) },
      ],
      { assetColumns: ['A'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount },
    )

    stubFetch(manifest, assetsCatalogueFixture(['A']), buffer)
    stubDigest(new Uint8Array(32).fill(0x11).buffer) // does not hash to ZERO_CHECKSUM

    const { loadAlignedDataset } = await import('./loadDataset')
    const result = await loadAlignedDataset(['A'], 'weekly', 'USD')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((error) => error.code === 'dataset.matrix.checksum')).toBe(true)
  })

  it('fails with a structured error when the matrix file is a different length than the manifest declares', async () => {
    const rowCount = 260
    const { manifest, buffer } = buildFixture(
      [
        { name: 'A', values: Array.from({ length: rowCount }, () => 0.001) },
        { name: 'CPI_INFLATION', values: Array.from({ length: rowCount }, () => 0.0002) },
        { name: 'RISK_FREE_RATE', values: Array.from({ length: rowCount }, () => 0.0001) },
      ],
      { assetColumns: ['A'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount },
    )
    const truncatedBuffer = buffer.slice(0, buffer.byteLength - 4)

    stubFetch(manifest, assetsCatalogueFixture(['A']), truncatedBuffer)
    stubDigest(ZERO_DIGEST)

    const { loadAlignedDataset } = await import('./loadDataset')
    const result = await loadAlignedDataset(['A'], 'weekly', 'USD')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((error) => error.code === 'dataset.matrix.byteLength')).toBe(true)
  })

  it('rejects a frequency/currency combination that has not been released yet, without fetching anything', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch must not be called for an unreleased combination')
      }),
    )

    const { loadAlignedDataset } = await import('./loadDataset')
    const result = await loadAlignedDataset(['A'], 'monthly', 'USD')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((error) => error.code === 'dataset.release.unavailable')).toBe(true)
  })

  it('rejects a selected asset ID that is not part of the released dataset', async () => {
    const rowCount = 260
    const { manifest, buffer } = buildFixture(
      [
        { name: 'A', values: Array.from({ length: rowCount }, () => 0.001) },
        { name: 'CPI_INFLATION', values: Array.from({ length: rowCount }, () => 0.0002) },
        { name: 'RISK_FREE_RATE', values: Array.from({ length: rowCount }, () => 0.0001) },
      ],
      { assetColumns: ['A'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount },
    )

    stubFetch(manifest, assetsCatalogueFixture(['A']), buffer)
    stubDigest(ZERO_DIGEST)

    const { loadAlignedDataset } = await import('./loadDataset')
    const result = await loadAlignedDataset(['A', 'Z'], 'weekly', 'USD')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((error) => error.code === 'dataset.selection.unknownAsset')).toBe(true)
  })

  it('rejects a selection whose common finite window falls below the 260-week minimum', async () => {
    const rowCount = 300
    const aValues = Array.from({ length: rowCount }, () => 0.001)
    // B only has history for its last 50 rows -- the common window across
    // A and B is 50 rows, well under the 260-week minimum.
    const bValues = Array.from({ length: rowCount }, (_, i) => (i >= 250 ? 0.0005 : Number.NaN))
    const cpiValues = Array.from({ length: rowCount }, () => 0.0002)
    const rfValues = Array.from({ length: rowCount }, () => 0.0001)

    const { manifest, buffer } = buildFixture(
      [
        { name: 'A', values: aValues },
        { name: 'B', values: bValues },
        { name: 'CPI_INFLATION', values: cpiValues },
        { name: 'RISK_FREE_RATE', values: rfValues },
      ],
      { assetColumns: ['A', 'B'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount },
    )

    stubFetch(manifest, assetsCatalogueFixture(['A', 'B']), buffer)
    stubDigest(ZERO_DIGEST)

    const { loadAlignedDataset } = await import('./loadDataset')
    const result = await loadAlignedDataset(['A', 'B'], 'weekly', 'USD')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((error) => error.code === 'dataset.observations.minimum')).toBe(true)
  })

  it('filters out an isolated internal gap rather than rejecting the whole selection', async () => {
    // Mirrors the real released usd-weekly-v1 matrix exactly: CPI_INFLATION
    // is NaN for nine weeks in the middle of an otherwise complete history
    // (a single blank monthly observation in the raw FRED source correctly
    // propagating as "unavailable," not a fabricated pipeline bug -- see
    // LOG.MD). One row's worth of gap here proves the same behavior with a
    // fixture small enough to hand-check.
    const rowCount = 261 // one more than the 260-week minimum, so removing exactly one row still passes it.
    const aValues = Array.from({ length: rowCount }, () => 0.001)
    const bValues = Array.from({ length: rowCount }, (_, i) => (i === 100 ? Number.NaN : 0.0005))
    const cpiValues = Array.from({ length: rowCount }, () => 0.0002)
    const rfValues = Array.from({ length: rowCount }, () => 0.0001)

    const { manifest, buffer } = buildFixture(
      [
        { name: 'A', values: aValues },
        { name: 'B', values: bValues },
        { name: 'CPI_INFLATION', values: cpiValues },
        { name: 'RISK_FREE_RATE', values: rfValues },
      ],
      { assetColumns: ['A', 'B'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount },
    )
    const gapDate = manifest.dates[100]

    stubFetch(manifest, assetsCatalogueFixture(['A', 'B']), buffer)
    stubDigest(ZERO_DIGEST)

    const { loadAlignedDataset } = await import('./loadDataset')
    const result = await loadAlignedDataset(['A', 'B'], 'weekly', 'USD')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dates).toHaveLength(rowCount - 1)
    expect(result.value.dates).not.toContain(gapDate)
    // Every value in the returned dataset must still be finite -- the point
    // of filtering rather than trimming a contiguous window is that the
    // gap row itself is gone, not merely tolerated.
    expect(Array.from(result.value.assetReturns[1]).every(Number.isFinite)).toBe(true)
  })

  it('fetches each frequency/currency combination at most once per session', async () => {
    const rowCount = 260
    const { manifest, buffer } = buildFixture(
      [
        { name: 'A', values: Array.from({ length: rowCount }, () => 0.001) },
        { name: 'CPI_INFLATION', values: Array.from({ length: rowCount }, () => 0.0002) },
        { name: 'RISK_FREE_RATE', values: Array.from({ length: rowCount }, () => 0.0001) },
      ],
      { assetColumns: ['A'], inflation: 'CPI_INFLATION', riskFreeRate: 'RISK_FREE_RATE', rowCount },
    )

    stubFetch(manifest, assetsCatalogueFixture(['A']), buffer)
    stubDigest(ZERO_DIGEST)

    const { loadAlignedDataset } = await import('./loadDataset')
    await loadAlignedDataset(['A'], 'weekly', 'USD')
    await loadAlignedDataset(['A'], 'weekly', 'USD')

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3) // manifest + assets + matrix, once in total
  })
})
