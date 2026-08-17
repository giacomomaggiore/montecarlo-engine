import { describe, expect, it } from 'vitest'
import {
  type AlignedDataset,
  type BaseCurrency,
  type DatasetIdentity,
  type Frequency,
  validateAlignedDataset,
} from './datasetTypes'

describe('validateAlignedDataset', () => {
  it('accepts the weekly observation boundary', () => {
    const result = validateAlignedDataset(createDataset())

    expect(result.ok).toBe(true)
  })

  it('accepts the monthly observation boundary', () => {
    const result = validateAlignedDataset(createDataset({ frequency: 'monthly', rowCount: 60 }))

    expect(result.ok).toBe(true)
  })

  it('allows an asset return of exactly -100%', () => {
    const assetReturns = new Float32Array(260).fill(0.01)
    assetReturns[0] = -1

    const result = validateAlignedDataset(createDataset({ assetReturns: [assetReturns] }))

    expect(result.ok).toBe(true)
  })

  it.each([
    [
      'an empty version',
      (dataset: AlignedDataset) => ({
        ...dataset,
        identity: { ...dataset.identity, version: '' },
      }),
      'dataset.version',
    ],
    [
      'an unsupported frequency',
      (dataset: AlignedDataset) => ({
        ...dataset,
        identity: { ...dataset.identity, frequency: 'daily' as Frequency },
      }),
      'dataset.frequency',
    ],
    [
      'too few weekly observations',
      () => createDataset({ rowCount: 259 }),
      'dataset.observations.minimum',
    ],
    [
      'duplicate asset identifiers',
      () => createDataset({ assetIds: ['AAA', 'AAA'] }),
      'dataset.assets.identifiers',
    ],
    [
      'more than six assets',
      () => createDataset({ assetIds: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }),
      'dataset.assets.maximum',
    ],
    [
      'a missing asset return column',
      () => createDataset({ assetIds: ['AAA', 'BBB'], assetReturns: [new Float32Array(260)] }),
      'dataset.assets.columns',
    ],
    [
      'a non-increasing date',
      (dataset: AlignedDataset) => {
        const dates = [...dataset.dates]
        dates[1] = dates[0]
        return { ...dataset, dates }
      },
      'dataset.dates.order',
    ],
    [
      'an invalid date',
      (dataset: AlignedDataset) => {
        const dates = [...dataset.dates]
        dates[0] = '2024-02-30'
        return { ...dataset, dates }
      },
      'dataset.dates.format',
    ],
    [
      'a mismatched special-series length',
      (dataset: AlignedDataset) => ({
        ...dataset,
        inflation: new Float32Array(259),
      }),
      'dataset.series.length',
    ],
    [
      'a non-finite value',
      (dataset: AlignedDataset) => {
        const inflation = new Float32Array(dataset.inflation)
        inflation[0] = Number.NaN
        return { ...dataset, inflation }
      },
      'dataset.series.finite',
    ],
    [
      'a return below -100%',
      (dataset: AlignedDataset) => {
        const assetReturns = [new Float32Array(dataset.assetReturns[0])]
        assetReturns[0][0] = -1.01
        return { ...dataset, assetIds: ['AAA'], assetReturns }
      },
      'dataset.returns.bound',
    ],
  ])('rejects %s', (_description, createInvalidDataset, expectedCode) => {
    const result = validateAlignedDataset(createInvalidDataset(createDataset()))

    expect(errorCodes(result)).toContain(expectedCode)
  })
})

type DatasetOptions = {
  readonly frequency?: Frequency
  readonly baseCurrency?: BaseCurrency
  readonly rowCount?: number
  readonly assetIds?: readonly string[]
  readonly assetReturns?: readonly Float32Array[]
}

function createDataset(options: DatasetOptions = {}): AlignedDataset {
  const frequency = options.frequency ?? 'weekly'
  const rowCount = options.rowCount ?? (frequency === 'weekly' ? 260 : 60)
  const assetIds = options.assetIds ?? ['AAA']

  return {
    identity: createIdentity(frequency, options.baseCurrency ?? 'USD'),
    assetIds,
    dates: createDates(rowCount),
    assetReturns:
      options.assetReturns ?? assetIds.map(() => new Float32Array(rowCount).fill(0.01)),
    inflation: new Float32Array(rowCount).fill(0.001),
    riskFreeRates: new Float32Array(rowCount).fill(0.0005),
  }
}

function createIdentity(frequency: Frequency, baseCurrency: BaseCurrency): DatasetIdentity {
  return {
    version: '2026.08.04',
    checksum: 'test-checksum',
    frequency,
    baseCurrency,
  }
}

function createDates(rowCount: number): string[] {
  const firstDate = Date.UTC(2020, 0, 1)

  return Array.from({ length: rowCount }, (_, index) => {
    const date = new Date(firstDate + index * 86_400_000)
    return date.toISOString().slice(0, 10)
  })
}

function errorCodes(result: {
  readonly ok: boolean
  readonly errors?: readonly { code: string }[]
}): readonly string[] {
  return result.ok ? [] : (result.errors ?? []).map((error) => error.code)
}