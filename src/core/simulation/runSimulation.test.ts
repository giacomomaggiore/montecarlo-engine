import { describe, expect, it } from 'vitest'
import type { AlignedDataset } from '../data/datasetTypes'
import { createHistoricalBootstrapEngine } from './historicalBootstrap'
import { RETAINED_PATH_COUNT, runSimulation } from './runSimulation'
import type { SimulationEngine } from './simulationEngine'
import type { SimulationConfig } from './simulationTypes'
import { MAX_PATHS } from './simulationTypes'

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

function createConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return {
    weights: [0.5, 0.5],
    initialInvestment: 1000,
    cashFlow: { mode: 'lumpSum' },
    paths: 1,
    periods: 3,
    seed: 0,
    ...overrides,
  }
}

describe('runSimulation', () => {
  it('matches a hand-calculated three-period single-path run', () => {
    const dataset = createDataset()
    const engine = createHistoricalBootstrapEngine(dataset, 0)
    const config = createConfig()

    const result = runSimulation({
      engine,
      dataset,
      config,
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
    })

    if (!result.ok) throw new Error('expected a successful run')

    // Seed 0 draws source rows [0, 0, 3, ...] for this fixture (see
    // historicalBootstrap.test.ts). Weights are 50/50 on a $1000 lump sum.
    // Period 0: [500, 500]                          -> equity 1000
    // Period 1 (row 0, +1%/-1%): [505, 495]          -> equity 1000
    // Period 2 (row 0, +1%/-1%): [510.05, 490.05]    -> equity 1000.1
    // Period 3 (row 3, +4%/-4%): [530.452, 470.448]  -> equity 1000.9
    expect(result.value.terminalWealth[0]).toBeCloseTo(1000.9)
    expect(result.value.retainedPaths[0].values[0]).toBeCloseTo(1000)
    expect(result.value.retainedPaths[0].values[1]).toBeCloseTo(1000)
    expect(result.value.retainedPaths[0].values[2]).toBeCloseTo(1000.1)
    expect(result.value.retainedPaths[0].values[3]).toBeCloseTo(1000.9)
    expect(result.value.failures).toEqual([])
  })

  it('carries the caller-supplied model/prng versions and its own quantile version', () => {
    const dataset = createDataset()
    const engine = createHistoricalBootstrapEngine(dataset, 1)
    const config = createConfig()
    const result = runSimulation({
      engine,
      dataset,
      config,
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
    })

    if (!result.ok) throw new Error('expected a successful run')
    expect(result.value.metadata.algorithms).toEqual({
      model: 'historical-bootstrap-v1',
      prng: 'xoshiro128**-v1',
      quantile: 'quantile-linear-interpolation-v1',
    })
    expect(result.value.metadata.dataset).toBe(dataset.identity)
    expect(result.value.metadata.config).toBe(config)
  })

  it('rejects an invalid configuration without running anything', () => {
    const dataset = createDataset()
    const engine = createHistoricalBootstrapEngine(dataset, 0)

    const result = runSimulation({
      engine,
      dataset,
      config: createConfig({ paths: MAX_PATHS + 1 }),
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
    })

    expect(result.ok).toBe(false)
  })

  it('retains at most RETAINED_PATH_COUNT paths, by index, in order', () => {
    const dataset = createDataset()
    const engine = createHistoricalBootstrapEngine(dataset, 0)

    const fewPaths = runSimulation({
      engine,
      dataset,
      config: createConfig({ paths: 3, periods: 1 }),
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
    })
    if (!fewPaths.ok) throw new Error('expected a successful run')
    expect(fewPaths.value.retainedPaths.map((path) => path.pathIndex)).toEqual([
      0, 1, 2,
    ])

    const manyPaths = runSimulation({
      engine: createHistoricalBootstrapEngine(dataset, 0),
      dataset,
      config: createConfig({ paths: 60, periods: 1 }),
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
    })
    if (!manyPaths.ok) throw new Error('expected a successful run')
    expect(manyPaths.value.retainedPaths).toHaveLength(RETAINED_PATH_COUNT)
    expect(manyPaths.value.retainedPaths[0].pathIndex).toBe(0)
    expect(manyPaths.value.retainedPaths[49].pathIndex).toBe(49)
  })

  it('records an explicit failure and NaN (not zero) for the rest of a broken path', () => {
    const dataset = createDataset()
    const brokenEngine: SimulationEngine = {
      nextScenario: () => ({
        assetReturns: [Infinity, 0],
        inflation: 0,
        riskFreeRate: 0,
        sourceRowIndex: 0,
      }),
    }

    const result = runSimulation({
      engine: brokenEngine,
      dataset,
      config: createConfig({ paths: 1, periods: 2 }),
      modelVersion: 'test-model',
      prngVersion: 'test-prng',
    })

    if (!result.ok) throw new Error('expected a validated (not failed) run')

    expect(result.value.failures).toEqual([
      {
        pathIndex: 0,
        periodIndex: 1,
        code: 'non-finite-equity',
        message: 'Portfolio equity became non-finite during accounting.',
      },
    ])
    expect(Number.isNaN(result.value.terminalWealth[0])).toBe(true)
    expect(result.value.retainedPaths[0].values[0]).toBeCloseTo(1000)
    expect(Number.isNaN(result.value.retainedPaths[0].values[1])).toBe(true)
    expect(Number.isNaN(result.value.retainedPaths[0].values[2])).toBe(true)
    // The only path failed, so every later quantile band has nothing finite to
    // aggregate and must say so honestly (NaN), never a fabricated zero.
    expect(Number.isNaN(result.value.quantiles.p50[1])).toBe(true)
    expect(Number.isNaN(result.value.quantiles.p50[2])).toBe(true)
    expect(result.value.quantiles.p50[0]).toBeCloseTo(1000)
  })
})
