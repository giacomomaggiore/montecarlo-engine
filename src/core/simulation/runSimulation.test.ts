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
      metrics: 'metrics-v1',
    })
    // The result must carry the aligned date axis so the UI can map a
    // bootstrap sourceRowIndex back to a real historical week.
    expect(result.value.metadata.datasetDates).toEqual([...dataset.dates])
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
    // The only path failed, so there is no finite terminal-wealth
    // distribution to select a representative path from — an empty list,
    // never a fabricated pick.
    expect(result.value.representativePaths).toEqual([])
  })

  it('selects the real path nearest each terminal-wealth quantile, not a cross-sectional aggregate', () => {
    const dataset = createDataset()
    // 5 single-period paths with both assets given the same scripted return,
    // so path i's terminal wealth is exactly a hand-checkable
    // 1000 * (1 + scriptedReturns[i]) on the $1000 lump sum.
    const scriptedReturns = [0, 0.1, 0.2, 0.3, 0.4]
    let callIndex = 0
    const scriptedEngine: SimulationEngine = {
      nextScenario: () => {
        const r = scriptedReturns[callIndex]
        callIndex += 1
        return {
          assetReturns: [r, r],
          inflation: 0,
          riskFreeRate: 0,
          sourceRowIndex: 0,
        }
      },
    }

    const result = runSimulation({
      engine: scriptedEngine,
      dataset,
      config: createConfig({ paths: 5, periods: 1 }),
      modelVersion: 'test-model',
      prngVersion: 'test-prng',
    })
    if (!result.ok) throw new Error('expected a successful run')

    expect(Array.from(result.value.terminalWealth)).toEqual([
      1000, 1100, 1200, 1300, 1400,
    ])

    // computeQuantile's h = (n-1)*q over the sorted terminal wealths above
    // (n=5): p1 -> h=0.04 -> target 1004, nearest is path 0 (dist 4).
    // p10 -> h=0.4 -> target 1040, nearest is path 0 (dist 40, vs path 1's
    // dist 60) -- p1 and p10 collapse onto the same nearest path with only
    // 5 candidates, which is expected (see selectRepresentativePaths).
    // p25 -> h=1.0 -> exactly path 1 (1100). p50 -> h=2.0 -> exactly path 2
    // (1200). p75 -> h=3.0 -> exactly path 3 (1300). p90 -> h=3.6 -> target
    // 1360, nearest is path 4 (dist 40, vs path 3's dist 60). p99 -> h=3.96
    // -> target 1396, nearest is path 4 (dist 4) -- again collapsing with p90.
    expect(result.value.representativePaths).toHaveLength(7)
    const byLevel = new Map(
      result.value.representativePaths.map((path) => [
        path.quantileLevel,
        path,
      ]),
    )
    expect(byLevel.get(0.01)?.pathIndex).toBe(0)
    expect(byLevel.get(0.1)?.pathIndex).toBe(0)
    expect(byLevel.get(0.25)?.pathIndex).toBe(1)
    expect(byLevel.get(0.5)?.pathIndex).toBe(2)
    expect(byLevel.get(0.75)?.pathIndex).toBe(3)
    expect(byLevel.get(0.9)?.pathIndex).toBe(4)
    expect(byLevel.get(0.99)?.pathIndex).toBe(4)

    // The selected path's own full trajectory is returned, not a
    // period-by-period aggregate: path 2's period-0 value is the shared
    // $1000 starting point, and its period-1 value is its own $1200
    // terminal wealth.
    const median = byLevel.get(0.5)
    expect(median?.terminalWealth).toBeCloseTo(1200)
    expect(median?.values[0]).toBeCloseTo(1000)
    expect(median?.values[1]).toBeCloseTo(1200)
  })

  it('reports batch progress without changing the computed result', () => {
    const dataset = createDataset()
    const config = createConfig({ paths: 5, periods: 2 })

    const batched = runSimulation({
      engine: createHistoricalBootstrapEngine(dataset, 0),
      dataset,
      config,
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
    })
    const unbatched = runSimulation({
      engine: createHistoricalBootstrapEngine(dataset, 0),
      dataset,
      config,
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
    })
    if (!batched.ok || !unbatched.ok) {
      throw new Error('expected two successful runs')
    }
    expect(Array.from(batched.value.terminalWealth)).toEqual(
      Array.from(unbatched.value.terminalWealth),
    )

    const progressCalls: Array<[number, number]> = []
    const withProgress = runSimulation({
      engine: createHistoricalBootstrapEngine(dataset, 0),
      dataset,
      config,
      modelVersion: 'historical-bootstrap-v1',
      prngVersion: 'xoshiro128**-v1',
      batchSize: 2,
      onBatchComplete: (pathsCompleted, totalPaths) => {
        progressCalls.push([pathsCompleted, totalPaths])
      },
    })
    if (!withProgress.ok) throw new Error('expected a successful run')

    // 5 paths at batchSize 2: boundaries at 2 and 4, plus a final partial
    // batch of 1 at the last path — the callback must still fire there so a
    // Worker host always sees a 100%-complete notification.
    expect(progressCalls).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ])
    expect(Array.from(withProgress.value.terminalWealth)).toEqual(
      Array.from(unbatched.value.terminalWealth),
    )
  })
})
