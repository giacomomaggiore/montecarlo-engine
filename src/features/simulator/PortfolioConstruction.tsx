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
  const formattedTotalPercent = Number(totalPercent.toFixed(2))
  const hasValidAllocationTotal = Math.abs(totalPercent - 100) <= 0.01

  const holdingsErrors = errorsForCode(errors, 'inputs.holdings.count')
  const historyErrors = errorsForCode(errors, 'inputs.history.insufficient')

  return (
    <fieldset className="input-section">
      <legend>Portfolio construction</legend>

      <input
        aria-label="Search ETFs and assets"
        autoComplete="off"
        id="etf-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Ticker or name, e.g. SPY"
        type="search"
        value={query}
      />
      {normalizedQuery.length > 0 && searchResults.length > 0 && (
        <ul aria-label="Search results" className="picker-results">
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
          <colgroup>
            <col className="holding-ticker-column" />
            <col className="holding-name-column" />
            <col className="holding-allocation-column" />
            <col className="holding-action-column" />
          </colgroup>
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
                  <td>
                    {record?.name ?? 'Unknown asset'}
                    <div className="holding-name-error">
                      <FieldErrors errors={weightErrors} id={weightErrorId} />
                    </div>
                  </td>
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
                  </td>
                  <td>
                    <button
                      aria-label={`Remove ${record?.ticker ?? holding.assetId}`}
                      onClick={() =>
                        dispatch({
                          type: 'remove-holding',
                          assetId: holding.assetId,
                        })
                      }
                      title={`Remove ${record?.ticker ?? holding.assetId}`}
                      type="button"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p aria-live="polite" className="allocation-total">
        {hasValidAllocationTotal
          ? 'Total: 100%'
          : `Total: ${formattedTotalPercent}% `}
        {!hasValidAllocationTotal && (
          <strong className="allocation-warning">(must be 100%)</strong>
        )}
      </p>
      <FieldErrors errors={historyErrors} id="history-errors" />

      <select
        aria-label="Optional benchmark ETF"
        className="benchmark-select"
        id="benchmark-select"
        onChange={(event) =>
          dispatch({
            type: 'set-benchmark',
            assetId: event.target.value === '' ? null : event.target.value,
          })
        }
        value={benchmarkAssetId ?? ''}
      >
        <option value="">[optional] benchmark</option>
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
