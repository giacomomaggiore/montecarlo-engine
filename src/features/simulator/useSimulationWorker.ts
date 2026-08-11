import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AlignedDataset } from '../../core/data/datasetTypes'
import type { SimulationConfig } from '../../core/simulation/simulationTypes'
import type {
  RunRequestMessage,
  WorkerResponseMessage,
} from '../../workers/workerMessages'
import {
  IDLE_STATE,
  messageToAction,
  reduceExecutionState,
} from './executionState'

export type RunSimulationRequest = {
  readonly dataset: AlignedDataset
  readonly config: SimulationConfig
  readonly modelVersion: string
  readonly prngVersion: string
}

// The only place allowed to construct or terminate a real Worker. State
// transitions and stale-message filtering are delegated entirely to
// reduceExecutionState()/messageToAction(), which are unit-tested without a
// Worker; this hook is deliberately thin glue around them.
export function useSimulationWorker() {
  const [state, dispatch] = useReducer(reduceExecutionState, IDLE_STATE)
  const workerRef = useRef<Worker | null>(null)

  const run = useCallback((request: RunSimulationRequest) => {
    // A fresh Worker per run — never a reused, long-lived one — is what
    // makes cancel() a true hard stop: runSimulation's loop is synchronous
    // and has no cooperative point to check a "please stop" flag mid-batch.
    workerRef.current?.terminate()

    const runId = crypto.randomUUID()
    dispatch({ type: 'loading-data-started', runId })

    const worker = new Worker(
      new URL('../../workers/simulation.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      dispatch(messageToAction(event.data))
    }

    // Dataset construction is synchronous today (the Phase 2 placeholder
    // fixture); this still goes through the same loading-data -> running
    // transition the real, asynchronous Dataset artifact gate loader will
    // use once it replaces the placeholder.
    dispatch({ type: 'run-started', runId, totalPaths: request.config.paths })

    const message: RunRequestMessage = { type: 'run', runId, ...request }
    worker.postMessage(message)
  }, [])

  const cancel = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    dispatch({ type: 'cancel' })
  }, [])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  return { state, run, cancel }
}
