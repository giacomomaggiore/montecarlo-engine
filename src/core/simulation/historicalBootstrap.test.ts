import { describe, expect, it } from 'vitest'
import type { AlignedDataset } from '../data/datasetTypes'
import {
  createHistoricalBootstrapEngine,
  HISTORICAL_BOOTSTRAP_MODEL_VERSION,
} from './historicalBootstrap'

describe('createHistoricalBootstrapEngine', () => {
  it('reports its versioned model identifier', () => {
    expect(HISTORICAL_BOOTSTRAP_MODEL_VERSION).toBe('historical-bootstrap-v1')
  })

  it('draws the fixed seeded sequence of complete historical rows', () => {
    const dataset = createDataset()
    const engine = createHistoricalBootstrapEngine(dataset, 0)

    const scenarios = Array.from({ length: 8 }, () => engine.nextScenario())

    expect(scenarios.map((scenario) => scenario.sourceRowIndex)).toEqual([
      0, 0, 3, 3, 2, 3, 0, 2,
    ])

    for (const scenario of scenarios) {
      const row = scenario.sourceRowIndex
      expect(scenario.assetReturns).toEqual(
        dataset.assetReturns.map((returns) => returns[row]),
      )
      expect(scenario.inflation).toBe(dataset.inflation[row])
      expect(scenario.riskFreeRate).toBe(dataset.riskFreeRates[row])
    }
  })

  it('repeats the same scenarios for the same seed and diverges for another seed', () => {
    const dataset = createDataset()
    const first = createHistoricalBootstrapEngine(dataset, 123)
    const second = createHistoricalBootstrapEngine(dataset, 123)
    const different = createHistoricalBootstrapEngine(dataset, 124)

    const firstScenarios = Array.from({ length: 20 }, () =>
      first.nextScenario(),
    )

    expect(firstScenarios).toEqual(
      Array.from({ length: 20 }, () => second.nextScenario()),
    )
    expect(firstScenarios).not.toEqual(
      Array.from({ length: 20 }, () => different.nextScenario()),
    )
  })

  it('returns a fresh asset-return array for every scenario', () => {
    const engine = createHistoricalBootstrapEngine(createDataset(), 0)
    const first = engine.nextScenario()
    const second = engine.nextScenario()

    expect(first.assetReturns).not.toBe(second.assetReturns)
  })

  it('keeps row frequencies within the declared finite-sample tolerance', () => {
    const rowCount = 4
    const sampleSize = 4_000
    const expectedFrequency = sampleSize / rowCount
    const tolerance = 150
    const counts = new Array<number>(rowCount).fill(0)
    const engine = createHistoricalBootstrapEngine(createDataset(), 456)

    for (let index = 0; index < sampleSize; index += 1) {
      counts[engine.nextScenario().sourceRowIndex] += 1
    }

    for (const count of counts) {
      expect(Math.abs(count - expectedFrequency)).toBeLessThanOrEqual(tolerance)
    }
  })
})

function createDataset(): AlignedDataset {
  return {
    identity: {
      version: 'test-version',
      checksum: 'test-checksum',
      frequency: 'weekly',
      baseCurrency: 'USD',
    },
    assetIds: ['AAA', 'BBB'],
    dates: ['2024-01-05', '2024-01-12', '2024-01-19', '2024-01-26'],
    assetReturns: [
      new Float32Array([0.01, 0.02, 0.03, 0.04]),
      new Float32Array([-0.01, -0.02, -0.03, -0.04]),
    ],
    inflation: new Float32Array([0.001, 0.002, 0.003, 0.004]),
    riskFreeRates: new Float32Array([0.0001, 0.0002, 0.0003, 0.0004]),
  }
}
