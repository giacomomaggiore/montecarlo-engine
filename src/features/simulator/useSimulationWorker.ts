import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AlignedDataset } from '../../core/data/datasetTypes'
import type {
  SimulationAssetSelection,
  SimulationConfig,
} from '../../core/simulation/simulationTypes'
import type { ValidationResult } from '../../core/validation'
import type {
  EngineSelection,
  RunRequestMessage,
  WorkerResponseMessage,
} from '../../workers/workerMessages'
import {
  IDLE_STATE,
  messageToAction,
  reduceExecutionState,
} from './executionState'

export type RunSimulationRequest = {
  // A thunk rather than an already-resolved AlignedDataset: the real
  // Dataset artifact gate loader (core/data/loadDataset.ts) fetches and
  // validates the dataset asynchronously, so the hook itself owns the
  // loading-data -> running/failed transition around that await instead of
  // asking every caller to manage it.
  readonly loadDataset: () => Promise<ValidationResult<AlignedDataset>>
  readonly config: SimulationConfig
  readonly selection: SimulationAssetSelection
  // Which engine the Worker should construct (discriminated union). The
  // Worker side derives the model/PRNG version strings itself -- the caller
  // no longer passes them, so they can never disagree with the engine
  // actually constructed.
  readonly engineSelection: EngineSelection
}

// The only place allowed to construct or terminate a real Worker. State
// transitions and stale-message filtering are delegated entirely to
// reduceExecutionState()/messageToAction(), which are unit-tested without a
// Worker; this hook is deliberately thin glue around them.
export function useSimulationWorker() {
  const [state, dispatch] = useReducer(reduceExecutionState, IDLE_STATE)
  const workerRef = useRef<Worker | null>(null)
  // Tracks which run() call is the most recent one, independent of the
  // reducer's own state. Needed because loadDataset() is asynchronous: if
  // the user calls run() again (or cancel()) while an earlier call is still
  // awaiting its dataset, that earlier call's .then() callback must not go
  // on to construct a Worker nobody is displaying results for, even though
  // reduceExecutionState's own stale-run guard already stops it from
  // corrupting the *displayed* state.
  const latestRunIdRef = useRef<string | null>(null)

  const run = useCallback((request: RunSimulationRequest) => {
    // A fresh Worker per run — never a reused, long-lived one — is what
    // makes cancel() a true hard stop: runSimulation's loop is synchronous
    // and has no cooperative point to check a "please stop" flag mid-batch.
    workerRef.current?.terminate()
    workerRef.current = null

    const runId = crypto.randomUUID()
    latestRunIdRef.current = runId
    dispatch({ type: 'loading-data-started', runId })

    request.loadDataset().then((datasetResult) => {
      if (latestRunIdRef.current !== runId) {
        return // superseded by a newer run() or cancel() while loading.
      }

      if (!datasetResult.ok) {
        dispatch({ type: 'load-failed', runId, errors: datasetResult.errors })
        return
      }

      dispatch({ type: 'run-started', runId, totalPaths: request.config.paths })

      const worker = new Worker(
        new URL('../../workers/simulation.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker

      worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
        dispatch(messageToAction(event.data))
      }

      const message: RunRequestMessage = {
        type: 'run',
        runId,
        dataset: datasetResult.value,
        config: request.config,
        selection: request.selection,
        engineSelection: request.engineSelection,
      }
      worker.postMessage(message)
    })
  }, [])

  const cancel = useCallback(() => {
    latestRunIdRef.current = null
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
