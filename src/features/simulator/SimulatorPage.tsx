import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { fetchAssetsCatalogueCached } from '../../core/data/assetCatalogue'
import type { AssetsCatalogue } from '../../core/data/assetCatalogue'
import { loadAlignedDataset } from '../../core/data/loadDataset'
import type { ValidationResult } from '../../core/validation'
import { PortfolioConstruction } from './PortfolioConstruction'
import { PortfolioSettings } from './PortfolioSettings'
import { ResultsPanel } from './ResultsPanel'
import { SimulationInputs } from './SimulationInputs'
import {
  DEFAULT_SIMULATOR_INPUTS,
  deriveRunPlan,
  reduceSimulatorInputs,
} from './simulatorState'
import type { SimulatorInputsAction } from './simulatorState'
import { useSimulationWorker } from './useSimulationWorker'

// Phase 4 — the real Engine page. Composition only: input-configuration
// state lives in the simulatorState reducer, execution state in
// useSimulationWorker, catalogue data in the session cache. This component
// wires them together and owns nothing else.

export function SimulatorPage() {
  const [inputs, dispatchInputs] = useReducer(
    reduceSimulatorInputs,
    DEFAULT_SIMULATOR_INPUTS,
  )
  const { state, run, cancel } = useSimulationWorker()

  // The catalogue backs the picker and the history preview. null = still
  // loading. A failed load leaves the page usable enough to READ, but Run
  // stays disabled — no catalogue means no validated selection.
  const [catalogue, setCatalogue] =
    useState<ValidationResult<AssetsCatalogue> | null>(null)
  useEffect(() => {
    let active = true
    fetchAssetsCatalogueCached(inputs.frequency, inputs.baseCurrency).then(
      (result) => {
        // A route change can unmount this page mid-fetch; setting state on an
        // unmounted component is a React warning and a logic smell.
        if (active) {
          setCatalogue(result)
        }
      },
    )
    return () => {
      active = false
    }
  }, [inputs.frequency, inputs.baseCurrency])

  // Memoized so a stable empty array (not a fresh literal each render) feeds
  // the plan derivation below while the catalogue is still loading.
  const catalogueAssets = useMemo(
    () => (catalogue !== null && catalogue.ok ? catalogue.value.assets : []),
    [catalogue],
  )

  // Re-derived on every input edit: parsing a dozen short strings is far
  // cheaper than a render, and it is what keeps Run's disabled state and
  // every beside-control error continuously honest.
  const plan = useMemo(
    () => deriveRunPlan(inputs, catalogueAssets),
    [inputs, catalogueAssets],
  )
  const inputErrors = plan.ok ? null : plan.errors

  const isBusy = state.status === 'loading-data' || state.status === 'running'

  // The spec's "input changes during a run terminate and replace the worker":
  // any edit while busy cancels the in-flight run first. The stale-run-id
  // guards in the hook make the ordering safe even if a Worker message is
  // already in the event queue.
  const dispatch = useCallback(
    (action: SimulatorInputsAction) => {
      if (isBusy) {
        cancel()
      }
      dispatchInputs(action)
    },
    [isBusy, cancel],
  )

  function handleRun() {
    if (!plan.ok) {
      return
    }
    const { assetIds, config, selection, engineSelection } = plan.value
    run({
      // The thunk defers the (possibly network-bound) dataset load to the
      // hook, which owns the loading-data state and its failure path.
      loadDataset: () =>
        loadAlignedDataset(assetIds, inputs.frequency, inputs.baseCurrency),
      config,
      selection,
      engineSelection,
    })
  }

  const runDisabled = isBusy || !plan.ok || catalogue === null || !catalogue.ok

  return (
    <section aria-labelledby="engine-heading" className="engine-page page-content">
      <h1 id="engine-heading">Engine</h1>

      {catalogue === null && <p role="status">Loading asset catalogue…</p>}
      {catalogue !== null && !catalogue.ok && (
        <div role="alert">
          <p>The asset catalogue could not be loaded:</p>
          <ul>
            {catalogue.errors.map((error) => (
              <li key={error.code}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}

      {catalogue !== null && catalogue.ok && (
        <div className="input-workspace">
          <div className="input-column">
            <PortfolioConstruction
              assets={catalogueAssets}
              benchmarkAssetId={inputs.benchmarkAssetId}
              dispatch={dispatch}
              errors={inputErrors}
              holdings={inputs.holdings}
            />
            <SimulationInputs
              assets={catalogueAssets}
              dispatch={dispatch}
              errors={inputErrors}
              inputs={inputs}
            />
          </div>
          <div className="input-column">
            <PortfolioSettings
              dispatch={dispatch}
              errors={inputErrors}
              inputs={inputs}
            />
          </div>
        </div>
      )}

      {/* The aria-live validation summary the spec requires, complementing
          the beside-control messages. polite: it re-announces as the user
          types, and must not interrupt their own input echo. */}
      <div aria-live="polite" className="validation-summary">
        {inputErrors !== null && inputErrors.length > 0 && (
          <>
            <p>Fix the following before running:</p>
            <ul>
              {inputErrors.map((error) => (
                <li key={error.code + error.message}>{error.message}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="engine-controls">
        <button disabled={runDisabled} onClick={handleRun} type="button">
          Run
        </button>
        <button disabled={!isBusy} onClick={cancel} type="button">
          Cancel
        </button>
      </div>

      <div aria-live="polite">
        {state.status === 'loading-data' && (
          <p role="status">Preparing dataset…</p>
        )}
        {state.status === 'running' && (
          <p role="status">
            Running… {state.pathsCompleted} / {state.totalPaths} paths
          </p>
        )}
        {state.status === 'cancelled' && <p role="status">Run cancelled.</p>}
        {state.status === 'failed' && (
          <div role="alert">
            <p>Run failed:</p>
            <ul>
              {state.errors.map((error) => (
                <li key={error.code}>{error.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {state.status === 'completed' && (
        <ResultsPanel displayMode={inputs.displayMode} result={state.result} />
      )}
    </section>
  )
}
