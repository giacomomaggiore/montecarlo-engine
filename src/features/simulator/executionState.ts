import type { SimulationResult } from '../../core/simulation/simulationTypes'
import type { ValidationError } from '../../core/validation'
import { isCurrentRun } from '../../workers/workerMessages'
import type { WorkerResponseMessage } from '../../workers/workerMessages'

// Matches the Frontend Layout and Interaction Specification's Execution
// State section exactly. Kept separate from any input-configuration state,
// per the Maintenance Policy's "keep input configuration state and
// execution/run state strictly separated" rule.
export type ExecutionState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading-data'; readonly runId: string }
  | {
      readonly status: 'running'
      readonly runId: string
      readonly pathsCompleted: number
      readonly totalPaths: number
    }
  | {
      readonly status: 'completed'
      readonly runId: string
      readonly result: SimulationResult
    }
  | { readonly status: 'cancelled'; readonly runId: string }
  | {
      readonly status: 'failed'
      readonly runId: string
      readonly errors: readonly ValidationError[]
    }

export const IDLE_STATE: ExecutionState = { status: 'idle' }

export type ExecutionAction =
  | { readonly type: 'loading-data-started'; readonly runId: string }
  | {
      readonly type: 'run-started'
      readonly runId: string
      readonly totalPaths: number
    }
  | { readonly type: 'cancel' }
  | { readonly type: 'message'; readonly message: WorkerResponseMessage }

// The hook's entire "internal message handler," split from React glue so it
// is testable as a plain function: reduceExecutionState(state,
// messageToAction(message)).
export function messageToAction(
  message: WorkerResponseMessage,
): ExecutionAction {
  return { type: 'message', message }
}

export function reduceExecutionState(
  state: ExecutionState,
  action: ExecutionAction,
): ExecutionState {
  switch (action.type) {
    case 'loading-data-started':
      return { status: 'loading-data', runId: action.runId }

    case 'run-started':
      // Guards against a stale loading-data completion from an attempt the
      // user has already cancelled or superseded with a newer run() call.
      if (state.status !== 'loading-data' || state.runId !== action.runId) {
        return state
      }
      return {
        status: 'running',
        runId: action.runId,
        pathsCompleted: 0,
        totalPaths: action.totalPaths,
      }

    case 'cancel':
      return state.status === 'loading-data' || state.status === 'running'
        ? { status: 'cancelled', runId: state.runId }
        : state

    case 'message':
      return applyMessage(state, action.message)
  }
}

function applyMessage(
  state: ExecutionState,
  message: WorkerResponseMessage,
): ExecutionState {
  // This is the entire "ignore stale messages by comparing run IDs" rule:
  // a message can only move the state machine forward while it is still
  // running *that exact* run. An old Worker's late progress/result/error —
  // for example one that was already in flight when the user started a new
  // run — is dropped unmodified rather than corrupting the newer run's state.
  if (state.status !== 'running' || !isCurrentRun(state.runId, message.runId)) {
    return state
  }

  switch (message.type) {
    case 'progress':
      return {
        ...state,
        pathsCompleted: message.pathsCompleted,
        totalPaths: message.totalPaths,
      }
    case 'result':
      return { status: 'completed', runId: state.runId, result: message.result }
    case 'error':
      return { status: 'failed', runId: state.runId, errors: message.errors }
  }
}
