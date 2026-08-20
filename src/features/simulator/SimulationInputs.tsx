import { estimateCommonHistory } from '../../core/data/assetCatalogue'
import type { AssetCatalogueRecord } from '../../core/data/assetCatalogue'
import { minimumObservations } from '../../core/data/datasetTypes'
import type { ValidationError } from '../../core/validation'
import { releasedBaseCurrencies } from '../../core/data/loadDataset'
import {
  describedBy,
  errorsForCode,
  maxSelectablePaths,
} from './simulatorState'
import type {
  EngineChoice,
  ScalarInputField,
  SimulatorInputs,
  SimulatorInputsAction,
} from './simulatorState'
import { FieldErrors } from './FieldErrors'

// Right-column upper block: engine choice and the simulation parameters.
// Only the selected live engine's controls render, per the frontend spec.

const ENGINE_LABELS: Record<EngineChoice, string> = {
  bootstrap: 'Bootstrap',
  studentT: 'Parametric',
}

function ScalarField({
  field,
  label,
  hint,
  inputs,
  errors,
  dispatch,
}: {
  readonly field: ScalarInputField
  readonly label: string
  readonly hint?: string
  readonly inputs: SimulatorInputs
  readonly errors: readonly ValidationError[] | null
  readonly dispatch: (action: SimulatorInputsAction) => void
}) {
  const fieldErrors = errorsForCode(errors, `inputs.${field}`)
  const errorId = `${field}-errors`
  return (
    <div className="labelled-field">
      <label htmlFor={`field-${field}`}>{label}</label>
      <input
        aria-describedby={describedBy(errorId, fieldErrors)}
        aria-invalid={fieldErrors.length > 0}
        id={`field-${field}`}
        inputMode="decimal"
        onChange={(event) =>
          dispatch({ type: 'set-field', field, value: event.target.value })
        }
        value={inputs[field]}
      />
      {hint !== undefined && <p className="input-hint">{hint}</p>}
      <FieldErrors errors={fieldErrors} id={errorId} />
    </div>
  )
}

function ParametricField({
  field,
  label,
  errorCode,
  value,
  errors,
  dispatch,
}: {
  readonly field:
    'manualNu' | 'annualInflationPercent' | 'annualRiskFreePercent'
  readonly label: string
  readonly errorCode: string
  readonly value: string
  readonly errors: readonly ValidationError[] | null
  readonly dispatch: (action: SimulatorInputsAction) => void
}) {
  const fieldErrors = errorsForCode(errors, errorCode)
  const errorId = `${field}-errors`
  return (
    <div className="labelled-field">
      <label htmlFor={`field-${field}`}>{label}</label>
      <input
        aria-describedby={describedBy(errorId, fieldErrors)}
        aria-invalid={fieldErrors.length > 0}
        id={`field-${field}`}
        inputMode="decimal"
        onChange={(event) =>
          dispatch({
            type: 'set-parametric-field',
            field,
            value: event.target.value,
          })
        }
        value={value}
      />
      <FieldErrors errors={fieldErrors} id={errorId} />
    </div>
  )
}

export function SimulationInputs({
  inputs,
  assets,
  errors,
  dispatch,
}: {
  readonly inputs: SimulatorInputs
  readonly assets: readonly AssetCatalogueRecord[]
  readonly errors: readonly ValidationError[] | null
  readonly dispatch: (action: SimulatorInputsAction) => void
}) {
  const selectedRecords = inputs.holdings
    .map((holding) => assets.find((asset) => asset.assetId === holding.assetId))
    .filter((record): record is AssetCatalogueRecord => record !== undefined)
  const historyEstimate = estimateCommonHistory(
    selectedRecords,
    inputs.frequency,
  )

  const parsedYears = Number(inputs.horizonYears)
  const periodsPerYear = inputs.frequency === 'weekly' ? 52 : 12
  const derivedPeriods = Number.isInteger(parsedYears)
    ? parsedYears * periodsPerYear
    : null

  return (
    <fieldset className="input-section">
      <legend>Simulation settings</legend>

      <fieldset aria-label="Simulation engine" className="engine-selector">
        <legend className="visually-hidden">Simulation engine</legend>
        {(Object.keys(ENGINE_LABELS) as EngineChoice[]).map((engine) => (
          <button
            aria-pressed={inputs.engine === engine}
            key={engine}
            onClick={() => dispatch({ type: 'set-engine', engine })}
            type="button"
          >
            {ENGINE_LABELS[engine]}
          </button>
        ))}
        {/* Per the spec and the Future Markov-Chain Extension section: shown,
            disabled, and labelled as future — no Markov code ships. */}
        <button disabled title="Planned future engine" type="button">
          Markov Chain (future)
        </button>
      </fieldset>

      <div className="compact-field-grid compact-field-grid--three">
        <ScalarField
          dispatch={dispatch}
          errors={errors}
          field="seed"
          inputs={inputs}
          label="Random seed"
        />
        <ScalarField
          dispatch={dispatch}
          errors={errors}
          field="paths"
          hint={
            derivedPeriods !== null && derivedPeriods > 0
              ? `Up to ${maxSelectablePaths(derivedPeriods)} paths.`
              : undefined
          }
          inputs={inputs}
          label="Simulated paths"
        />
        <ScalarField
          dispatch={dispatch}
          errors={errors}
          field="horizonYears"
          hint={
            derivedPeriods !== null && derivedPeriods > 0
              ? `${derivedPeriods} ${inputs.frequency} periods.`
              : undefined
          }
          inputs={inputs}
          label="Horizon (years)"
        />
      </div>

      <div className="compact-field-grid">
      <fieldset className="radio-group">
        <legend>Data frequency</legend>
        <label>
          <input
            checked={inputs.frequency === 'weekly'}
            name="frequency"
            onChange={() =>
              dispatch({ type: 'set-frequency', frequency: 'weekly' })
            }
            type="radio"
            value="weekly"
          />
          Weekly
        </label>
        <label
          className={
            inputs.leverageMode === 'enabled' ? 'disabled-option' : undefined
          }
        >
          <input
            checked={inputs.frequency === 'monthly'}
            disabled={inputs.leverageMode === 'enabled'}
            name="frequency"
            onChange={() =>
              dispatch({ type: 'set-frequency', frequency: 'monthly' })
            }
            type="radio"
            value="monthly"
          />
          Monthly
          {inputs.leverageMode === 'enabled'
            ? ' — leverage requires weekly data'
            : ''}
        </label>
      </fieldset>

      <fieldset className="radio-group">
        <legend>Base currency</legend>
        {releasedBaseCurrencies().map((baseCurrency) => (
          <label key={baseCurrency}>
            <input
              checked={inputs.baseCurrency === baseCurrency}
              name="base-currency"
              onChange={() =>
                dispatch({ type: 'set-base-currency', baseCurrency })
              }
              type="radio"
              value={baseCurrency}
            />
            {baseCurrency}
          </label>
        ))}
      </fieldset>
      </div>

      {inputs.engine === 'bootstrap' && (
        // Read-only common-history summary, per the spec's Bootstrap inputs.
        // Estimated from catalogue spans; the loader's finite-row alignment
        // remains the binding count at Run time (see assetCatalogue.ts).
        <p className="input-hint" data-testid="common-history-summary">
          {historyEstimate === null
            ? 'Select assets to see their estimated common history.'
            : `Estimated common history: ${historyEstimate.firstDate} to ${historyEstimate.lastDate}, ` +
              `~${historyEstimate.estimatedRowCount} ${inputs.frequency} observations ` +
              `(minimum ${minimumObservations(inputs.frequency)}).`}
        </p>
      )}

      {inputs.engine === 'studentT' && (
        <fieldset className="input-subsection">
          <legend>Parametric model</legend>

          <div className="compact-field-grid">
          <fieldset className="radio-group">
            <legend>Expected annual returns</legend>
            <label>
              <input
                checked={inputs.parametric.returnMode === 'historical'}
                name="return-mode"
                onChange={() =>
                  dispatch({
                    type: 'set-parametric-return-mode',
                    mode: 'historical',
                  })
                }
                type="radio"
                value="historical"
              />
              Historical (fitted from the data)
            </label>
            <label>
              <input
                checked={inputs.parametric.returnMode === 'manual'}
                name="return-mode"
                onChange={() =>
                  dispatch({
                    type: 'set-parametric-return-mode',
                    mode: 'manual',
                  })
                }
                type="radio"
                value="manual"
              />
              Enter per-holding annual returns
            </label>
          </fieldset>

          {inputs.parametric.returnMode === 'manual' &&
            inputs.holdings.map((holding) => {
              const returnErrors = errorsForCode(
                errors,
                `inputs.parametricReturn.${holding.assetId}`,
              )
              const errorId = `parametric-return-errors-${holding.assetId}`
              return (
                <div className="labelled-field" key={holding.assetId}>
                  <label htmlFor={`parametric-return-${holding.assetId}`}>
                    {holding.assetId} annual geometric return %
                  </label>
                  <input
                    aria-describedby={describedBy(errorId, returnErrors)}
                    aria-invalid={returnErrors.length > 0}
                    id={`parametric-return-${holding.assetId}`}
                    inputMode="decimal"
                    onChange={(event) =>
                      dispatch({
                        type: 'set-holding-manual-return',
                        assetId: holding.assetId,
                        manualAnnualReturnPercent: event.target.value,
                      })
                    }
                    value={holding.manualAnnualReturnPercent}
                  />
                  <FieldErrors errors={returnErrors} id={errorId} />
                </div>
              )
            })}

          <fieldset className="radio-group">
            <legend>Degrees of freedom (tail heaviness)</legend>
            <label>
              <input
                checked={inputs.parametric.nuMode === 'automatic'}
                name="nu-mode"
                onChange={() =>
                  dispatch({
                    type: 'set-parametric-nu-mode',
                    mode: 'automatic',
                  })
                }
                type="radio"
                value="automatic"
              />
              Estimated
            </label>
            <label>
              <input
                checked={inputs.parametric.nuMode === 'manual'}
                name="nu-mode"
                onChange={() =>
                  dispatch({ type: 'set-parametric-nu-mode', mode: 'manual' })
                }
                type="radio"
                value="manual"
              />
              Manual
            </label>
          </fieldset>
          </div>
          {inputs.parametric.nuMode === 'manual' && (
            <ParametricField
              dispatch={dispatch}
              errorCode="inputs.parametric.nu"
              errors={errors}
              field="manualNu"
              label="Degrees of freedom (5 to 100; lower = fatter tails)"
              value={inputs.parametric.manualNu}
            />
          )}

          <div className="compact-field-grid">
            <ParametricField
              dispatch={dispatch}
              errorCode="inputs.parametric.inflation"
              errors={errors}
              field="annualInflationPercent"
              label="Annual inflation %"
              value={inputs.parametric.annualInflationPercent}
            />
            <ParametricField
              dispatch={dispatch}
              errorCode="inputs.parametric.riskFree"
              errors={errors}
              field="annualRiskFreePercent"
              label="Annual risk-free rate %"
              value={inputs.parametric.annualRiskFreePercent}
            />
          </div>
        </fieldset>
      )}
    </fieldset>
  )
}
