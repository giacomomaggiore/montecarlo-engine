import { describe, expect, it } from 'vitest'
import type { AssetCatalogueRecord } from '../../core/data/assetCatalogue'
import {
  DEFAULT_SIMULATOR_INPUTS,
  deriveRunPlan,
  errorsForCode,
  maxSelectablePaths,
  reduceSimulatorInputs,
} from './simulatorState'
import type { SimulatorInputs } from './simulatorState'

function catalogueRecord(
  assetId: string,
  firstDate = '2005-01-02',
  lastDate = '2026-01-04',
): AssetCatalogueRecord {
  return {
    assetId,
    ticker: assetId,
    name: `${assetId} fixture fund`,
    assetClass: 'equity',
    history: { firstDate, lastDate, rowCount: 1000, meetsWeeklyMinimum: true },
  }
}

const CATALOGUE = [catalogueRecord('SPY'), catalogueRecord('AGG')]

// A complete, valid input state: 60/40 SPY/AGG on the spec defaults.
function validInputs(
  overrides: Partial<SimulatorInputs> = {},
): SimulatorInputs {
  return {
    ...DEFAULT_SIMULATOR_INPUTS,
    holdings: [
      { assetId: 'SPY', weightPercent: '60', manualAnnualReturnPercent: '7' },
      { assetId: 'AGG', weightPercent: '40', manualAnnualReturnPercent: '3' },
    ],
    ...overrides,
  }
}

function expectSingleErrorCode(inputs: SimulatorInputs, code: string): void {
  const result = deriveRunPlan(inputs, CATALOGUE)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.errors.map((error) => error.code)).toContain(code)
  }
}

describe('reduceSimulatorInputs', () => {
  it('gives the first holding the full allocation and later ones a blank to decide', () => {
    let state = DEFAULT_SIMULATOR_INPUTS
    state = reduceSimulatorInputs(state, {
      type: 'add-holding',
      assetId: 'SPY',
    })
    expect(state.holdings[0].weightPercent).toBe('100')
    state = reduceSimulatorInputs(state, {
      type: 'add-holding',
      assetId: 'AGG',
    })
    expect(state.holdings[1].weightPercent).toBe('')
  })

  it('ignores duplicate adds and adds beyond the six-asset limit', () => {
    let state = DEFAULT_SIMULATOR_INPUTS
    for (const assetId of ['A', 'B', 'C', 'D', 'E', 'F']) {
      state = reduceSimulatorInputs(state, { type: 'add-holding', assetId })
    }
    expect(state.holdings).toHaveLength(6)
    expect(
      reduceSimulatorInputs(state, { type: 'add-holding', assetId: 'G' })
        .holdings,
    ).toHaveLength(6)
    expect(
      reduceSimulatorInputs(state, { type: 'add-holding', assetId: 'A' })
        .holdings,
    ).toHaveLength(6)
  })

  it('removes a holding and edits a specific holding weight', () => {
    let state = validInputs()
    state = reduceSimulatorInputs(state, {
      type: 'set-holding-weight',
      assetId: 'SPY',
      weightPercent: '70',
    })
    expect(state.holdings[0].weightPercent).toBe('70')
    expect(state.holdings[1].weightPercent).toBe('40')

    state = reduceSimulatorInputs(state, {
      type: 'remove-holding',
      assetId: 'SPY',
    })
    expect(state.holdings.map((holding) => holding.assetId)).toEqual(['AGG'])
  })

  it('stores raw field strings verbatim (parsing belongs to deriveRunPlan alone)', () => {
    const state = reduceSimulatorInputs(DEFAULT_SIMULATOR_INPUTS, {
      type: 'set-field',
      field: 'paths',
      value: '2500.',
    })
    expect(state.paths).toBe('2500.')
  })
})

describe('deriveRunPlan — success', () => {
  it('derives the exact SimulationConfig and bootstrap selection from the defaults', () => {
    const result = deriveRunPlan(validInputs(), CATALOGUE)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.assetIds).toEqual(['SPY', 'AGG'])
    expect(result.value.config.weights[0]).toBeCloseTo(0.6, 12)
    expect(result.value.config.weights[1]).toBeCloseTo(0.4, 12)
    expect(result.value.config.initialInvestment).toBe(10_000)
    expect(result.value.config.cashFlow).toEqual({ mode: 'lumpSum' })
    // 10 years of weekly periods.
    expect(result.value.config.periods).toBe(520)
    expect(result.value.config.paths).toBe(2000)
    expect(result.value.config.seed).toBe(42)
    expect(result.value.engineSelection).toEqual({ engine: 'bootstrap' })
  })

  it('maps parametric percent inputs to the fractional engine options', () => {
    const inputs = validInputs({
      engine: 'studentT',
      parametric: {
        returnMode: 'manual',
        nuMode: 'manual',
        manualNu: '8',
        annualInflationPercent: '2.5',
        annualRiskFreePercent: '3',
      },
    })
    const result = deriveRunPlan(inputs, CATALOGUE)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.engineSelection).toEqual({
      engine: 'studentT',
      options: {
        annualInflation: 0.025,
        annualRiskFreeRate: 0.03,
        annualGeometricReturns: [0.07, 0.03],
        degreesOfFreedom: 8,
      },
    })
  })

  it('omits the optional overrides in historical/automatic mode', () => {
    const result = deriveRunPlan(validInputs({ engine: 'studentT' }), CATALOGUE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.engineSelection).toEqual({
      engine: 'studentT',
      options: { annualInflation: 0.02, annualRiskFreeRate: 0.03 },
    })
  })
})

describe('deriveRunPlan — field-addressable failures', () => {
  it('requires at least one holding', () => {
    expectSingleErrorCode(
      validInputs({ holdings: [] }),
      'inputs.holdings.count',
    )
  })

  it('rejects an unparseable holding weight, addressed to that holding', () => {
    const inputs = validInputs()
    const broken = {
      ...inputs,
      holdings: [
        { ...inputs.holdings[0], weightPercent: 'sixty' },
        inputs.holdings[1],
      ],
    }
    expectSingleErrorCode(broken, 'inputs.weight.SPY')
  })

  it('rejects allocations that do not total 100%', () => {
    const inputs = validInputs()
    const broken = {
      ...inputs,
      holdings: [
        { ...inputs.holdings[0], weightPercent: '60' },
        { ...inputs.holdings[1], weightPercent: '30' },
      ],
    }
    expectSingleErrorCode(broken, 'inputs.weights.total')
  })

  it('rejects a non-uint32 seed and a fractional horizon', () => {
    expectSingleErrorCode(validInputs({ seed: '-1' }), 'inputs.seed')
    expectSingleErrorCode(validInputs({ seed: '1.5' }), 'inputs.seed')
    expectSingleErrorCode(
      validInputs({ horizonYears: '2.5' }),
      'inputs.horizonYears',
    )
  })

  it('enforces the derived path ceiling from the work budget', () => {
    // 10 years weekly = 520 periods: ceiling = floor(10,000,000 / 520) =
    // 19,230 paths. 19,231 must fail, 19,230 must pass.
    expect(maxSelectablePaths(520)).toBe(19_230)
    expectSingleErrorCode(validInputs({ paths: '19231' }), 'inputs.paths')
    const atCeiling = deriveRunPlan(validInputs({ paths: '19230' }), CATALOGUE)
    expect(atCeiling.ok).toBe(true)
  })

  it('rejects a selection whose estimated common history is too short', () => {
    // A fund launched weeks ago shares almost no history with SPY.
    const shortLived = catalogueRecord('NEW', '2025-11-02', '2026-01-04')
    const inputs = validInputs()
    const withNew = {
      ...inputs,
      holdings: [
        { ...inputs.holdings[0], weightPercent: '50' },
        {
          assetId: 'NEW',
          weightPercent: '50',
          manualAnnualReturnPercent: '',
        },
      ],
    }
    const result = deriveRunPlan(withNew, [...CATALOGUE, shortLived])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain(
        'inputs.history.insufficient',
      )
    }
  })

  it('validates the mode-specific cash-flow field only for the active mode', () => {
    expectSingleErrorCode(
      validInputs({ cashFlowMode: 'dca', dcaAmount: '-5' }),
      'inputs.dcaAmount',
    )
    // A broken DCA amount must NOT block a lump-sum run: the field is
    // inactive and possibly half-edited.
    const lumpSum = deriveRunPlan(
      validInputs({ cashFlowMode: 'lumpSum', dcaAmount: '-5' }),
      CATALOGUE,
    )
    expect(lumpSum.ok).toBe(true)
  })

  it('rejects out-of-range manual degrees of freedom and missing manual returns', () => {
    expectSingleErrorCode(
      validInputs({
        engine: 'studentT',
        parametric: {
          ...DEFAULT_SIMULATOR_INPUTS.parametric,
          nuMode: 'manual',
          manualNu: '4',
        },
      }),
      'inputs.parametric.nu',
    )

    const inputs = validInputs({
      engine: 'studentT',
      parametric: {
        ...DEFAULT_SIMULATOR_INPUTS.parametric,
        returnMode: 'manual',
      },
    })
    const missingReturn = {
      ...inputs,
      holdings: [
        inputs.holdings[0],
        { ...inputs.holdings[1], manualAnnualReturnPercent: '' },
      ],
    }
    expectSingleErrorCode(missingReturn, 'inputs.parametricReturn.AGG')
  })
})

describe('errorsForCode', () => {
  it('selects exactly the errors addressed to one control', () => {
    const errors = [
      { code: 'inputs.seed', message: 'bad seed' },
      { code: 'inputs.paths', message: 'bad paths' },
    ]
    expect(errorsForCode(errors, 'inputs.seed')).toEqual([
      { code: 'inputs.seed', message: 'bad seed' },
    ])
    expect(errorsForCode(null, 'inputs.seed')).toEqual([])
  })
})
