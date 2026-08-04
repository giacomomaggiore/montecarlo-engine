import { useState } from 'react'
import {
  runPlaceholderSimulation,
  type PlaceholderResult,
} from './placeholderRun'

export function SimulatorPage() {
  const [result, setResult] = useState<PlaceholderResult | null>(null)

  return (
    <section aria-labelledby="engine-heading" className="page-content">
      <h1 id="engine-heading">Engine</h1>
      <button
        onClick={() => setResult(runPlaceholderSimulation())}
        type="button"
      >
        Run
      </button>
      {result && (
        <pre aria-label="Simulation result">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  )
}
