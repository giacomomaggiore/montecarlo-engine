import { describe, expect, it } from 'vitest'
import type { AlignedDataset } from '../data/datasetTypes'
import {
  createParametricStudentTEngine,
  fitParametricStudentT,
  PARAMETRIC_STUDENT_T_MODEL_VERSION,
  type ParametricStudentTModel,
  type ParametricStudentTOptions,
} from './parametricStudentT'

// Small deterministic fixture, same convention as historicalBootstrap.test:
// construction-level tests need not meet the 260-row production minimum
// because dataset validation is owned (and already tested) by Phase 1.1.
const ASSET_A_RETURNS = [0.02, -0.05, 0.03, 0.01, -0.02, 0.04, -0.01, 0.02]
const ASSET_B_RETURNS = [0.01, -0.03, 0.02, 0.005, -0.01, 0.03, -0.005, 0.015]

function buildFixtureDataset(
  overrides: Partial<AlignedDataset> = {},
): AlignedDataset {
  return {
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
    ...overrides,
  }
}

const DEMO_OPTIONS: ParametricStudentTOptions = {
  annualInflation: 0.02,
  annualRiskFreeRate: 0.03,
}

// Expected values below were computed independently with NumPy against the
// same Float32-rounded fixture (see the Phase 3 LOG entry): log-return
// means, ddof=1 covariance, pooled moment-ratio kurtosis, and the Cholesky
// factor of Sigma * (nu - 2) / nu.

describe('fitParametricStudentT', () => {
  it('fits location, nu, and the Cholesky factor to NumPy-checked values', () => {
    const fit = fitParametricStudentT(buildFixtureDataset(), DEMO_OPTIONS)

    expect(fit.ok).toBe(true)
    if (!fit.ok) return
    const model = fit.value

    expect(model.location[0]).toBeCloseTo(0.004598595071362008, 12)
    expect(model.location[1]).toBeCloseTo(0.004208228563899337, 12)

    // This smooth eight-row fixture has thinner-than-Gaussian pooled tails
    // (gamma_2 = -0.5227...), so the estimator returns the nu = 100 ceiling.
    expect(model.diagnostics.pooledExcessKurtosis).toBeCloseTo(
      -0.5227070130492946,
      10,
    )
    expect(model.degreesOfFreedom).toBe(100)

    // Cholesky of S = Sigma * 98/100 (NumPy reference values).
    expect(model.choleskyFactor[0][0]).toBeCloseTo(0.02961887170217289, 10)
    expect(model.choleskyFactor[1][0]).toBeCloseTo(0.01865692756121025, 10)
    expect(model.choleskyFactor[1][1]).toBeCloseTo(0.0022868332051462835, 10)

    // The fixture's correlation is already positive definite, so Higham
    // repair must report itself dormant.
    expect(model.diagnostics.correlationWasRepaired).toBe(false)

    // Annual constants converted to per-period, unit-matched to the dataset
    // columns: inflation as ln(1.02)/52 (log increment), risk-free as
    // 1.03^(1/52) - 1 (effective simple rate).
    expect(model.periodInflation).toBeCloseTo(0.000380819755695764, 14)
    expect(model.periodRiskFreeRate).toBeCloseTo(0.000568600096428673, 14)
  })

  it('applies user-entered annual geometric returns without reshaping covariance', () => {
    const fit = fitParametricStudentT(buildFixtureDataset(), {
      ...DEMO_OPTIONS,
      annualGeometricReturns: [0.07, 0.03],
    })

    expect(fit.ok).toBe(true)
    if (!fit.ok) return

    // mu = ln(1 + g) / 52.
    expect(fit.value.location[0]).toBeCloseTo(0.0013011278552656704, 14)
    expect(fit.value.location[1]).toBeCloseTo(Math.log(1.03) / 52, 14)
    // Covariance (and therefore the factor) is untouched by the override.
    expect(fit.value.choleskyFactor[0][0]).toBeCloseTo(0.02961887170217289, 10)
  })

  it('accepts a manual degrees-of-freedom override and rescales the factor', () => {
    const fit = fitParametricStudentT(buildFixtureDataset(), {
      ...DEMO_OPTIONS,
      degreesOfFreedom: 10,
    })

    expect(fit.ok).toBe(true)
    if (!fit.ok) return
    expect(fit.value.degreesOfFreedom).toBe(10)

    // S scales by (nu-2)/nu, so L scales by sqrt((8/10) / (98/100))
    // relative to the automatic nu = 100 fit.
    const rescale = Math.sqrt(0.8 / 0.98)
    expect(fit.value.choleskyFactor[0][0]).toBeCloseTo(
      0.02961887170217289 * rescale,
      10,
    )
  })

  it('rejects invalid options with structured errors', () => {
    const dataset = buildFixtureDataset()

    const badInflation = fitParametricStudentT(dataset, {
      ...DEMO_OPTIONS,
      annualInflation: -1,
    })
    expect(badInflation.ok).toBe(false)
    if (!badInflation.ok) {
      expect(badInflation.errors[0].code).toBe(
        'parametric.options.annualInflation',
      )
    }

    const badOverrideCount = fitParametricStudentT(dataset, {
      ...DEMO_OPTIONS,
      annualGeometricReturns: [0.05],
    })
    expect(badOverrideCount.ok).toBe(false)
    if (!badOverrideCount.ok) {
      expect(badOverrideCount.errors[0].code).toBe(
        'parametric.options.annualGeometricReturns.count',
      )
    }

    const badNu = fitParametricStudentT(dataset, {
      ...DEMO_OPTIONS,
      degreesOfFreedom: 3,
    })
    expect(badNu.ok).toBe(false)
    if (!badNu.ok) {
      expect(badNu.errors[0].code).toBe('parametric.options.degreesOfFreedom')
    }
  })

  it('rejects a constant return series as unfittable', () => {
    const fit = fitParametricStudentT(
      buildFixtureDataset({
        assetReturns: [
          new Float32Array(ASSET_A_RETURNS),
          new Float32Array(ASSET_A_RETURNS.length).fill(0.01),
        ],
      }),
      DEMO_OPTIONS,
    )

    expect(fit.ok).toBe(false)
    if (fit.ok) return
    expect(fit.errors[0].code).toBe('parametric.fit.zeroVariance')
  })

  it('surfaces a Cholesky failure for perfectly collinear assets', () => {
    // Two identical columns: correlation exactly 1, which is PSD (so Higham
    // returns it unchanged) but singular -- the second Cholesky pivot is
    // exactly zero and must fail with a structured error, never NaN samples.
    const fit = fitParametricStudentT(
      buildFixtureDataset({
        assetReturns: [
          new Float32Array(ASSET_A_RETURNS),
          new Float32Array(ASSET_A_RETURNS),
        ],
      }),
      DEMO_OPTIONS,
    )

    expect(fit.ok).toBe(false)
    if (fit.ok) return
    expect(fit.errors[0].code).toBe('matrix.cholesky.notPositiveDefinite')
  })
})

describe('createParametricStudentTEngine', () => {
  function buildFittedModel(): ParametricStudentTModel {
    const fit = fitParametricStudentT(buildFixtureDataset(), DEMO_OPTIONS)
    if (!fit.ok) throw new Error('fixture fit must succeed')
    return fit.value
  }

  it('exports the versioned model identity', () => {
    expect(PARAMETRIC_STUDENT_T_MODEL_VERSION).toBe('parametric-student-t-v1')
  })

  it('reproduces the independent fixed-seed scenario trace', () => {
    // Expected values from the independent Python reimplementation of the
    // whole chain (xoshiro -> Box-Muller -> Marsaglia-Tsang -> t draw ->
    // expm1), seed 42 against the NumPy-fitted fixture model.
    const engine = createParametricStudentTEngine(buildFittedModel(), 42)

    const expected = [
      [0.034871459543771036, 0.023607994227323254],
      [0.020396856205486747, 0.014905983837129239],
      [0.018873478406422957, 0.01268610684388188],
    ]

    for (const [returnA, returnB] of expected) {
      const scenario = engine.nextScenario()
      expect(scenario.assetReturns[0]).toBeCloseTo(returnA, 10)
      expect(scenario.assetReturns[1]).toBeCloseTo(returnB, 10)
      expect(scenario.sourceRowIndex).toBeNull()
    }
  })

  it('returns the constant per-period inflation and risk-free rate', () => {
    const model = buildFittedModel()
    const scenario = createParametricStudentTEngine(model, 1).nextScenario()

    expect(scenario.inflation).toBe(model.periodInflation)
    expect(scenario.riskFreeRate).toBe(model.periodRiskFreeRate)
  })

  it('is reproducible for the same seed and diverges for different seeds', () => {
    const model = buildFittedModel()
    const first = createParametricStudentTEngine(model, 2024)
    const second = createParametricStudentTEngine(model, 2024)
    const different = createParametricStudentTEngine(model, 2025)

    let diverged = false
    for (let draw = 0; draw < 50; draw += 1) {
      const a = first.nextScenario()
      const b = second.nextScenario()
      expect(b.assetReturns).toEqual(a.assetReturns)
      if (different.nextScenario().assetReturns[0] !== a.assetReturns[0]) {
        diverged = true
      }
    }
    expect(diverged).toBe(true)
  })

  it('returns a fresh assetReturns array on every call', () => {
    const engine = createParametricStudentTEngine(buildFittedModel(), 9)
    const first = engine.nextScenario()
    const second = engine.nextScenario()

    expect(first.assetReturns).not.toBe(second.assetReturns)
  })

  it('generates samples matching the fitted correlation and location', () => {
    // A hand-built model (not a fit): unit-free check that the sampling rule
    // itself produces the promised joint behavior. L = [[0.02, 0],
    // [0.012, 0.016]] gives scale correlation 0.6; with nu = 100 the t is
    // near-Gaussian, so sample statistics should sit close to the targets.
    const model: ParametricStudentTModel = {
      location: [0.001, 0.002],
      choleskyFactor: [
        [0.02, 0],
        [0.012, 0.016],
      ],
      degreesOfFreedom: 100,
      periodInflation: 0,
      periodRiskFreeRate: 0,
      diagnostics: { pooledExcessKurtosis: 0, correlationWasRepaired: false },
    }
    const engine = createParametricStudentTEngine(model, 4242)
    const sampleSize = 20_000

    let sumA = 0
    let sumB = 0
    let sumAA = 0
    let sumBB = 0
    let sumAB = 0
    for (let draw = 0; draw < sampleSize; draw += 1) {
      const scenario = engine.nextScenario()
      // Invert back to log returns, the space the model is defined in.
      const logA = Math.log1p(scenario.assetReturns[0])
      const logB = Math.log1p(scenario.assetReturns[1])
      sumA += logA
      sumB += logB
      sumAA += logA * logA
      sumBB += logB * logB
      sumAB += logA * logB
    }

    const meanA = sumA / sampleSize
    const meanB = sumB / sampleSize
    const varianceA = sumAA / sampleSize - meanA * meanA
    const varianceB = sumBB / sampleSize - meanB * meanB
    const covariance = sumAB / sampleSize - meanA * meanB
    const correlation = covariance / Math.sqrt(varianceA * varianceB)

    // Predeclared tolerances (~4 standard errors at n = 20,000).
    expect(Math.abs(meanA - 0.001)).toBeLessThan(0.0006)
    expect(Math.abs(meanB - 0.002)).toBeLessThan(0.0006)
    expect(Math.abs(correlation - 0.6)).toBeLessThan(0.03)
  })

  it('produces fatter tails at nu = 5 than at nu = 100', () => {
    // The fat-tail claim, measured rather than asserted: the same Gaussian
    // body scaled by sqrt(nu/chi2) must show much higher standardized
    // fourth moments when nu is small.
    function measuredExcessKurtosis(degreesOfFreedom: number): number {
      const model: ParametricStudentTModel = {
        location: [0],
        choleskyFactor: [[0.02]],
        degreesOfFreedom,
        periodInflation: 0,
        periodRiskFreeRate: 0,
        diagnostics: {
          pooledExcessKurtosis: 0,
          correlationWasRepaired: false,
        },
      }
      const engine = createParametricStudentTEngine(model, 314159)
      const sampleSize = 50_000

      const values: number[] = []
      for (let draw = 0; draw < sampleSize; draw += 1) {
        values.push(Math.log1p(engine.nextScenario().assetReturns[0]))
      }
      const mean =
        values.reduce((total, value) => total + value, 0) / sampleSize
      let secondMoment = 0
      let fourthMoment = 0
      for (const value of values) {
        const squared = (value - mean) * (value - mean)
        secondMoment += squared
        fourthMoment += squared * squared
      }
      secondMoment /= sampleSize
      fourthMoment /= sampleSize
      return fourthMoment / (secondMoment * secondMoment) - 3
    }

    const heavyTails = measuredExcessKurtosis(5)
    const nearGaussian = measuredExcessKurtosis(100)

    // t(5) has population excess kurtosis 6; t(100) has ~0.06. Sample
    // kurtosis of a heavy-tailed distribution is itself noisy, so the
    // assertions are deliberately coarse: clearly positive, and clearly
    // ordered.
    expect(heavyTails).toBeGreaterThan(1)
    expect(nearGaussian).toBeLessThan(0.5)
    expect(heavyTails).toBeGreaterThan(nearGaussian + 1)
  })
})
