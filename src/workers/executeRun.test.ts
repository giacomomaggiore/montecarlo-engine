import { describe, expect, it } from 'vitest'
import { createPlaceholderDataset } from '../features/simulator/placeholderDataset'
import { createHistoricalBootstrapEngine } from '../core/simulation/historicalBootstrap'
import {
  createParametricStudentTEngine,
  fitParametricStudentT,
  PARAMETRIC_STUDENT_T_MODEL_VERSION,
  type ParametricStudentTOptions,
} from '../core/simulation/parametricStudentT'
import { runSimulation } from '../core/simulation/runSimulation'
import type { SimulationConfig } from '../core/simulation/simulationTypes'
import { computeBatchSize, executeRun } from './executeRun'
import type { RunRequestMessage, WorkerResponseMessage } from './workerMessages'

const MODEL_VERSION = 'historical-bootstrap-v1'
const PRNG_VERSION = 'xoshiro128**-v1'

const PARAMETRIC_OPTIONS: ParametricStudentTOptions = {
  annualInflation: 0.02,
  annualRiskFreeRate: 0.03,
}

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
    engineSelection: { engine: 'bootstrap' },
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

  it('produces the exact same bootstrap result a direct runSimulation call would', () => {
    // Also proves the Phase 3.5 protocol change (engineSelection replacing
    // caller-supplied version strings) left bootstrap output byte-identical:
    // the direct call below still passes the same versions the Worker path
    // now derives internally.
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

    expect(resultMessage.result.metadata.algorithms.model).toBe(MODEL_VERSION)
    expect(resultMessage.result.metadata.algorithms.prng).toBe(PRNG_VERSION)
    expect(Array.from(resultMessage.result.terminalWealth)).toEqual(
      Array.from(direct.value.terminalWealth),
    )
  })

  it('runs the parametric Student t engine end to end with its own model version', () => {
    const request = createRequest({
      engineSelection: { engine: 'studentT', options: PARAMETRIC_OPTIONS },
    })
    const messages: WorkerResponseMessage[] = []
    executeRun(request, (message) => messages.push(message))

    const progressMessages = messages.filter((m) => m.type === 'progress')
    expect(progressMessages.length).toBeGreaterThan(0)

    const resultMessage = messages.find((m) => m.type === 'result')
    if (!resultMessage || resultMessage.type !== 'result') {
      throw new Error('expected a result message')
    }
    expect(resultMessage.result.metadata.algorithms.model).toBe(
      PARAMETRIC_STUDENT_T_MODEL_VERSION,
    )

    // Cross-check against the direct fit + engine + runSimulation chain,
    // mirroring the bootstrap identity test above.
    const fit = fitParametricStudentT(request.dataset, PARAMETRIC_OPTIONS)
    if (!fit.ok) throw new Error('expected a successful fit')
    const direct = runSimulation({
      engine: createParametricStudentTEngine(fit.value, request.config.seed),
      dataset: request.dataset,
      config: request.config,
      modelVersion: PARAMETRIC_STUDENT_T_MODEL_VERSION,
      prngVersion: PRNG_VERSION,
    })
    if (!direct.ok) throw new Error('expected a successful direct run')

    expect(Array.from(resultMessage.result.terminalWealth)).toEqual(
      Array.from(direct.value.terminalWealth),
    )
  })

  it('emits one explicit error message when the parametric fit fails', () => {
    const messages: WorkerResponseMessage[] = []

    expect(() =>
      executeRun(
        createRequest({
          engineSelection: {
            engine: 'studentT',
            // Invalid option: annual inflation at exactly -100%.
            options: { ...PARAMETRIC_OPTIONS, annualInflation: -1 },
          },
        }),
        (message) => messages.push(message),
      ),
    ).not.toThrow()

    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('error')
    if (messages[0].type === 'error') {
      expect(messages[0].errors[0].code).toBe(
        'parametric.options.annualInflation',
      )
    }
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
