import type { ValidationError } from '../../core/validation'
import { describedBy, errorsForCode } from './simulatorState'
import type {
  CashFlowMode,
  LeverageResetMode,
  RebalancingMode,
  SimulatorInputs,
  SimulatorInputsAction,
} from './simulatorState'
import { FieldErrors } from './FieldErrors'

// Right-column lower block: money in, rebalancing, cost/tax accounting, and
// the nominal/real display toggle. Every control maps to a validated core rule.

const CASH_FLOW_LABELS: Record<CashFlowMode, string> = {
  lumpSum: 'Lump sum',
  dca: 'DCA',
  valueAveraging: 'Value averaging',
}

const REBALANCING_LABELS: Record<RebalancingMode, string> = {
  none: 'None',
  time: 'Frequency',
  toleranceBand: 'Tolerance band',
}

const LEVERAGE_RESET_LABELS: Record<LeverageResetMode, string> = {
  none: 'None',
  time: 'Every number of periods',
  toleranceBand: 'When gross leverage drifts beyond a band',
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
  const rebalancePeriodErrors = errorsForCode(
    errors,
    'inputs.rebalancing.everyPeriods',
  )
  const rebalanceBandErrors = errorsForCode(
    errors,
    'inputs.rebalancing.percentagePoints',
  )
  const fixedCostErrors = errorsForCode(
    errors,
    'inputs.transactionCosts.fixedPerOrder',
  )
  const proportionalCostErrors = errorsForCode(
    errors,
    'inputs.transactionCosts.proportionalRate',
  )
  const taxRateErrors = errorsForCode(errors, 'inputs.tax.capitalGainsRate')
  const initialBasisErrors = errorsForCode(
    errors,
    'inputs.tax.initialCostBasis',
  )
  const leverageErrors = errorsForCode(
    errors,
    'inputs.leverage.targetGrossExposure',
  )
  const spreadErrors = errorsForCode(
    errors,
    'inputs.leverage.annualBorrowingSpread',
  )
  const resetPeriodErrors = errorsForCode(
    errors,
    'inputs.leverage.reset.everyPeriods',
  )
  const resetBandErrors = errorsForCode(
    errors,
    'inputs.leverage.reset.percentagePoints',
  )
  const maintenanceMargin = Number(inputs.maintenanceMarginPercent) / 100
  const maximumLeverage =
    Number.isFinite(maintenanceMargin) && maintenanceMargin > 0
      ? Math.min(4, 1 / maintenanceMargin)
      : 4

  return (
    <fieldset className="input-section">
      <legend>Portfolio settings</legend>

      <div className="labelled-field">
        <label htmlFor="field-initialInvestment">
          Initial investment ({inputs.baseCurrency})
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

      <div className="portfolio-choice-grid">
        <fieldset className="radio-group">
          <legend>Cash-flow mode</legend>
          {(Object.keys(CASH_FLOW_LABELS) as CashFlowMode[]).map((mode) => (
            <label key={mode}>
              <input
                checked={inputs.cashFlowMode === mode}
                name="cash-flow-mode"
                onChange={() =>
                  dispatch({ type: 'set-cash-flow-mode', mode })
                }
                type="radio"
                value={mode}
              />
              {CASH_FLOW_LABELS[mode]}
            </label>
          ))}
        </fieldset>

        <fieldset className="radio-group">
          <legend>Rebalancing</legend>
          {(Object.keys(REBALANCING_LABELS) as RebalancingMode[]).map(
            (mode) => (
              <label key={mode}>
                <input
                  checked={inputs.rebalancingMode === mode}
                  name="rebalancing-mode"
                  onChange={() =>
                    dispatch({ type: 'set-rebalancing-mode', mode })
                  }
                  type="radio"
                  value={mode}
                />
                {REBALANCING_LABELS[mode]}
              </label>
            ),
          )}
        </fieldset>
      </div>

      {/* Only the ACTIVE mode's amount renders (and only the active mode is
          validated): a half-edited number in an inactive mode must never
          block a run it cannot affect. */}
      {inputs.cashFlowMode === 'dca' && (
        <div className="labelled-field">
          <label htmlFor="field-dcaAmount">
            Contribution per period ({inputs.baseCurrency}, end of period)
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
            Target value increase per period ({inputs.baseCurrency})
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

      {inputs.rebalancingMode === 'time' && (
        <div className="labelled-field">
          <label htmlFor="field-rebalancingEveryPeriods">
            Frequency
          </label>
          <input
            aria-describedby={describedBy(
              'rebalancingEveryPeriods-errors',
              rebalancePeriodErrors,
            )}
            aria-invalid={rebalancePeriodErrors.length > 0}
            id="field-rebalancingEveryPeriods"
            inputMode="numeric"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'rebalancingEveryPeriods',
                value: event.target.value,
              })
            }
            value={inputs.rebalancingEveryPeriods}
          />
          <FieldErrors
            errors={rebalancePeriodErrors}
            id="rebalancingEveryPeriods-errors"
          />
        </div>
      )}

      {inputs.rebalancingMode === 'toleranceBand' && (
        <div className="labelled-field">
          <label htmlFor="field-rebalancingBandPercentagePoints">
            Tolerance band (percentage points, strictly beyond)
          </label>
          <input
            aria-describedby={describedBy(
              'rebalancingBandPercentagePoints-errors',
              rebalanceBandErrors,
            )}
            aria-invalid={rebalanceBandErrors.length > 0}
            id="field-rebalancingBandPercentagePoints"
            inputMode="decimal"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'rebalancingBandPercentagePoints',
                value: event.target.value,
              })
            }
            value={inputs.rebalancingBandPercentagePoints}
          />
          <FieldErrors
            errors={rebalanceBandErrors}
            id="rebalancingBandPercentagePoints-errors"
          />
        </div>
      )}

      <fieldset className="radio-group">
        <legend>Transaction costs and taxes</legend>
        <div className="labelled-field">
          <label htmlFor="field-fixedTransactionCost">
            Fixed cost per executed order (USD)
          </label>
          <input
            aria-describedby={describedBy(
              'fixedTransactionCost-errors',
              fixedCostErrors,
            )}
            aria-invalid={fixedCostErrors.length > 0}
            id="field-fixedTransactionCost"
            inputMode="decimal"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'fixedTransactionCost',
                value: event.target.value,
              })
            }
            value={inputs.fixedTransactionCost}
          />
          <FieldErrors
            errors={fixedCostErrors}
            id="fixedTransactionCost-errors"
          />
        </div>

        <div className="labelled-field">
          <label htmlFor="field-proportionalTransactionCostPercent">
            Proportional transaction cost (%)
          </label>
          <input
            aria-describedby={describedBy(
              'proportionalTransactionCostPercent-errors',
              proportionalCostErrors,
            )}
            aria-invalid={proportionalCostErrors.length > 0}
            id="field-proportionalTransactionCostPercent"
            inputMode="decimal"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'proportionalTransactionCostPercent',
                value: event.target.value,
              })
            }
            value={inputs.proportionalTransactionCostPercent}
          />
          <FieldErrors
            errors={proportionalCostErrors}
            id="proportionalTransactionCostPercent-errors"
          />
        </div>

        <div className="labelled-field">
          <label htmlFor="field-capitalGainsTaxPercent">
            Capital-gains tax rate (%)
          </label>
          <input
            aria-describedby={describedBy(
              'capitalGainsTaxPercent-errors',
              taxRateErrors,
            )}
            aria-invalid={taxRateErrors.length > 0}
            id="field-capitalGainsTaxPercent"
            inputMode="decimal"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'capitalGainsTaxPercent',
                value: event.target.value,
              })
            }
            value={inputs.capitalGainsTaxPercent}
          />
          <FieldErrors
            errors={taxRateErrors}
            id="capitalGainsTaxPercent-errors"
          />
        </div>

        <div className="labelled-field">
          <label htmlFor="field-initialCostBasis">
            Initial cost basis override (USD, optional)
          </label>
          <input
            aria-describedby={describedBy(
              'initialCostBasis-errors',
              initialBasisErrors,
            )}
            aria-invalid={initialBasisErrors.length > 0}
            id="field-initialCostBasis"
            inputMode="decimal"
            onChange={(event) =>
              dispatch({
                type: 'set-field',
                field: 'initialCostBasis',
                value: event.target.value,
              })
            }
            value={inputs.initialCostBasis}
          />
          <FieldErrors
            errors={initialBasisErrors}
            id="initialCostBasis-errors"
          />
        </div>
      </fieldset>

      <fieldset className="radio-group">
        <legend>Leverage</legend>
        <label>
          <input
            checked={inputs.leverageMode === 'none'}
            name="leverage-mode"
            onChange={() =>
              dispatch({ type: 'set-leverage-mode', mode: 'none' })
            }
            type="radio"
          />
          No leverage
        </label>
        <label>
          <input
            checked={inputs.leverageMode === 'enabled'}
            name="leverage-mode"
            onChange={() =>
              dispatch({ type: 'set-leverage-mode', mode: 'enabled' })
            }
            type="radio"
          />
          Enable weekly margin leverage
        </label>

        {inputs.leverageMode === 'enabled' && (
          <>
            <div className="labelled-field">
              <label htmlFor="field-targetGrossExposure">
                Target gross exposure (x, maximum {maximumLeverage.toFixed(2)}x)
              </label>
              <input
                aria-describedby={describedBy(
                  'targetGrossExposure-errors',
                  leverageErrors,
                )}
                aria-invalid={leverageErrors.length > 0}
                id="field-targetGrossExposure"
                inputMode="decimal"
                onChange={(event) =>
                  dispatch({
                    type: 'set-field',
                    field: 'targetGrossExposure',
                    value: event.target.value,
                  })
                }
                value={inputs.targetGrossExposure}
              />
              <FieldErrors
                errors={leverageErrors}
                id="targetGrossExposure-errors"
              />
            </div>
            <div className="labelled-field">
              <label htmlFor="field-maintenanceMarginPercent">
                Maintenance margin (%)
              </label>
              <input
                id="field-maintenanceMarginPercent"
                inputMode="decimal"
                onChange={(event) =>
                  dispatch({
                    type: 'set-field',
                    field: 'maintenanceMarginPercent',
                    value: event.target.value,
                  })
                }
                value={inputs.maintenanceMarginPercent}
              />
            </div>
            <div className="labelled-field">
              <label htmlFor="field-annualBorrowingSpreadPercent">
                Annual borrowing spread (%)
              </label>
              <input
                aria-describedby={describedBy(
                  'annualBorrowingSpread-errors',
                  spreadErrors,
                )}
                aria-invalid={spreadErrors.length > 0}
                id="field-annualBorrowingSpreadPercent"
                inputMode="decimal"
                onChange={(event) =>
                  dispatch({
                    type: 'set-field',
                    field: 'annualBorrowingSpreadPercent',
                    value: event.target.value,
                  })
                }
                value={inputs.annualBorrowingSpreadPercent}
              />
              <FieldErrors
                errors={spreadErrors}
                id="annualBorrowingSpread-errors"
              />
            </div>
            <fieldset className="radio-group">
              <legend>Leverage reset</legend>
              {(Object.keys(LEVERAGE_RESET_LABELS) as LeverageResetMode[]).map(
                (mode) => (
                  <label key={mode}>
                    <input
                      checked={inputs.leverageResetMode === mode}
                      name="leverage-reset-mode"
                      onChange={() =>
                        dispatch({ type: 'set-leverage-reset-mode', mode })
                      }
                      type="radio"
                    />
                    {LEVERAGE_RESET_LABELS[mode]}
                  </label>
                ),
              )}
            </fieldset>
            {inputs.leverageResetMode === 'time' && (
              <div className="labelled-field">
                <label htmlFor="field-leverageResetEveryPeriods">
                  Reset every number of periods
                </label>
                <input
                  aria-describedby={describedBy(
                    'leverageResetEveryPeriods-errors',
                    resetPeriodErrors,
                  )}
                  aria-invalid={resetPeriodErrors.length > 0}
                  id="field-leverageResetEveryPeriods"
                  inputMode="numeric"
                  onChange={(event) =>
                    dispatch({
                      type: 'set-field',
                      field: 'leverageResetEveryPeriods',
                      value: event.target.value,
                    })
                  }
                  value={inputs.leverageResetEveryPeriods}
                />
                <FieldErrors
                  errors={resetPeriodErrors}
                  id="leverageResetEveryPeriods-errors"
                />
              </div>
            )}
            {inputs.leverageResetMode === 'toleranceBand' && (
              <div className="labelled-field">
                <label htmlFor="field-leverageResetBandPercentagePoints">
                  Gross leverage drift band (percentage points, strictly beyond)
                </label>
                <input
                  aria-describedby={describedBy(
                    'leverageResetBandPercentagePoints-errors',
                    resetBandErrors,
                  )}
                  aria-invalid={resetBandErrors.length > 0}
                  id="field-leverageResetBandPercentagePoints"
                  inputMode="decimal"
                  onChange={(event) =>
                    dispatch({
                      type: 'set-field',
                      field: 'leverageResetBandPercentagePoints',
                      value: event.target.value,
                    })
                  }
                  value={inputs.leverageResetBandPercentagePoints}
                />
                <FieldErrors
                  errors={resetBandErrors}
                  id="leverageResetBandPercentagePoints-errors"
                />
              </div>
            )}
            {Number(inputs.targetGrossExposure) === maximumLeverage && (
              <p className="input-hint" role="alert">
                No maintenance buffer: target exposure equals the margin
                boundary.
              </p>
            )}
          </>
        )}
      </fieldset>

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
