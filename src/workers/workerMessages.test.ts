import { describe, expect, it } from 'vitest'
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
    scenarios: [],
  }))

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
      algorithms: { model: 'test', prng: 'test', quantile: 'test' },
    },
    terminalWealth: new Float64Array([1000]),
    quantiles: {
      p10: new Float64Array([1]),
      p25: new Float64Array([2]),
      p50: new Float64Array([3]),
      p75: new Float64Array([4]),
      p90: new Float64Array([5]),
    },
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

    expect(transferList).toHaveLength(1 + 5 + 2)
    expect(transferList).toContain(result.terminalWealth.buffer)
    expect(transferList).toContain(result.quantiles.p10.buffer)
    expect(transferList).toContain(result.quantiles.p90.buffer)
    expect(transferList).toContain(result.retainedPaths[0].values.buffer)
    expect(transferList).toContain(result.retainedPaths[1].values.buffer)
  })

  it('scales with zero retained paths', () => {
    const result = createResult(0)
    expect(buildTransferList(result)).toHaveLength(6)
  })
})
