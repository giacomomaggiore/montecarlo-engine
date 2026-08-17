import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  estimateCommonHistory,
  fetchAssetsCatalogueCached,
  parseAssetsCatalogue,
  resetAssetsCatalogueCacheForTests,
} from './assetCatalogue'
import type { AssetCatalogueRecord } from './assetCatalogue'

function record(
  assetId: string,
  firstDate: string,
  lastDate: string,
  rowCount = 500,
): AssetCatalogueRecord {
  return {
    assetId,
    ticker: assetId,
    name: `${assetId} fixture fund`,
    assetClass: 'equity',
    history: { firstDate, lastDate, rowCount, meetsWeeklyMinimum: true },
  }
}

function catalogueJson(assets: unknown[] = [record('SPY', '2010-01-03', '2026-01-04')]) {
  return {
    schemaVersion: 'assets-catalogue-v1',
    datasetVersion: 'usd-weekly-v1',
    baseCurrency: 'USD',
    assets,
  }
}

describe('parseAssetsCatalogue', () => {
  it('accepts a well-formed catalogue with history metadata', () => {
    const result = parseAssetsCatalogue(catalogueJson())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.assets[0].assetClass).toBe('equity')
      expect(result.value.assets[0].history.rowCount).toBe(500)
    }
  })

  it('rejects a record missing assetClass', () => {
    const asset = { ...record('SPY', '2010-01-03', '2026-01-04') } as Record<
      string,
      unknown
    >
    delete asset['assetClass']
    const result = parseAssetsCatalogue(catalogueJson([asset]))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.code === 'assetsCatalogue.record'),
      ).toBe(true)
    }
  })

  it('rejects a malformed history block (dates out of order)', () => {
    const result = parseAssetsCatalogue(
      catalogueJson([record('SPY', '2026-01-04', '2010-01-03')]),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.code === 'assets[0].history'),
      ).toBe(true)
    }
  })

  it('rejects duplicate assetIds — the matrix column key must be unique', () => {
    const result = parseAssetsCatalogue(
      catalogueJson([
        record('SPY', '2010-01-03', '2026-01-04'),
        record('SPY', '2012-01-01', '2026-01-04'),
      ]),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.code === 'assetsCatalogue.duplicateAssetId',
        ),
      ).toBe(true)
    }
  })
})

describe('estimateCommonHistory', () => {
  it('intersects spans: latest start, earliest end', () => {
    const estimate = estimateCommonHistory(
      [
        record('OLD', '2000-01-02', '2026-01-04'),
        record('NEW', '2015-06-07', '2025-06-01'),
      ],
      'weekly',
    )
    expect(estimate?.firstDate).toBe('2015-06-07')
    expect(estimate?.lastDate).toBe('2025-06-01')
    // 2015-06-07 .. 2025-06-01 is 3647 days: floor(3647/7) + 1 = 522
    // estimated weekly rows — comfortably above the 260-week minimum.
    expect(estimate?.estimatedRowCount).toBe(522)
    expect(estimate?.meetsMinimum).toBe(true)
  })

  it('reports zero overlap (and a failed minimum) for disjoint spans', () => {
    const estimate = estimateCommonHistory(
      [
        record('A', '2000-01-02', '2005-01-02'),
        record('B', '2010-01-03', '2026-01-04'),
      ],
      'weekly',
    )
    expect(estimate?.estimatedRowCount).toBe(0)
    expect(estimate?.meetsMinimum).toBe(false)
  })

  it('is null for an empty selection', () => {
    expect(estimateCommonHistory([], 'weekly')).toBeNull()
  })
})

describe('fetchAssetsCatalogueCached', () => {
  afterEach(() => {
    resetAssetsCatalogueCacheForTests()
    vi.unstubAllGlobals()
  })

  it('fetches once and serves the same promise for later callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => catalogueJson(),
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchAssetsCatalogueCached()
    const second = await fetchAssetsCatalogueCached()
    expect(first.ok).toBe(true)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so a later attempt can succeed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => catalogueJson(),
      })
    vi.stubGlobal('fetch', fetchMock)

    const failed = await fetchAssetsCatalogueCached()
    expect(failed.ok).toBe(false)
    const retried = await fetchAssetsCatalogueCached()
    expect(retried.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
