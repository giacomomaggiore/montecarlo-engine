import { estimateCommonHistory } from '../../core/data/assetCatalogue'
import type { AssetCatalogueRecord } from '../../core/data/assetCatalogue'
import { minimumObservations } from '../../core/data/datasetTypes'
import type { Frequency } from '../../core/data/datasetTypes'
import type { ParametricStudentTOptions } from '../../core/simulation/parametricStudentT'
import {
  MAX_ASSET_COUNT,
  MAX_PATHS,
  MAX_SIMULATION_WORK,
  MAX_YEARS,
  type SimulationAssetSelection,
  type RebalancingConfig,
  validateSimulationConfig,
} from '../../core/simulation/simulationTypes'
import type {
  CashFlowConfig,
  SimulationConfig,
} from '../../core/simulation/simulationTypes'
import type { ValidationError, ValidationResult } from '../../core/validation'
import type { EngineSelection } from '../../workers/workerMessages'

// Phase 4.4 — everything the user EDITS, as one plain reducer. This is
// input-configuration state, kept strictly apart from executionState.ts (the
// run lifecycle) per the Maintenance Policy: editing a field must never be
// able to touch a run, and a Worker message must never be able to touch a
// half-typed field.
//
// Numeric fields are stored as the RAW STRINGS the user typed, parsed only
// inside deriveRunPlan(). Storing parsed numbers would force every keystroke
// through a lossy round-trip ("1." becomes 1 and the dot vanishes) and would
// scatter parsing across every input's onChange. One parse point means one
// place validation can be honest about what the user actually entered.

export type EngineChoice = 'bootstrap' | 'studentT'
export type CashFlowMode = CashFlowConfig['mode']
export type RebalancingMode = RebalancingConfig['mode']

export type HoldingInput = {
  readonly assetId: string
  // Allocation in PERCENT (the UI unit: "60" means 60%), as typed.
  readonly weightPercent: string
  // Parametric per-holding annual geometric return override in percent, as
  // typed. Only consulted when parametric.returnMode is 'manual'.
  readonly manualAnnualReturnPercent: string
}

export type ParametricInputs = {
  // 'historical': drift from the fitted sample means (the README default).
  // 'manual': the user enters an annual geometric return per holding.
  readonly returnMode: 'historical' | 'manual'
  // 'automatic': nu estimated from pooled excess kurtosis. 'manual': the
  // user picks nu directly within the same [5, 100] clamp the estimator uses.
  readonly nuMode: 'automatic' | 'manual'
  readonly manualNu: string
  readonly annualInflationPercent: string
  readonly annualRiskFreePercent: string
}

export type SimulatorInputs = {
  readonly holdings: readonly HoldingInput[]
  readonly benchmarkAssetId: string | null
  readonly engine: EngineChoice
  readonly seed: string
  readonly paths: string
  readonly horizonYears: string
  // Weekly is the only released artifact today; the type keeps 'monthly' so
  // Phase 10 unlocks the control without a state-shape change.
  readonly frequency: Frequency
  readonly initialInvestment: string
  readonly cashFlowMode: CashFlowMode
  readonly dcaAmount: string
  readonly vaTargetIncrease: string
  readonly rebalancingMode: RebalancingMode
  readonly rebalancingEveryPeriods: string
  readonly rebalancingBandPercentagePoints: string
  readonly parametric: ParametricInputs
  // Display-only toggle (never sent to the Worker): nominal accounting
  // values versus per-path inflation-deflated real values.
  readonly displayMode: 'nominal' | 'real'
}

// Frontend-spec defaults: weekly frequency, 2,000 paths, 10 years.
export const DEFAULT_SIMULATOR_INPUTS: SimulatorInputs = {
  holdings: [],
  benchmarkAssetId: null,
  engine: 'bootstrap',
  seed: '42',
  paths: '2000',
  horizonYears: '10',
  frequency: 'weekly',
  initialInvestment: '10000',
  cashFlowMode: 'lumpSum',
  dcaAmount: '100',
  vaTargetIncrease: '100',
  rebalancingMode: 'none',
  rebalancingEveryPeriods: '52',
  rebalancingBandPercentagePoints: '5',
  parametric: {
    returnMode: 'historical',
    nuMode: 'automatic',
    manualNu: '8',
    annualInflationPercent: '2',
    annualRiskFreePercent: '3',
  },
  displayMode: 'nominal',
}

// The string-valued scalar fields a generic text input can set directly.
export type ScalarInputField =
  | 'seed'
  | 'paths'
  | 'horizonYears'
  | 'initialInvestment'
  | 'dcaAmount'
  | 'vaTargetIncrease'
  | 'rebalancingEveryPeriods'
  | 'rebalancingBandPercentagePoints'

export type ParametricScalarField =
  'manualNu' | 'annualInflationPercent' | 'annualRiskFreePercent'

export type SimulatorInputsAction =
  | { readonly type: 'add-holding'; readonly assetId: string }
  | { readonly type: 'remove-holding'; readonly assetId: string }
  | { readonly type: 'set-benchmark'; readonly assetId: string | null }
  | {
      readonly type: 'set-holding-weight'
      readonly assetId: string
      readonly weightPercent: string
    }
  | {
      readonly type: 'set-holding-manual-return'
      readonly assetId: string
      readonly manualAnnualReturnPercent: string
    }
  | { readonly type: 'set-engine'; readonly engine: EngineChoice }
  | {
      readonly type: 'set-field'
      readonly field: ScalarInputField
      readonly value: string
    }
  | { readonly type: 'set-cash-flow-mode'; readonly mode: CashFlowMode }
  | { readonly type: 'set-rebalancing-mode'; readonly mode: RebalancingMode }
  | {
      readonly type: 'set-parametric-return-mode'
      readonly mode: ParametricInputs['returnMode']
    }
  | {
      readonly type: 'set-parametric-nu-mode'
      readonly mode: ParametricInputs['nuMode']
    }
  | {
      readonly type: 'set-parametric-field'
      readonly field: ParametricScalarField
      readonly value: string
    }
  | {
      readonly type: 'set-display-mode'
      readonly mode: SimulatorInputs['displayMode']
    }

export function reduceSimulatorInputs(
  state: SimulatorInputs,
  action: SimulatorInputsAction,
): SimulatorInputs {
  switch (action.type) {
    case 'add-holding': {
      // Silently ignoring an over-limit or duplicate add keeps the reducer
      // total; the picker also disables these adds at the control level.
      if (
        state.holdings.length >= MAX_ASSET_COUNT ||
        state.holdings.some((holding) => holding.assetId === action.assetId)
      ) {
        return state
      }
      // First holding defaults to the full allocation; later ones start
      // blank so the user must decide the split rather than silently owning
      // 0% positions.
      const weightPercent = state.holdings.length === 0 ? '100' : ''
      return {
        ...state,
        holdings: [
          ...state.holdings,
          {
            assetId: action.assetId,
            weightPercent,
            manualAnnualReturnPercent: '',
          },
        ],
      }
    }

    case 'remove-holding':
      return {
        ...state,
        holdings: state.holdings.filter(
          (holding) => holding.assetId !== action.assetId,
        ),
      }

    case 'set-benchmark':
      return { ...state, benchmarkAssetId: action.assetId }

    case 'set-holding-weight':
      return {
        ...state,
        holdings: state.holdings.map((holding) =>
          holding.assetId === action.assetId
            ? { ...holding, weightPercent: action.weightPercent }
            : holding,
        ),
      }

    case 'set-holding-manual-return':
      return {
        ...state,
        holdings: state.holdings.map((holding) =>
          holding.assetId === action.assetId
            ? {
                ...holding,
                manualAnnualReturnPercent: action.manualAnnualReturnPercent,
              }
            : holding,
        ),
      }

    case 'set-engine':
      return { ...state, engine: action.engine }

    case 'set-field':
      return { ...state, [action.field]: action.value }

    case 'set-cash-flow-mode':
      return { ...state, cashFlowMode: action.mode }

    case 'set-rebalancing-mode':
      return { ...state, rebalancingMode: action.mode }

    case 'set-parametric-return-mode':
      return {
        ...state,
        parametric: { ...state.parametric, returnMode: action.mode },
      }

    case 'set-parametric-nu-mode':
      return {
        ...state,
        parametric: { ...state.parametric, nuMode: action.mode },
      }

    case 'set-parametric-field':
      return {
        ...state,
        parametric: { ...state.parametric, [action.field]: action.value },
      }

    case 'set-display-mode':
      return { ...state, displayMode: action.mode }
  }
}

// ---------------------------------------------------------------------------
// Derivation: raw input strings -> a validated, runnable plan
// ---------------------------------------------------------------------------

export type RunPlan = {
  readonly assetIds: readonly string[]
  readonly selection: SimulationAssetSelection
  readonly config: SimulationConfig
  readonly engineSelection: EngineSelection
}

// The spec's "reduce the selectable path maximum when frequency and horizon
// exceed the work budget": for a given period count, the path ceiling is
// whatever keeps paths * periods inside the global 10,000,000 budget.
export function maxSelectablePaths(periods: number): number {
  if (!Number.isInteger(periods) || periods <= 0) {
    return MAX_PATHS
  }
  return Math.min(MAX_PATHS, Math.floor(MAX_SIMULATION_WORK / periods))
}

function inputError(code: string, message: string): ValidationError {
  return { code, message }
}

// One parse rule for every numeric text field: trimmed, non-empty, and a
// finite decimal number. Number('') is 0 and Number('12abc') is NaN — both
// must surface as "not a number", never as a silently usable value.
function parseFiniteNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

// Turns the raw form state plus the loaded catalogue into either a runnable
// plan (dataset selection + SimulationConfig + EngineSelection) or the
// complete list of field-addressable errors. Every error code starts with
// 'inputs.' and, where per-holding, embeds the assetId — that code is the
// contract the UI uses to place each message beside its own control.
//
// The core validator (validateSimulationConfig) still runs at the end as
// defense in depth: the UI-level checks should make it unreachable, but if
// the two ever disagree, the core rule wins and the mismatch is visible.
export function deriveRunPlan(
  inputs: SimulatorInputs,
  catalogueAssets: readonly AssetCatalogueRecord[],
): ValidationResult<RunPlan> {
  const errors: ValidationError[] = []

  // --- Portfolio construction -------------------------------------------
  if (inputs.holdings.length === 0) {
    errors.push(
      inputError('inputs.holdings.count', 'Select at least one asset.'),
    )
  }
  if (inputs.holdings.length > MAX_ASSET_COUNT) {
    errors.push(
      inputError(
        'inputs.holdings.count',
        `Select at most ${MAX_ASSET_COUNT} assets.`,
      ),
    )
  }

  const weights: number[] = []
  let totalWeightPercent = 0
  for (const holding of inputs.holdings) {
    const weightPercent = parseFiniteNumber(holding.weightPercent)
    if (weightPercent === null || weightPercent < 0) {
      errors.push(
        inputError(
          `inputs.weight.${holding.assetId}`,
          `Enter a non-negative allocation percentage for ${holding.assetId}.`,
        ),
      )
      continue
    }
    totalWeightPercent += weightPercent
    weights.push(weightPercent / 100)
  }

  // Only meaningful when every individual weight parsed; a per-field error
  // above already blocks the run, so a misleading total error is noise.
  if (
    weights.length === inputs.holdings.length &&
    inputs.holdings.length > 0 &&
    Math.abs(totalWeightPercent - 100) > 0.01
  ) {
    errors.push(
      inputError(
        'inputs.weights.total',
        `Allocations must total 100% (currently ${totalWeightPercent.toFixed(2)}%).`,
      ),
    )
  }

  // --- Estimated common history (advisory gate) --------------------------
  // The catalogue spans give a preview of the joint history; the loader's
  // finite-row alignment remains the binding check at Run time (interior
  // gaps are invisible to span arithmetic — see assetCatalogue.ts).
  const selectedIds = selectedAssetIds(inputs)
  const selectedRecords = selectedIds
    .map((assetId) =>
      catalogueAssets.find((record) => record.assetId === assetId),
    )
    .filter((record): record is AssetCatalogueRecord => record !== undefined)
  if (selectedRecords.length === selectedIds.length) {
    const estimate = estimateCommonHistory(selectedRecords, inputs.frequency)
    if (estimate !== null && !estimate.meetsMinimum) {
      errors.push(
        inputError(
          'inputs.history.insufficient',
          `The selected assets share roughly ${estimate.estimatedRowCount} ${inputs.frequency} observations; at least ${minimumObservations(inputs.frequency)} are required.`,
        ),
      )
    }
  } else if (inputs.benchmarkAssetId !== null) {
    errors.push(
      inputError('inputs.benchmark', 'Select a benchmark from the catalogue.'),
    )
  }

  // --- Simulation inputs --------------------------------------------------
  const seed = parseFiniteNumber(inputs.seed)
  if (
    seed === null ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffff_ffff
  ) {
    errors.push(
      inputError(
        'inputs.seed',
        'Seed must be an integer from 0 to 4294967295.',
      ),
    )
  }

  const periodsPerYear = inputs.frequency === 'weekly' ? 52 : 12
  const horizonYears = parseFiniteNumber(inputs.horizonYears)
  if (
    horizonYears === null ||
    !Number.isInteger(horizonYears) ||
    horizonYears < 1 ||
    horizonYears > MAX_YEARS
  ) {
    errors.push(
      inputError(
        'inputs.horizonYears',
        `Horizon must be a whole number of years from 1 to ${MAX_YEARS}.`,
      ),
    )
  }
  const periods =
    horizonYears !== null ? Math.round(horizonYears * periodsPerYear) : null

  const paths = parseFiniteNumber(inputs.paths)
  const pathCeiling = periods !== null ? maxSelectablePaths(periods) : MAX_PATHS
  if (
    paths === null ||
    !Number.isInteger(paths) ||
    paths < 1 ||
    paths > pathCeiling
  ) {
    errors.push(
      inputError(
        'inputs.paths',
        `Paths must be a whole number from 1 to ${pathCeiling} at this horizon (work budget: paths x periods <= ${MAX_SIMULATION_WORK}).`,
      ),
    )
  }

  // --- Portfolio settings -------------------------------------------------
  const initialInvestment = parseFiniteNumber(inputs.initialInvestment)
  if (initialInvestment === null || initialInvestment < 0) {
    errors.push(
      inputError(
        'inputs.initialInvestment',
        'Initial investment must be a non-negative amount.',
      ),
    )
  }

  let cashFlow: CashFlowConfig | null = null
  if (inputs.cashFlowMode === 'lumpSum') {
    cashFlow = { mode: 'lumpSum' }
  } else if (inputs.cashFlowMode === 'dca') {
    const amount = parseFiniteNumber(inputs.dcaAmount)
    if (amount === null || amount < 0) {
      errors.push(
        inputError(
          'inputs.dcaAmount',
          'DCA contribution must be a non-negative amount.',
        ),
      )
    } else {
      cashFlow = { mode: 'dca', amount }
    }
  } else {
    const targetIncrease = parseFiniteNumber(inputs.vaTargetIncrease)
    if (targetIncrease === null || targetIncrease < 0) {
      errors.push(
        inputError(
          'inputs.vaTargetIncrease',
          'Value-averaging target increase must be a non-negative amount.',
        ),
      )
    } else {
      cashFlow = { mode: 'valueAveraging', targetIncrease }
    }
  }

  let rebalancing: RebalancingConfig | null = null
  if (inputs.rebalancingMode === 'none') {
    rebalancing = { mode: 'none' }
  } else if (inputs.rebalancingMode === 'time') {
    const everyPeriods = parseFiniteNumber(inputs.rebalancingEveryPeriods)
    if (
      everyPeriods === null ||
      !Number.isInteger(everyPeriods) ||
      everyPeriods < 1 ||
      (periods !== null && everyPeriods > periods)
    ) {
      errors.push(
        inputError(
          'inputs.rebalancing.everyPeriods',
          'Rebalancing interval must be a whole number within the horizon.',
        ),
      )
    } else {
      rebalancing = { mode: 'time', everyPeriods }
    }
  } else {
    const percentagePoints = parseFiniteNumber(
      inputs.rebalancingBandPercentagePoints,
    )
    if (
      percentagePoints === null ||
      percentagePoints <= 0 ||
      percentagePoints > 100
    ) {
      errors.push(
        inputError(
          'inputs.rebalancing.percentagePoints',
          'Tolerance band must be greater than 0 and no more than 100 percentage points.',
        ),
      )
    } else {
      rebalancing = { mode: 'toleranceBand', percentagePoints }
    }
  }

  // --- Parametric options (only when that engine is selected) -------------
  let engineSelection: EngineSelection | null = null
  if (inputs.engine === 'bootstrap') {
    engineSelection = { engine: 'bootstrap' }
  } else {
    const annualInflation = parseFiniteNumber(
      inputs.parametric.annualInflationPercent,
    )
    if (annualInflation === null || annualInflation <= -100) {
      errors.push(
        inputError(
          'inputs.parametric.inflation',
          'Annual inflation must be a percentage above -100%.',
        ),
      )
    }
    const annualRiskFree = parseFiniteNumber(
      inputs.parametric.annualRiskFreePercent,
    )
    if (annualRiskFree === null || annualRiskFree <= -100) {
      errors.push(
        inputError(
          'inputs.parametric.riskFree',
          'Annual risk-free rate must be a percentage above -100%.',
        ),
      )
    }

    let degreesOfFreedom: number | undefined
    if (inputs.parametric.nuMode === 'manual') {
      const manualNu = parseFiniteNumber(inputs.parametric.manualNu)
      // Same [5, 100] clamp range the automatic estimator enforces: below 5
      // the t distribution's kurtosis is undefined/absurd for weekly returns,
      // above 100 it is indistinguishable from Gaussian.
      if (manualNu === null || manualNu < 5 || manualNu > 100) {
        errors.push(
          inputError(
            'inputs.parametric.nu',
            'Degrees of freedom must be between 5 and 100.',
          ),
        )
      } else {
        degreesOfFreedom = manualNu
      }
    }

    let annualGeometricReturns: number[] | undefined
    if (inputs.parametric.returnMode === 'manual') {
      annualGeometricReturns = []
      for (const holding of inputs.holdings) {
        const returnPercent = parseFiniteNumber(
          holding.manualAnnualReturnPercent,
        )
        // A geometric return of -100%/year or worse has no log form.
        if (returnPercent === null || returnPercent <= -100) {
          errors.push(
            inputError(
              `inputs.parametricReturn.${holding.assetId}`,
              `Enter an annual return above -100% for ${holding.assetId}.`,
            ),
          )
        } else {
          annualGeometricReturns.push(returnPercent / 100)
        }
      }
    }

    if (annualInflation !== null && annualRiskFree !== null) {
      const options: ParametricStudentTOptions = {
        annualInflation: annualInflation / 100,
        annualRiskFreeRate: annualRiskFree / 100,
        ...(annualGeometricReturns !== undefined &&
        annualGeometricReturns.length === inputs.holdings.length
          ? { annualGeometricReturns }
          : {}),
        ...(degreesOfFreedom !== undefined ? { degreesOfFreedom } : {}),
      }
      engineSelection = { engine: 'studentT', options }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  // Everything parsed: assemble the config and re-validate with the core
  // rule set. This should never fail if the checks above are right — but if
  // it does, the core errors surface rather than being assumed away.
  const config: SimulationConfig = {
    weights,
    initialInvestment: initialInvestment as number,
    cashFlow: cashFlow as CashFlowConfig,
    rebalancing: rebalancing as RebalancingConfig,
    paths: paths as number,
    periods: periods as number,
    seed: seed as number,
  }
  const coreResult = validateSimulationConfig(
    config,
    inputs.holdings.length,
    inputs.frequency,
  )
  if (!coreResult.ok) {
    return coreResult
  }

  return {
    ok: true,
    value: {
      assetIds: selectedAssetIds(inputs),
      selection: selectionForInputs(inputs),
      config,
      engineSelection: engineSelection as EngineSelection,
    },
  }
}

function selectedAssetIds(inputs: SimulatorInputs): readonly string[] {
  const assetIds = inputs.holdings.map((holding) => holding.assetId)
  if (
    inputs.benchmarkAssetId !== null &&
    !assetIds.includes(inputs.benchmarkAssetId)
  ) {
    assetIds.push(inputs.benchmarkAssetId)
  }
  return assetIds
}

function selectionForInputs(inputs: SimulatorInputs): SimulationAssetSelection {
  const assetIds = selectedAssetIds(inputs)
  return {
    portfolioAssetIndices: inputs.holdings.map((holding) =>
      assetIds.indexOf(holding.assetId),
    ),
    benchmarkAssetIndex:
      inputs.benchmarkAssetId === null
        ? null
        : assetIds.indexOf(inputs.benchmarkAssetId),
  }
}

// The UI helper that places each message beside its own control: every
// control asks for exactly its own code (or code prefix, for per-holding
// fields).
export function errorsForCode(
  errors: readonly ValidationError[] | null,
  code: string,
): readonly ValidationError[] {
  if (errors === null) {
    return []
  }
  return errors.filter((error) => error.code === code)
}

// aria-describedby must reference only ids that exist; return undefined (not
// an empty string) when the control currently has no errors. Lives here (not
// in FieldErrors.tsx) so that component file exports only components, which
// React fast-refresh requires.
export function describedBy(
  id: string,
  errors: readonly ValidationError[],
): string | undefined {
  return errors.length > 0 ? id : undefined
}
