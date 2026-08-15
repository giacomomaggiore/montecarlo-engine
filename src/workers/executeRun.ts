import { validateAlignedDataset } from '../core/data/datasetTypes'
import { XOSHIRO128_STAR_STAR_VERSION } from '../core/math/random'
import {
  createHistoricalBootstrapEngine,
  HISTORICAL_BOOTSTRAP_MODEL_VERSION,
} from '../core/simulation/historicalBootstrap'
import {
  createParametricStudentTEngine,
  fitParametricStudentT,
  PARAMETRIC_STUDENT_T_MODEL_VERSION,
} from '../core/simulation/parametricStudentT'
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

// The only executable logic in the Worker boundary. It has no dependency on
// `self` or `postMessage` — `emit` is an injected plain function — so it is
// unit-testable exactly like core/, with a real `simulation.worker.ts` only
// wiring `self.onmessage`/`self.postMessage` around it.
export function executeRun(
  request: RunRequestMessage,
  emit: (message: WorkerResponseMessage) => void,
): void {
  const { runId, dataset, config, engineSelection } = request

  const datasetResult = validateAlignedDataset(dataset)
  if (!datasetResult.ok) {
    emit({ type: 'error', runId, errors: datasetResult.errors })
    return
  }

  // Exhaustive switch on the engine discriminated union. Both branches end
  // with an engine plus the model-version string only this file — the actual
  // constructor of the engine — can know is the right pairing.
  let engine: SimulationEngine
  let modelVersion: string
  switch (engineSelection.engine) {
    case 'bootstrap': {
      // createHistoricalBootstrapEngine throws for a malformed seed rather
      // than returning a ValidationResult (see historicalBootstrap.ts) — the
      // seed itself is re-checked by validateSimulationConfig inside
      // runSimulation, but that check only runs *after* an engine already
      // exists, so engine construction is guarded here to turn a thrown
      // error into one explicit ErrorMessage instead of an uncaught Worker
      // exception.
      try {
        engine = createHistoricalBootstrapEngine(dataset, config.seed)
      } catch (cause) {
        emitEngineConstructionError(emit, runId, cause)
        return
      }
      modelVersion = HISTORICAL_BOOTSTRAP_MODEL_VERSION
      break
    }
    case 'studentT': {
      // Fitting is a ValidationResult, so a numerical failure (bad option,
      // degenerate covariance, Cholesky failure) becomes the existing
      // ErrorMessage path before any simulation loop starts.
      const fit = fitParametricStudentT(dataset, engineSelection.options)
      if (!fit.ok) {
        emit({ type: 'error', runId, errors: fit.errors })
        return
      }
      // Same malformed-seed guard as the bootstrap branch: the factory's
      // private PRNG constructor throws on a non-uint32 seed.
      try {
        engine = createParametricStudentTEngine(fit.value, config.seed)
      } catch (cause) {
        emitEngineConstructionError(emit, runId, cause)
        return
      }
      modelVersion = PARAMETRIC_STUDENT_T_MODEL_VERSION
      break
    }
    default: {
      // Exhaustiveness guard: a new EngineSelection variant fails to compile
      // here rather than silently falling through at runtime.
      const unhandled: never = engineSelection
      emit({
        type: 'error',
        runId,
        errors: [
          {
            code: 'engine.selection.unknown',
            message: `Unknown engine selection: ${JSON.stringify(unhandled)}.`,
          },
        ],
      })
      return
    }
  }

  const result = runSimulation({
    engine,
    dataset,
    config,
    modelVersion,
    prngVersion: XOSHIRO128_STAR_STAR_VERSION,
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

function emitEngineConstructionError(
  emit: (message: WorkerResponseMessage) => void,
  runId: string,
  cause: unknown,
): void {
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
}
