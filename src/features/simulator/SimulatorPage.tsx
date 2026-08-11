import { XOSHIRO128_STAR_STAR_VERSION } from '../../core/math/random'
import { HISTORICAL_BOOTSTRAP_MODEL_VERSION } from '../../core/simulation/historicalBootstrap'
import type { SimulationConfig } from '../../core/simulation/simulationTypes'
import { PortfolioChart } from './PortfolioChart'
import { createPlaceholderDataset } from './placeholderDataset'
import { useSimulationWorker } from './useSimulationWorker'

// Phase 2 demo configuration only: README defaults are weekly frequency,
// 2,000 paths, and a 10-year (520-week) horizon. Phase 4 replaces this
// fixed object with real user-editable Portfolio Construction and
// Simulation Inputs.
const DEMO_CONFIG: SimulationConfig = {
  weights: [0.6, 0.4],
  initialInvestment: 10_000,
  cashFlow: { mode: 'dca', amount: 100 },
  paths: 2000,
  periods: 520,
  seed: 42,
}

export function SimulatorPage() {
  const { state, run, cancel } = useSimulationWorker()

  const isBusy = state.status === 'loading-data' || state.status === 'running'

  function handleRun() {
    run({
      dataset: createPlaceholderDataset(),
      config: DEMO_CONFIG,
      modelVersion: HISTORICAL_BOOTSTRAP_MODEL_VERSION,
      prngVersion: XOSHIRO128_STAR_STAR_VERSION,
    })
  }

  return (
    <section aria-labelledby="engine-heading" className="page-content">
      <h1 id="engine-heading">Engine</h1>
      <p className="phase-note">
        Phase 2 demo: this runs against a temporary, synthetic placeholder
        dataset, not real historical data. The Dataset artifact gate will
        replace it with the real, versioned loader.
      </p>

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
