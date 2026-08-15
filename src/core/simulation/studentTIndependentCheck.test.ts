import { describe, expect, it } from 'vitest'
import type { AlignedDataset } from '../data/datasetTypes'
import {
  createParametricStudentTEngine,
  fitParametricStudentT,
  PARAMETRIC_STUDENT_T_MODEL_VERSION,
} from './parametricStudentT'
import { runSimulation } from './runSimulation'
import type { SimulationConfig } from './simulationTypes'

// Phase 3.6 cross-check: every expected number in this file was printed by
// validation/phase_3_independent_check.py, an independent Python
// reimplementation of the full chain -- xoshiro128**, Box-Muller,
// Marsaglia-Tsang, the Student's t fit, the scenario sampling rule, and the
// Phase 1 portfolio accounting -- written from the README's prose, not from
// this TypeScript source. Unlike Phase 1.6 (integer and +-*/ arithmetic
// only), this chain exercises exp/log/cos/sqrt, so agreement additionally
// proves the transcendental-function results match at float64 precision.

const ASSET_A_RETURNS = [0.02, -0.05, 0.03, 0.01, -0.02, 0.04, -0.01, 0.02]
const ASSET_B_RETURNS = [0.01, -0.03, 0.02, 0.005, -0.01, 0.03, -0.005, 0.015]

const DATASET: AlignedDataset = {
  identity: {
    version: 'fixture-weekly-v1',
    checksum: 'sha256:fixture',
    frequency: 'weekly',
    baseCurrency: 'USD',
  },
  assetIds: ['A', 'B'],
  dates: ASSET_A_RETURNS.map(
    (_, index) => `2024-01-${String(index + 1).padStart(2, '0')}`,
  ),
  assetReturns: [
    new Float32Array(ASSET_A_RETURNS),
    new Float32Array(ASSET_B_RETURNS),
  ],
  inflation: new Float32Array(ASSET_A_RETURNS.length),
  riskFreeRates: new Float32Array(ASSET_A_RETURNS.length),
}

function fitModel() {
  const fit = fitParametricStudentT(DATASET, {
    annualInflation: 0.02,
    annualRiskFreeRate: 0.03,
  })
  if (!fit.ok) throw new Error('fixture fit must succeed')
  return fit.value
}

function buildConfig(overrides: Partial<SimulationConfig>): SimulationConfig {
  return {
    weights: [0.6, 0.4],
    initialInvestment: 1000,
    cashFlow: { mode: 'lumpSum' },
    paths: 1,
    periods: 4,
    seed: 42,
    ...overrides,
  }
}

function runOnePath(config: SimulationConfig) {
  const result = runSimulation({
    engine: createParametricStudentTEngine(fitModel(), config.seed),
    dataset: DATASET,
    config,
    modelVersion: PARAMETRIC_STUDENT_T_MODEL_VERSION,
    prngVersion: 'xoshiro128**-v1',
  })
  if (!result.ok) throw new Error('run must succeed')
  return result.value.retainedPaths[0]
}

describe('parametric Student t engine vs independent Python implementation', () => {
  it('reproduces the independently fitted model', () => {
    const model = fitModel()

    expect(model.location[0]).toBeCloseTo(0.004598595071362008, 14)
    expect(model.location[1]).toBeCloseTo(0.004208228563899337, 14)
    expect(model.diagnostics.pooledExcessKurtosis).toBeCloseTo(
      -0.5227070130492946,
      12,
    )
    expect(model.degreesOfFreedom).toBe(100)
    expect(model.choleskyFactor[0][0]).toBeCloseTo(0.02961887170217289, 12)
    expect(model.choleskyFactor[1][0]).toBeCloseTo(0.018656927561210245, 12)
    expect(model.choleskyFactor[1][1]).toBeCloseTo(0.0022868332051463112, 12)
  })

  it('replays the independently computed DCA path period by period (seed 42)', () => {
    const path = runOnePath(
      buildConfig({ cashFlow: { mode: 'dca', amount: 100 } }),
    )

    // Per-period joint returns from the Python trace.
    const expectedReturns = [
      [0.034871459543771036, 0.02360799422732326],
      [0.020396856205486747, 0.014905983837129246],
      [0.018873478406422957, 0.012686106843881871],
      [0.004400779730561249, 0.005181594738179881],
    ]
    for (let period = 0; period < 4; period += 1) {
      expect(path.scenarios[period].assetReturns[0]).toBeCloseTo(
        expectedReturns[period][0],
        12,
      )
      expect(path.scenarios[period].assetReturns[1]).toBeCloseTo(
        expectedReturns[period][1],
        12,
      )
      expect(path.scenarios[period].sourceRowIndex).toBeNull()
    }

    // Per-period equity through the unchanged Phase 1 accounting.
    const expectedEquity = [
      1000, 1130.366073417192, 1250.9541524408958, 1371.4941900675572,
      1477.953376622584,
    ]
    for (let period = 0; period <= 4; period += 1) {
      expect(path.values[period]).toBeCloseTo(expectedEquity[period], 8)
    }
  })

  it('replays the independently computed lump-sum path period by period (seed 7)', () => {
    const path = runOnePath(buildConfig({ seed: 7 }))

    const expectedEquity = [
      1000, 984.8585862957486, 1002.3067734047772, 1011.7298048510174,
      1063.7255066692878,
    ]
    for (let period = 0; period <= 4; period += 1) {
      expect(path.values[period]).toBeCloseTo(expectedEquity[period], 8)
    }
  })
})
