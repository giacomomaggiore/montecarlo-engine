import { validateAlignedDataset } from '../core/data/datasetTypes'
import { createHistoricalBootstrapEngine } from '../core/simulation/historicalBootstrap'
import { runSimulation } from '../core/simulation/runSimulation'
import type { SimulationEngine } from '../core/simulation/simulationEngine'
import type { RunRequestMessage, WorkerResponseMessage } from './workerMessages'

// Roughly this many progress notifications per run, regardless of path
// count — enough for a visibly moving indicator without flooding
// postMessage on a run of only a handful of paths.
const TARGET_PROGRESS_UPDATES = 20

export function computeBatchSize(paths: number): number {
  return Math.max(1, Math.ceil(paths / TARGET_PROGRESS_UPDATES))
}

// The only executable logic in the Phase 2 Worker boundary. It has no
// dependency on `self` or `postMessage` — `emit` is an injected plain
// function — so it is unit-testable exactly like core/, with a real
// `simulation.worker.ts` only wiring `self.onmessage`/`self.postMessage`
// around it.
export function executeRun(
  request: RunRequestMessage,
  emit: (message: WorkerResponseMessage) => void,
): void {
  const { runId, dataset, config, modelVersion, prngVersion } = request

  const datasetResult = validateAlignedDataset(dataset)
  if (!datasetResult.ok) {
    emit({ type: 'error', runId, errors: datasetResult.errors })
    return
  }

  // createHistoricalBootstrapEngine throws for a malformed seed rather than
  // returning a ValidationResult (see historicalBootstrap.ts) — the seed
  // itself is re-checked by validateSimulationConfig inside runSimulation,
  // but that check only runs *after* an engine already exists, so engine
  // construction is guarded here to turn a thrown error into one explicit
  // ErrorMessage instead of an uncaught Worker exception.
  let engine: SimulationEngine
  try {
    engine = createHistoricalBootstrapEngine(dataset, config.seed)
  } catch (cause) {
    emit({
      type: 'error',
      runId,
      errors: [
        {
          code: 'config.seed',
          message:
            cause instanceof Error
              ? cause.message
              : 'Could not construct the simulation engine from the given seed.',
        },
      ],
    })
    return
  }

  const result = runSimulation({
    engine,
    dataset,
    config,
    modelVersion,
    prngVersion,
    batchSize: computeBatchSize(config.paths),
    onBatchComplete: (pathsCompleted, totalPaths) => {
      emit({ type: 'progress', runId, pathsCompleted, totalPaths })
    },
  })

  if (!result.ok) {
    emit({ type: 'error', runId, errors: result.errors })
    return
  }

  emit({ type: 'result', runId, result: result.value })
}
