import { describe, expect, it } from 'vitest'
import type { AlignedDataset } from '../data/datasetTypes'
import { runSimulation } from './runSimulation'
import type { SimulationEngine } from './simulationEngine'
import type { PeriodScenario, SimulationConfig } from './simulationTypes'

// Phase 4.2 integration: metrics, contributions, and price levels computed
// streaming inside the runner's path loop. A scripted fake engine (fixed
// scenario sequence) makes every expected number reproducible by hand,
// independent of any PRNG draw order.

function singleAssetDataset(): AlignedDataset {
  return {
    identity: {
      version: 'metrics-fixture-v1',
      checksum: 'metrics-fixture-checksum',
      frequency: 'weekly',
      baseCurrency: 'USD',
    },
    assetIds: ['ONLY'],
    dates: ['2024-01-05', '2024-01-12', '2024-01-19', '2024-01-26'],
    assetReturns: [new Float32Array([0.01, 0.02, 0.03, 0.04])],
    inflation: new Float32Array([0, 0, 0, 0]),
    riskFreeRates: new Float32Array([0, 0, 0, 0]),
  }
}

// Replays a fixed scenario list in order — the engine contract's minimal
// deterministic implementation. The runner never knows the difference.
function scriptedEngine(
  scenarios: readonly PeriodScenario[],
): SimulationEngine {
  let next = 0
  return {
    nextScenario() {
      const scenario = scenarios[next % scenarios.length]
      next += 1
      return scenario
    },
  }
}

function scenario(
  assetReturn: number,
  inflation: number,
  riskFreeRate: number,
): PeriodScenario {
  return {
    assetReturns: [assetReturn],
    inflation,
    riskFreeRate,
    sourceRowIndex: null,
  }
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    weights: [1],
    initialInvestment: 1000,
    cashFlow: { mode: 'lumpSum' },
    paths: 1,
    periods: 3,
    seed: 0,
    ...overrides,
  }
}

function run(
  engine: SimulationEngine,
  simulationConfig: SimulationConfig,
  dataset = singleAssetDataset(),
) {
  const result = runSimulation({
    engine,
    dataset,
    config: simulationConfig,
    modelVersion: 'scripted-test-engine',
    prngVersion: 'none',
  })
  if (!result.ok) throw new Error('expected a successful run')
  return result.value
}

describe('runSimulation — streaming metrics (Phase 4.2)', () => {
  it('computes CAGR, volatility, Sharpe, and drawdown for a hand-checked lump-sum path', () => {
    // Returns +10%, -5%, +2% against a constant 1% risk-free rate and a
    // constant 0.01 log-inflation increment per period.
    const engine = scriptedEngine([
      scenario(0.1, 0.01, 0.01),
      scenario(-0.05, 0.01, 0.01),
      scenario(0.02, 0.01, 0.01),
    ])
    const result = run(engine, config())

    // Equity: 1000 -> 1100 -> 1045 -> 1065.9. Lump sum: contribution-neutral
    // returns ARE the raw returns, so the metrics match metrics.test.ts's
    // hand-checked accumulator values exactly.
    expect(result.terminalWealth[0]).toBeCloseTo(1065.9, 8)

    expect(result.metrics.growth.kind).toBe('cagr')
    // 3 weekly periods = 3/52 years: (1.0659)^(52/3) - 1.
    expect(result.metrics.growth.summary?.p50).toBeCloseTo(
      1.0659 ** (52 / 3) - 1,
      8,
    )

    const mean = (0.1 - 0.05 + 0.02) / 3
    const variance =
      ((0.1 - mean) ** 2 + (-0.05 - mean) ** 2 + (0.02 - mean) ** 2) / 2
    expect(result.metrics.annualizedVolatility?.p50).toBeCloseTo(
      Math.sqrt(variance) * Math.sqrt(52),
      10,
    )
    const excessMean = (0.09 - 0.06 + 0.01) / 3
    expect(result.metrics.sharpeRatio?.p50).toBeCloseTo(
      (excessMean / Math.sqrt(variance)) * Math.sqrt(52),
      10,
    )
    // Unitized index trough: 5% below the post-period-1 peak.
    expect(result.metrics.maxDrawdown?.p50).toBeCloseTo(0.05, 10)

    // With one path, the metric distribution collapses to that path's value
    // and the honest denominator is 1.
    expect(result.metrics.annualizedVolatility?.availablePathCount).toBe(1)

    // Terminal wealth ended above the 1000 paid in: no loss, no ruin.
    expect(result.metrics.lossProbability).toBe(0)
    expect(result.metrics.ruinProbability).toBe(0)
    expect(result.metrics.terminalWealth?.p50).toBeCloseTo(1065.9, 8)

    // Price levels compound the LOG increments: P_t = exp(0.01 t), on both
    // the retained path (float64) and the representative copy (float32
    // transport precision).
    const retained = result.retainedPaths[0]
    expect(retained.priceLevels[0]).toBe(1)
    expect(retained.priceLevels[3]).toBeCloseTo(Math.exp(0.03), 12)
    const representative = result.representativePaths[0]
    expect(representative.priceLevels[3]).toBeCloseTo(Math.exp(0.03), 5)

    // A lump-sum path never schedules a contribution.
    expect(Array.from(retained.contributions)).toEqual([0, 0, 0, 0])
  })

  it('computes the money-weighted IRR for a hand-checked DCA schedule', () => {
    // Two periods, 0% then +5%, DCA of 100 on a 100 initial investment:
    // equity 100 -> 200 (100*1.0 + 100) -> 310 (200*1.05 + 100).
    // Investor flows: [-100, -100, 310 - 100] = [-100, -100, +210], whose
    // single admissible periodic root has the closed form
    // x = (100 + sqrt(94000)) / 420 in x = 1/(1+r) (see metrics.test.ts).
    const engine = scriptedEngine([scenario(0, 0, 0), scenario(0.05, 0, 0)])
    const result = run(
      engine,
      config({
        initialInvestment: 100,
        cashFlow: { mode: 'dca', amount: 100 },
        periods: 2,
      }),
    )

    expect(result.terminalWealth[0]).toBeCloseTo(310, 10)
    expect(result.metrics.growth.kind).toBe('irr')
    const x = (100 + Math.sqrt(94_000)) / 420
    const periodicRate = 1 / x - 1
    expect(result.metrics.growth.summary?.p50).toBeCloseTo(
      (1 + periodicRate) ** 52 - 1,
      8,
    )

    // The retained path records the actual external flow per period.
    expect(Array.from(result.retainedPaths[0].contributions)).toEqual([
      0, 100, 100,
    ])
    // Paid in 300 total, ended at 310: not a loss.
    expect(result.metrics.lossProbability).toBe(0)
  })

  it('counts a path that ends below its own paid-in capital as a loss', () => {
    // -50% twice: 1000 -> 500 -> 250, far below the 1000 paid in.
    const engine = scriptedEngine([scenario(-0.5, 0, 0)])
    const result = run(engine, config({ periods: 2 }))
    expect(result.metrics.lossProbability).toBe(1)
    // A deep loss is still a completed, solvent path — not ruin.
    expect(result.metrics.ruinProbability).toBe(0)
  })

  it('reports null metric summaries, full loss, and full ruin when every path fails', () => {
    // A defective engine producing a non-finite return at period 2 — the
    // same explicit-failure contract runSimulation.test.ts already proves
    // for equity buffers, now checked for the metrics layer.
    const engine = scriptedEngine([
      scenario(0.01, 0.001, 0),
      scenario(Number.POSITIVE_INFINITY, 0.001, 0),
    ])
    const result = run(engine, config({ periods: 3 }))

    expect(result.failures).toHaveLength(1)
    expect(result.metrics.terminalWealth).toBeNull()
    expect(result.metrics.growth.summary).toBeNull()
    expect(result.metrics.annualizedVolatility).toBeNull()
    expect(result.metrics.sharpeRatio).toBeNull()
    expect(result.metrics.maxDrawdown).toBeNull()
    expect(result.metrics.lossProbability).toBe(1)
    expect(result.metrics.ruinProbability).toBe(1)

    // Post-failure periods are NaN ("stopped simulating"), never 0 or a
    // stale price level, in every retained series.
    const retained = result.retainedPaths[0]
    expect(Number.isNaN(retained.contributions[2])).toBe(true)
    expect(Number.isNaN(retained.priceLevels[2])).toBe(true)
    expect(Number.isNaN(retained.priceLevels[3])).toBe(true)
  })
})
