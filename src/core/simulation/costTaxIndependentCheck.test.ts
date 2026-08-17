import { describe, expect, it } from 'vitest'
import type { AlignedDataset } from '../data/datasetTypes'
import { runSimulation } from './runSimulation'
import type { SimulationEngine } from './simulationEngine'

const dataset: AlignedDataset = {
  identity: {
    version: 'phase-7-independent-fixture',
    checksum: 'phase-7-independent-fixture',
    frequency: 'weekly',
    baseCurrency: 'USD',
  },
  assetIds: ['AAA', 'BBB'],
  dates: ['2024-01-05', '2024-01-12'],
  assetReturns: [new Float32Array([0, 0]), new Float32Array([0, 0])],
  inflation: new Float32Array([0, 0]),
  riskFreeRates: new Float32Array([0, 0]),
}

describe('Phase 7 independent cost and tax check', () => {
  it('matches the procedural Python trace through final liquidation', () => {
    const scenarios = [
      {
        assetReturns: [0.2, -0.2],
        inflation: 0,
        riskFreeRate: 0,
        sourceRowIndex: 0,
      },
      {
        assetReturns: [-0.1, 0.1],
        inflation: 0,
        riskFreeRate: 0,
        sourceRowIndex: 1,
      },
    ]
    let scenarioIndex = 0
    const engine: SimulationEngine = {
      nextScenario: () => scenarios[scenarioIndex++],
    }

    const result = runSimulation({
      engine,
      dataset,
      config: {
        weights: [0.5, 0.5],
        initialInvestment: 1000,
        cashFlow: { mode: 'dca', amount: 105 },
        rebalancing: { mode: 'time', everyPeriods: 1 },
        transactionCosts: { fixedPerOrder: 2, proportionalRate: 0.01 },
        tax: { capitalGainsRate: 0.2, initialCostBasis: null },
        paths: 1,
        periods: 2,
        seed: 0,
      },
      modelVersion: 'independent-check',
      prngVersion: 'independent-check',
    })
    if (!result.ok) throw new Error('expected a successful run')

    // Expected values are printed by validation/phase_7_independent_check.py,
    // a procedural implementation written from the README rules rather than
    // from this runner. Period 2 includes final liquidation in retained audit
    // data because it happens at the terminal boundary of that period.
    const retained = result.value.retainedPaths[0]
    expect(retained.values[1]).toBeCloseTo(Number('1091.6831683168317'), 10)
    expect(retained.values[2]).toBeCloseTo(Number('1168.4456505478615'), 10)
    expect(retained.transactionCosts[1]).toBeCloseTo(
      Number('10.916831683168317'),
      10,
    )
    expect(retained.realizedGainLosses[1]).toBeCloseTo(12, 10)
    expect(retained.taxesPaid[1]).toBeCloseTo(2.4, 10)
    expect(retained.costBases[1]).toBeCloseTo(1114.6, 10)
    expect(retained.lossCarryforwards[1]).toBeCloseTo(0, 10)
    expect(retained.transactionCosts[2]).toBeCloseTo(
      Number('25.8178511910597'),
      10,
    )
    expect(retained.realizedGainLosses[2]).toBeCloseTo(
      Number('-49.56636604254481'),
      10,
    )
    expect(retained.taxesPaid[2]).toBeCloseTo(Number('1.5879834095935395'), 10)
    expect(retained.costBases[2]).toBeCloseTo(0, 10)
    expect(retained.lossCarryforwards[2]).toBeCloseTo(
      Number('57.50628309051251'),
      10,
    )
    expect(result.value.terminalWealth[0]).toBeCloseTo(
      Number('1168.4456505478615'),
      10,
    )
  })
})
