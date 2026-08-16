import { useState } from 'react'
import type { AssetCatalogueRecord } from '../../core/data/assetCatalogue'
import { MAX_ASSET_COUNT } from '../../core/simulation/simulationTypes'
import type { ValidationError } from '../../core/validation'
import { describedBy, errorsForCode } from './simulatorState'
import type { HoldingInput, SimulatorInputsAction } from './simulatorState'
import { FieldErrors } from './FieldErrors'

// Left column of the input workspace: the searchable ETF picker and the
// holding rows with their allocations. All state lives in the parent's
// simulatorState reducer — this component only renders and dispatches.

const MAX_SEARCH_RESULTS = 8

export function PortfolioConstruction({
  assets,
  holdings,
  benchmarkAssetId,
  errors,
  dispatch,
}: {
  readonly assets: readonly AssetCatalogueRecord[]
  readonly holdings: readonly HoldingInput[]
  readonly benchmarkAssetId: string | null
  readonly errors: readonly ValidationError[] | null
  readonly dispatch: (action: SimulatorInputsAction) => void
}) {
  // The search query is purely presentational (it configures nothing about a
  // run), so plain local state — not the inputs reducer — is the right home.
  const [query, setQuery] = useState('')

  const selectedIds = new Set(holdings.map((holding) => holding.assetId))
  const normalizedQuery = query.trim().toLowerCase()
  // Substring match on ticker or name, excluding already-picked assets.
  // Linear scan is right-sized: the catalogue is a few hundred records and
  // this runs once per keystroke.
  const searchResults =
    normalizedQuery.length === 0
      ? []
      : assets
          .filter(
            (asset) =>
              !selectedIds.has(asset.assetId) &&
              (asset.ticker.toLowerCase().includes(normalizedQuery) ||
                asset.name.toLowerCase().includes(normalizedQuery)),
          )
          .slice(0, MAX_SEARCH_RESULTS)

  const atHoldingLimit = holdings.length >= MAX_ASSET_COUNT

  // Live allocation total: lenient parse (unparseable counts as 0) because
  // this readout is feedback while typing, not the validation verdict --
  // deriveRunPlan owns the strict rule.
  const totalPercent = holdings.reduce((total, holding) => {
    const value = Number(holding.weightPercent)
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)

  const holdingsErrors = errorsForCode(errors, 'inputs.holdings.count')
  const totalErrors = errorsForCode(errors, 'inputs.weights.total')
  const historyErrors = errorsForCode(errors, 'inputs.history.insufficient')

  return (
    <fieldset className="input-section">
      <legend>Portfolio construction</legend>

      <label htmlFor="etf-search">Search ETFs and assets</label>
      <input
        autoComplete="off"
        id="etf-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Ticker or name, e.g. SPY"
        type="search"
        value={query}
      />
      {normalizedQuery.length > 0 && (
        <ul aria-label="Search results" className="picker-results">
          {searchResults.length === 0 && (
            <li className="picker-empty">No matching assets.</li>
          )}
          {searchResults.map((asset) => (
            <li key={asset.assetId}>
              <button
                disabled={atHoldingLimit}
                onClick={() =>
                  dispatch({ type: 'add-holding', assetId: asset.assetId })
                }
                type="button"
              >
                {asset.ticker} - {asset.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {atHoldingLimit && (
        <p className="input-hint">
          Holding limit reached ({MAX_ASSET_COUNT} assets).
        </p>
      )}

      <FieldErrors errors={holdingsErrors} id="holdings-errors" />

      {holdings.length > 0 && (
        <table className="holdings-table">
          <caption className="visually-hidden">Selected holdings</caption>
          <thead>
            <tr>
              <th scope="col">Ticker</th>
              <th scope="col">Name</th>
              <th scope="col">Allocation %</th>
              <th scope="col">
                <span className="visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => {
              const record = assets.find(
                (asset) => asset.assetId === holding.assetId,
              )
              const weightErrors = errorsForCode(
                errors,
                `inputs.weight.${holding.assetId}`,
              )
              const weightErrorId = `weight-errors-${holding.assetId}`
              return (
                <tr key={holding.assetId}>
                  <th scope="row">{record?.ticker ?? holding.assetId}</th>
                  <td>{record?.name ?? 'Unknown asset'}</td>
                  <td>
                    <label
                      className="visually-hidden"
                      htmlFor={`weight-${holding.assetId}`}
                    >
                      Allocation percent for {holding.assetId}
                    </label>
                    <input
                      aria-describedby={describedBy(
                        weightErrorId,
                        weightErrors,
                      )}
                      aria-invalid={weightErrors.length > 0}
                      id={`weight-${holding.assetId}`}
                      inputMode="decimal"
                      onChange={(event) =>
                        dispatch({
                          type: 'set-holding-weight',
                          assetId: holding.assetId,
                          weightPercent: event.target.value,
                        })
                      }
                      value={holding.weightPercent}
                    />
                    <FieldErrors errors={weightErrors} id={weightErrorId} />
                  </td>
                  <td>
                    <button
                      onClick={() =>
                        dispatch({
                          type: 'remove-holding',
                          assetId: holding.assetId,
                        })
                      }
                      type="button"
                    >
                      Remove {holding.assetId}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* The continuously displayed running total the spec requires — the
          user watches this converge to 100 while splitting allocations. */}
      <p aria-live="polite" className="allocation-total">
        Allocation total: {totalPercent.toFixed(2)}%
      </p>
      <FieldErrors errors={totalErrors} id="weights-total-errors" />
      <FieldErrors errors={historyErrors} id="history-errors" />

      <label htmlFor="benchmark-select">Optional benchmark ETF</label>
      <select
        id="benchmark-select"
        onChange={(event) =>
          dispatch({
            type: 'set-benchmark',
            assetId: event.target.value === '' ? null : event.target.value,
          })
        }
        value={benchmarkAssetId ?? ''}
      >
        <option value="">No benchmark</option>
        {assets.map((asset) => (
          <option key={asset.assetId} value={asset.assetId}>
            {asset.ticker} - {asset.name}
          </option>
        ))}
      </select>
      <p className="input-hint">
        The benchmark receives the portfolio&apos;s realised contributions but
        is never included in its allocation.
      </p>
    </fieldset>
  )
}
