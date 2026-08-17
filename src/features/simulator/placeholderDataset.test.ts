import { describe, expect, it } from 'vitest'
import { validateAlignedDataset } from '../../core/data/datasetTypes'
import {
  PLACEHOLDER_DATASET_VERSION,
  createPlaceholderDataset,
} from './placeholderDataset'

describe('createPlaceholderDataset', () => {
  it('passes the same validation the real dataset loader will use', () => {
    const result = validateAlignedDataset(createPlaceholderDataset())
    expect(result.ok).toBe(true)
  })

  it('has at least the 260-row weekly minimum', () => {
    const dataset = createPlaceholderDataset()
    expect(dataset.dates.length).toBeGreaterThanOrEqual(260)
  })

  it('is reproducible across calls, like every other seeded fixture', () => {
    const first = createPlaceholderDataset()
    const second = createPlaceholderDataset()
    expect(Array.from(first.assetReturns[0])).toEqual(
      Array.from(second.assetReturns[0]),
    )
    expect(first.dates).toEqual(second.dates)
  })

  it('is unambiguously labelled as a placeholder', () => {
    const dataset = createPlaceholderDataset()
    expect(dataset.identity.version).toBe(PLACEHOLDER_DATASET_VERSION)
    expect(dataset.identity.version).toContain('placeholder')
  })
})
