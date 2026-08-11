import { executeRun } from './executeRun'
import { buildTransferList, isResultMessage } from './workerMessages'
import type { RunRequestMessage, WorkerResponseMessage } from './workerMessages'

// The only file in this phase allowed to reference `self`/`postMessage`.
// Everything it does — validating input, sampling, accounting, reporting
// progress — lives in executeRun(), which knows nothing about being inside
// a Worker. Keeping this file to a few lines is what makes executeRun()
// testable with a plain array instead of a real Worker thread.
self.onmessage = (event: MessageEvent<RunRequestMessage>) => {
  executeRun(event.data, (message: WorkerResponseMessage) => {
    // Only a ResultMessage is large enough to be worth transferring instead
    // of structured-cloning; progress/error messages are a handful of
    // numbers and strings.
    const transferList = isResultMessage(message)
      ? buildTransferList(message.result)
      : []
    self.postMessage(message, transferList)
  })
}
