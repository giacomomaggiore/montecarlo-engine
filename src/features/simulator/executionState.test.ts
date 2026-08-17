import { describe, expect, it } from 'vitest'
import { REPRESENTATIVE_PATH_QUANTILE_LEVELS } from '../../core/math/quantiles'
import type { SimulationResult } from '../../core/simulation/simulationTypes'
import {
  IDLE_STATE,
  messageToAction,
  reduceExecutionState,
} from './executionState'
import type { ExecutionState } from './executionState'

function fakeResult(): SimulationResult {
  return {
    metadata: {
      config: {
        weights: [1],
        initialInvestment: 1,
        cashFlow: { mode: 'lumpSum' },
        paths: 1,
        periods: 1,
        seed: 0,
      },
      dataset: {
        version: 'v',
        checksum: 'c',
        frequency: 'weekly',
        baseCurrency: 'USD',
      },
      portfolioAssetIds: ['AAA'],
      datasetDates: ['2020-01-05'],
      benchmarkAssetId: null,
      algorithms: { model: 'm', prng: 'p', quantile: 'q', metrics: 'x' },
    },
    terminalWealth: new Float64Array([1]),
    benchmarkTerminalWealth: null,
    metrics: {
      terminalWealth: null,
      lossProbability: 0,
      ruinProbability: 0,
      growth: { kind: 'cagr', summary: null },
      annualizedVolatility: null,
      sharpeRatio: null,
      maxDrawdown: null,
      transactionCosts: null,
      realizedGainLoss: null,
      taxesPaid: null,
      lossCarryforward: null,
      benchmark: null,
    },
    representativePaths: REPRESENTATIVE_PATH_QUANTILE_LEVELS.map(
      (quantileLevel) => ({
        quantileLevel,
        pathIndex: 0,
        terminalWealth: 1,
        values: new Float64Array([1]),
        priceLevels: new Float64Array([1]),
      }),
    ),
    retainedPaths: [],
    failures: [],
  }
}

describe('reduceExecutionState — transition table', () => {
  it('idle -> loading-data -> running on a normal run() call', () => {
    let state: ExecutionState = IDLE_STATE
    state = reduceExecutionState(state, {
      type: 'loading-data-started',
      runId: 'r1',
    })
    expect(state).toEqual({ status: 'loading-data', runId: 'r1' })

    state = reduceExecutionState(state, {
      type: 'run-started',
      runId: 'r1',
      totalPaths: 100,
    })
    expect(state).toEqual({
      status: 'running',
      runId: 'r1',
      pathsCompleted: 0,
      totalPaths: 100,
    })
  })

  it('running -> completed on a matching result message', () => {
    const running: ExecutionState = {
      status: 'running',
      runId: 'r1',
      pathsCompleted: 5,
      totalPaths: 10,
    }
    const result = fakeResult()
    const next = reduceExecutionState(
      running,
      messageToAction({ type: 'result', runId: 'r1', result }),
    )
    expect(next).toEqual({ status: 'completed', runId: 'r1', result })
  })

  it('running -> failed on a matching error message', () => {
    const running: ExecutionState = {
      status: 'running',
      runId: 'r1',
      pathsCompleted: 0,
      totalPaths: 10,
    }
    const errors = [{ code: 'x', message: 'bad' }]
    const next = reduceExecutionState(
      running,
      messageToAction({ type: 'error', runId: 'r1', errors }),
    )
    expect(next).toEqual({ status: 'failed', runId: 'r1', errors })
  })

  it('loading-data -> failed on a matching load-failed action', () => {
    const loading: ExecutionState = { status: 'loading-data', runId: 'r1' }
    const errors = [{ code: 'dataset.fetch.failed', message: 'boom' }]
    const next = reduceExecutionState(loading, {
      type: 'load-failed',
      runId: 'r1',
      errors,
    })
    expect(next).toEqual({ status: 'failed', runId: 'r1', errors })
  })

  it('running -> cancelled on cancel()', () => {
    const running: ExecutionState = {
      status: 'running',
      runId: 'r1',
      pathsCompleted: 0,
      totalPaths: 10,
    }
    expect(reduceExecutionState(running, { type: 'cancel' })).toEqual({
      status: 'cancelled',
      runId: 'r1',
    })
  })

  it('cancel() while idle or completed is a no-op', () => {
    expect(reduceExecutionState(IDLE_STATE, { type: 'cancel' })).toBe(
      IDLE_STATE,
    )
    const completed: ExecutionState = {
      status: 'completed',
      runId: 'r1',
      result: fakeResult(),
    }
    expect(reduceExecutionState(completed, { type: 'cancel' })).toBe(completed)
  })
})

describe('reduceExecutionState — stale message rejection', () => {
  it('drops a progress message from a superseded run', () => {
    const running: ExecutionState = {
      status: 'running',
      runId: 'r2',
      pathsCompleted: 3,
      totalPaths: 10,
    }
    const stale = messageToAction({
      type: 'progress',
      runId: 'r1',
      pathsCompleted: 9,
      totalPaths: 10,
    })
    expect(reduceExecutionState(running, stale)).toBe(running)
  })

  it('drops a result message that arrives after cancellation', () => {
    const cancelled: ExecutionState = { status: 'cancelled', runId: 'r1' }
    const staleResult = messageToAction({
      type: 'result',
      runId: 'r1',
      result: fakeResult(),
    })
    expect(reduceExecutionState(cancelled, staleResult)).toBe(cancelled)
  })

  it('drops a run-started completion for a run that was already cancelled', () => {
    const cancelled: ExecutionState = { status: 'cancelled', runId: 'r1' }
    expect(
      reduceExecutionState(cancelled, {
        type: 'run-started',
        runId: 'r1',
        totalPaths: 10,
      }),
    ).toBe(cancelled)
  })

  it('drops a load-failed action for a run that was already cancelled', () => {
    const cancelled: ExecutionState = { status: 'cancelled', runId: 'r1' }
    expect(
      reduceExecutionState(cancelled, {
        type: 'load-failed',
        runId: 'r1',
        errors: [{ code: 'x', message: 'stale' }],
      }),
    ).toBe(cancelled)
  })

  it('drops a load-failed action whose runId no longer matches the current loading-data run', () => {
    const loading: ExecutionState = { status: 'loading-data', runId: 'r2' }
    expect(
      reduceExecutionState(loading, {
        type: 'load-failed',
        runId: 'r1',
        errors: [{ code: 'x', message: 'stale' }],
      }),
    ).toBe(loading)
  })

  it('applies a fresh progress message for the current run', () => {
    const running: ExecutionState = {
      status: 'running',
      runId: 'r1',
      pathsCompleted: 3,
      totalPaths: 10,
    }
    const next = reduceExecutionState(
      running,
      messageToAction({
        type: 'progress',
        runId: 'r1',
        pathsCompleted: 7,
        totalPaths: 10,
      }),
    )
    expect(next).toEqual({
      status: 'running',
      runId: 'r1',
      pathsCompleted: 7,
      totalPaths: 10,
    })
  })
})
