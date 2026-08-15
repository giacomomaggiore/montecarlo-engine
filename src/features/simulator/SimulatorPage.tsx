import { useState } from 'react'
import { loadAlignedDataset } from '../../core/data/loadDataset'
import type { ParametricStudentTOptions } from '../../core/simulation/parametricStudentT'
import type { SimulationConfig } from '../../core/simulation/simulationTypes'
import type { EngineSelection } from '../../workers/workerMessages'
import { PortfolioChart } from './PortfolioChart'
import { useSimulationWorker } from './useSimulationWorker'

// Fixed demo selection until Phase 4 adds a real, searchable ETF picker:
// two real tickers already present in the released usd-weekly-v1 matrix
// (public/data/manifest.json's assetColumns), a 60/40 equity/bond split.
const DEMO_ASSET_IDS = ['SPY', 'AGG'] as const
const DEMO_WEIGHTS = [0.6, 0.4] as const

// Demo configuration only: README defaults are weekly frequency, 2,000
// paths, and a 10-year (520-week) horizon. Phase 4 replaces this fixed
// object with real user-editable Portfolio Construction and Simulation
// Inputs.
const DEMO_CONFIG: SimulationConfig = {
  weights: [...DEMO_WEIGHTS],
  initialInvestment: 10_000,
  cashFlow: { mode: 'dca', amount: 100 },
  paths: 2000,
  periods: 520,
  seed: 42,
}

// Fixed demo parametric options until Phase 4 adds the real inputs the
// frontend spec defines (per-holding annual geometric return, manual nu,
// editable inflation/risk-free): historical means, automatic degrees of
// freedom, 2% annual inflation, 3% annual risk-free rate.
const DEMO_PARAMETRIC_OPTIONS: ParametricStudentTOptions = {
  annualInflation: 0.02,
  annualRiskFreeRate: 0.03,
}

type SelectableEngine = 'bootstrap' | 'studentT'

const ENGINE_LABELS: Record<SelectableEngine, string> = {
  bootstrap: 'Bootstrap',
  studentT: 'Parametric',
}

export function SimulatorPage() {
  const { state, run, cancel } = useSimulationWorker()
  // Input-configuration state, kept strictly separate from the hook's
  // execution/run state per the Maintenance Policy.
  const [selectedEngine, setSelectedEngine] =
    useState<SelectableEngine>('bootstrap')

  const isBusy = state.status === 'loading-data' || state.status === 'running'

  function handleRun() {
    const engineSelection: EngineSelection =
      selectedEngine === 'bootstrap'
        ? { engine: 'bootstrap' }
        : { engine: 'studentT', options: DEMO_PARAMETRIC_OPTIONS }

    run({
      loadDataset: () => loadAlignedDataset(DEMO_ASSET_IDS, 'weekly', 'USD'),
      config: DEMO_CONFIG,
      engineSelection,
    })
  }

  return (
    <section aria-labelledby="engine-heading" className="page-content">
      <h1 id="engine-heading">Engine</h1>
      <p className="phase-note">
        Demo portfolio: 60% SPY / 40% AGG, weekly rebalancing-free DCA, against
        the real released historical dataset (usd-weekly-v1). Bootstrap
        resamples joint historical weeks; Parametric samples a Student&apos;s t
        fitted to the same data (2% inflation, 3% risk-free demo constants).
        Phase 4 replaces this fixed selection with a real, searchable portfolio
        builder.
      </p>

      <fieldset className="engine-selector" disabled={isBusy}>
        <legend>Simulation engine</legend>
        {(Object.keys(ENGINE_LABELS) as SelectableEngine[]).map((engine) => (
          <button
            aria-pressed={selectedEngine === engine}
            key={engine}
            onClick={() => setSelectedEngine(engine)}
            type="button"
          >
            {ENGINE_LABELS[engine]}
          </button>
        ))}
        <button disabled title="Planned future engine" type="button">
          Markov Chain (future)
        </button>
      </fieldset>

      <div className="engine-controls">
        <button disabled={isBusy} onClick={handleRun} type="button">
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

      {state.status === 'completed' && <PortfolioChart result={state.result} />}
    </section>
  )
}
