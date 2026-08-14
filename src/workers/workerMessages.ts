import type { AlignedDataset } from '../core/data/datasetTypes'
import type {
  SimulationConfig,
  SimulationResult,
} from '../core/simulation/simulationTypes'
import type { ValidationError } from '../core/validation'

// The Worker boundary's entire message vocabulary. Every message carries the
// runId that started it, which is what lets the main thread apply the
// isCurrentRun() rule below to every message uniformly, regardless of type.

export type RunRequestMessage = {
  readonly type: 'run'
  readonly runId: string
  readonly dataset: AlignedDataset
  readonly config: SimulationConfig
  readonly modelVersion: string
  readonly prngVersion: string
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

  for (const path of result.representativePaths) {
    buffers.push(path.values.buffer)
  }

  for (const path of result.retainedPaths) {
    buffers.push(path.values.buffer)
  }

  return buffers
}
