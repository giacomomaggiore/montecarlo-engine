import type { AlignedDataset } from '../core/data/datasetTypes'
import type { ParametricStudentTOptions } from '../core/simulation/parametricStudentT'
import type {
  SimulationAssetSelection,
  SimulationConfig,
  SimulationResult,
} from '../core/simulation/simulationTypes'
import type { ValidationError } from '../core/validation'

// The Worker boundary's entire message vocabulary. Every message carries the
// runId that started it, which is what lets the main thread apply the
// isCurrentRun() rule below to every message uniformly, regardless of type.

// Which scenario engine the Worker should construct, as a discriminated
// union (per the coding standards' type-safe variant selection). The request
// carries the *selection*, never a prebuilt engine: an engine closure cannot
// cross a structured-clone boundary. Replacing the old modelVersion/
// prngVersion fields also closes the "documented convention, not
// compiler-enforced" gap Phase 1.5 flagged -- the Worker side is the one
// place that knows which engine it constructs, so it now supplies the
// version strings itself instead of trusting the caller to keep two
// loosely-coupled arguments consistent.
export type EngineSelection =
  | { readonly engine: 'bootstrap' }
  | { readonly engine: 'studentT'; readonly options: ParametricStudentTOptions }

export type RunRequestMessage = {
  readonly type: 'run'
  readonly runId: string
  readonly dataset: AlignedDataset
  readonly config: SimulationConfig
  readonly selection: SimulationAssetSelection
  readonly engineSelection: EngineSelection
}

export type ProgressMessage = {
  readonly type: 'progress'
  readonly runId: string
  readonly pathsCompleted: number
  readonly totalPaths: number
}

export type ResultMessage = {
  readonly type: 'result'
  readonly runId: string
  readonly result: SimulationResult
}

export type ErrorMessage = {
  readonly type: 'error'
  readonly runId: string
  readonly errors: readonly ValidationError[]
}

export type WorkerResponseMessage =
  ProgressMessage | ResultMessage | ErrorMessage

// A run ID is minted fresh by the caller (e.g. crypto.randomUUID()) every
// time Run starts a new attempt. Comparing against it is the only thing that
// protects the UI from an old, in-flight Worker message overwriting a newer
// run's state after the user edits inputs and runs again.
export function isCurrentRun(
  activeRunId: string,
  messageRunId: string,
): boolean {
  return activeRunId === messageRunId
}

export function isResultMessage(
  message: WorkerResponseMessage,
): message is ResultMessage {
  return message.type === 'result'
}

// postMessage(message, transferList) moves ownership of these ArrayBuffers
// to the main thread instead of structured-cloning them — required once a
// run's flat equity buffers approach the ~80 MB budget the headless runner's
// path * period work limit already allows (see runSimulation.ts).
export function buildTransferList(result: SimulationResult): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [result.terminalWealth.buffer]

  if (result.benchmarkTerminalWealth !== null) {
    buffers.push(result.benchmarkTerminalWealth.buffer)
  }

  for (const path of result.representativePaths) {
    buffers.push(path.values.buffer, path.priceLevels.buffer)
  }

  for (const path of result.retainedPaths) {
    buffers.push(
      path.values.buffer,
      path.contributions.buffer,
      path.priceLevels.buffer,
    )
  }

  return buffers
}
