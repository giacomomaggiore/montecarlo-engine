import { describe, expect, it } from 'vitest'
import { REPRESENTATIVE_PATH_QUANTILE_LEVELS } from '../core/math/quantiles'
import type { SimulationResult } from '../core/simulation/simulationTypes'
import {
  buildTransferList,
  isCurrentRun,
  isResultMessage,
} from './workerMessages'

function createResult(retainedPathCount: number): SimulationResult {
  const retainedPaths = Array.from({ length: retainedPathCount }, (_, i) => ({
    pathIndex: i,
    values: new Float64Array([1, 2, 3]),
    contributions: new Float64Array([0, 1, 1]),
    priceLevels: new Float64Array([1, 1.001, 1.002]),
    trades: [[], [], []],
    scenarios: [],
  }))
  const representativePaths = REPRESENTATIVE_PATH_QUANTILE_LEVELS.map(
    (quantileLevel, i) => ({
      quantileLevel,
      pathIndex: i,
      terminalWealth: 1000 + i,
      values: new Float64Array([1000, 1000 + i]),
      priceLevels: new Float64Array([1, 1.001]),
    }),
  )

  return {
    metadata: {
      config: {
        weights: [1],
        initialInvestment: 1000,
        cashFlow: { mode: 'lumpSum' },
        paths: 1,
        periods: 1,
        seed: 0,
      },
      dataset: {
        version: 'test',
        checksum: 'test',
        frequency: 'weekly',
        baseCurrency: 'USD',
      },
      datasetDates: ['2020-01-05', '2020-01-12'],
      benchmarkAssetId: null,
      algorithms: {
        model: 'test',
        prng: 'test',
        quantile: 'test',
        metrics: 'test',
      },
    },
    terminalWealth: new Float64Array([1000]),
    benchmarkTerminalWealth: null,
    metrics: {
      terminalWealth: null,
      lossProbability: 0,
      ruinProbability: 0,
      growth: { kind: 'cagr', summary: null },
      annualizedVolatility: null,
      sharpeRatio: null,
      maxDrawdown: null,
      benchmark: null,
    },
    representativePaths,
    retainedPaths,
    failures: [],
  }
}

describe('isCurrentRun', () => {
  it('accepts a message whose runId matches the active run', () => {
    expect(isCurrentRun('run-1', 'run-1')).toBe(true)
  })

  it('rejects a message from any other run', () => {
    expect(isCurrentRun('run-2', 'run-1')).toBe(false)
    expect(isCurrentRun('run-1', '')).toBe(false)
  })
})

describe('isResultMessage', () => {
  it('narrows only result messages', () => {
    expect(
      isResultMessage({ type: 'result', runId: 'r', result: createResult(0) }),
    ).toBe(true)
    expect(
      isResultMessage({
        type: 'progress',
        runId: 'r',
        pathsCompleted: 1,
        totalPaths: 1,
      }),
    ).toBe(false)
    expect(isResultMessage({ type: 'error', runId: 'r', errors: [] })).toBe(
      false,
    )
  })
})

describe('buildTransferList', () => {
  it('returns exactly the buffers backing the result, by identity', () => {
    const result = createResult(2)
    const transferList = buildTransferList(result)

    // 1 terminal-wealth buffer, 2 per representative path (values +
    // priceLevels), 3 per retained path (values + contributions +
    // priceLevels).
    expect(transferList).toHaveLength(1 + 7 * 2 + 2 * 3)
    expect(transferList).toContain(result.terminalWealth.buffer)
    expect(transferList).toContain(result.representativePaths[0].values.buffer)
    expect(transferList).toContain(
      result.representativePaths[6].priceLevels.buffer,
    )
    expect(transferList).toContain(result.retainedPaths[0].values.buffer)
    expect(transferList).toContain(result.retainedPaths[1].contributions.buffer)
    expect(transferList).toContain(result.retainedPaths[1].priceLevels.buffer)
  })

  it('scales with zero retained paths', () => {
    const result = createResult(0)
    expect(buildTransferList(result)).toHaveLength(1 + 7 * 2)
  })
})
