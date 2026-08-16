import type { ValidationError } from '../../core/validation'
import { describedBy, errorsForCode } from './simulatorState'
import type {
  CashFlowMode,
  SimulatorInputs,
  SimulatorInputsAction,
} from './simulatorState'
import { FieldErrors } from './FieldErrors'

// Right-column lower block: money in (initial investment + cash-flow mode)
// and the nominal/real display toggle. Deliberately NOT here yet: tax, cost,
// rebalancing, and leverage controls — their accounting does not exist until
// Phase 5+, and a control that silently does nothing is the UI form of the
// silent clipping the Financial Rules forbid.

const CASH_FLOW_LABELS: Record<CashFlowMode, string> = {
  lumpSum: 'Lump sum (no later contributions)',
  dca: 'DCA (fixed contribution each period)',
  valueAveraging: 'Value averaging (contribute up to a target path)',
}

export function PortfolioSettings({
  inputs,
  errors,
  dispatch,
}: {
  readonly inputs: SimulatorInputs
  readonly errors: readonly ValidationError[] | null
  readonly dispatch: (action: SimulatorInputsAction) => void
}) {
  const initialErrors = errorsForCode(errors, 'inputs.initialInvestment')
  const dcaErrors = errorsForCode(errors, 'inputs.dcaAmount')
  const vaErrors = errorsForCode(errors, 'inputs.vaTargetIncrease')

  return (
    <fieldset className="input-section">
      <legend>Portfolio settings</legend>

      <div className="labelled-field">
        <label htmlFor="field-initialInvestment">
          Initial investment (USD)
        </label>
        <input
          aria-describedby={describedBy(
            'initialInvestment-errors',
            initialErrors,
          )}
          aria-invalid={initialErrors.length > 0}
          id="field-initialInvestment"
          inputMode="decimal"
          onChange={(event) =>
            dispatch({
              type: 'set-field',
              field: 'initialInvestment',
              value: event.target.value,
            })
          }
          value={inputs.initialInvestment}
        />
        <FieldErrors errors={initialErrors} id="initialInvestment-errors" />
      </div>

      <fieldset className="radio-group">
        <legend>Cash-flow mode</legend>
        {(Object.keys(CASH_FLOW_LABELS) as CashFlowMode[]).map((mode) => (
          <label key={mode}>
            <input
              checked={inputs.cashFlowMode === mode}
              name="cash-flow-mode"
              onChange={() => dispatch({ type: 'set-cash-flow-mode', mode })}
              type="radio"
              value={mode}
            />
            {CASH_FLOW_LABELS[mode]}
          </label>
        ))}
      </fieldset>

      {/* Only the ACTIVE mode's amount renders (and only the active mode is
          validated): a half-edited number in an inactive mode must never
          block a run it cannot affect. */}
      {inputs.cashFlowMode === 'dca' && (
        <div className="labelled-field">
          <label htmlFor="field-dcaAmount">
            Contribution per period (USD, end of period)
          </label>
          <input
            aria-describedby={describedBy('dcaAmount-errors', dcaErrors)}
            aria-invalid={dcaErrors.length > 0}
            id="field-dcaAmount"
            inputMode="decimal"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'dcaAmount',
                value: event.target.value,
              })
            }
            value={inputs.dcaAmount}
          />
          <FieldErrors errors={dcaErrors} id="dcaAmount-errors" />
        </div>
      )}

      {inputs.cashFlowMode === 'valueAveraging' && (
        <div className="labelled-field">
          <label htmlFor="field-vaTargetIncrease">
            Target value increase per period (USD)
          </label>
          <input
            aria-describedby={describedBy('vaTargetIncrease-errors', vaErrors)}
            aria-invalid={vaErrors.length > 0}
            id="field-vaTargetIncrease"
            inputMode="decimal"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'vaTargetIncrease',
                value: event.target.value,
              })
            }
            value={inputs.vaTargetIncrease}
          />
          <FieldErrors errors={vaErrors} id="vaTargetIncrease-errors" />
        </div>
      )}

      <fieldset className="radio-group">
        <legend>Value display</legend>
        <label>
          <input
            checked={inputs.displayMode === 'nominal'}
            name="display-mode"
            onChange={() =>
              dispatch({ type: 'set-display-mode', mode: 'nominal' })
            }
            type="radio"
            value="nominal"
          />
          Nominal (as accounted)
        </label>
        <label>
          <input
            checked={inputs.displayMode === 'real'}
            name="display-mode"
            onChange={() =>
              dispatch({ type: 'set-display-mode', mode: 'real' })
            }
            type="radio"
            value="real"
          />
          Real (deflated by each path&apos;s own sampled inflation)
        </label>
      </fieldset>
    </fieldset>
  )
}
