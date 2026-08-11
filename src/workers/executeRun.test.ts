import { describe, expect, it } from 'vitest'
import { createPlaceholderDataset } from '../features/simulator/placeholderDataset'
import { createHistoricalBootstrapEngine } from '../core/simulation/historicalBootstrap'
import { runSimulation } from '../core/simulation/runSimulation'
import type { SimulationConfig } from '../core/simulation/simulationTypes'
import { computeBatchSize, executeRun } from './executeRun'
import type { RunRequestMessage, WorkerResponseMessage } from './workerMessages'

const MODEL_VERSION = 'historical-bootstrap-v1'
const PRNG_VERSION = 'xoshiro128**-v1'

function createConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return {
    weights: [0.6, 0.4],
    initialInvestment: 10_000,
    cashFlow: { mode: 'lumpSum' },
    paths: 10,
    periods: 5,
    seed: 42,
    ...overrides,
  }
}

function createRequest(
  overrides: Partial<RunRequestMessage> = {},
): RunRequestMessage {
  return {
    type: 'run',
    runId: 'run-1',
    dataset: createPlaceholderDataset(),
    config: createConfig(),
    modelVersion: MODEL_VERSION,
    prngVersion: PRNG_VERSION,
    ...overrides,
  }
}

describe('computeBatchSize', () => {
  it('never returns fewer than 1', () => {
    expect(computeBatchSize(1)).toBe(1)
  })

  it('targets roughly 20 progress notifications for a large run', () => {
    expect(computeBatchSize(2000)).toBe(100)
  })
})

describe('executeRun', () => {
  it('emits increasing progress and one terminal result message', () => {
    const messages: WorkerResponseMessage[] = []
    executeRun(createRequest(), (message) => messages.push(message))

    const progressMessages = messages.filter((m) => m.type === 'progress')
    expect(progressMessages.length).toBeGreaterThan(0)
    for (let i = 1; i < progressMessages.length; i += 1) {
      expect(progressMessages[i].pathsCompleted).toBeGreaterThan(
        progressMessages[i - 1].pathsCompleted,
      )
    }

    const terminalMessages = messages.filter(
      (m) => m.type === 'result' || m.type === 'error',
    )
    expect(terminalMessages).toHaveLength(1)
    expect(terminalMessages[0].type).toBe('result')
  })

  it('produces the exact same result a direct runSimulation call would', () => {
    const request = createRequest()
    const messages: WorkerResponseMessage[] = []
    executeRun(request, (message) => messages.push(message))

    const resultMessage = messages.find((m) => m.type === 'result')
    if (!resultMessage || resultMessage.type !== 'result') {
      throw new Error('expected a result message')
    }

    const direct = runSimulation({
      engine: createHistoricalBootstrapEngine(
        request.dataset,
        request.config.seed,
      ),
      dataset: request.dataset,
      config: request.config,
      modelVersion: MODEL_VERSION,
      prngVersion: PRNG_VERSION,
    })
    if (!direct.ok) throw new Error('expected a successful direct run')

    expect(Array.from(resultMessage.result.terminalWealth)).toEqual(
      Array.from(direct.value.terminalWealth),
    )
  })

  it('emits one explicit error message, never a thrown exception, for an invalid config', () => {
    const messages: WorkerResponseMessage[] = []

    expect(() =>
      executeRun(
        createRequest({ config: createConfig({ paths: 0 }) }),
        (message) => messages.push(message),
      ),
    ).not.toThrow()

    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('error')
  })

  it('emits an explicit error message for an invalid dataset, never a thrown exception', () => {
    const messages: WorkerResponseMessage[] = []
    const invalidDataset = { ...createPlaceholderDataset(), assetIds: [] }

    expect(() =>
      executeRun(createRequest({ dataset: invalidDataset }), (message) =>
        messages.push(message),
      ),
    ).not.toThrow()

    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('error')
  })
})
