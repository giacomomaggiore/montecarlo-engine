import { describe, expect, it } from 'vitest'
import type { PeriodScenario } from '../simulation/simulationTypes'
import {
  allocateInitialInvestment,
  computeScheduledContribution,
  investContribution,
  stepPortfolioPeriod,
} from './cashFlows'

function scenario(assetReturns: readonly number[]): PeriodScenario {
  return { assetReturns, inflation: 0, riskFreeRate: 0, sourceRowIndex: 0 }
}

describe('allocateInitialInvestment', () => {
  it('splits the lump sum across assets at target weights', () => {
    expect(allocateInitialInvestment(1000, [0.6, 0.4])).toEqual([600, 400])
  })
})

describe('stepPortfolioPeriod', () => {
  it('compounds a single asset with a lump-sum contribution', () => {
    const holdings = [1000]
    const result = stepPortfolioPeriod(
      holdings,
      scenario([0.1]),
      { mode: 'lumpSum' },
      [1],
      1,
      1000,
    )

    // 1000 * 1.1 = 1100, no external cash for a lump sum
    expect(result.holdings).toEqual([1100])
    expect(result.contribution).toBe(0)
    expect(result.equity).toBe(1100)
    expect(result.neutralReturn).toBeCloseTo(0.1)
  })

  it('hand-calculates a two-asset period with different returns', () => {
    const holdings = [600, 400]
    const result = stepPortfolioPeriod(
      holdings,
      scenario([0.1, -0.05]),
      { mode: 'lumpSum' },
      [0.6, 0.4],
      1,
      1000,
    )

    // 600 * 1.1 = 660, 400 * 0.95 = 380, total 1040 vs start 1000
    expect(result.holdings).toEqual([660, 380])
    expect(result.equity).toBe(1040)
    expect(result.neutralReturn).toBeCloseTo(0.04)
  })

  it('adds the DCA contribution after the period return, so it earns no return that period', () => {
    const holdings = [1000]
    const result = stepPortfolioPeriod(
      holdings,
      scenario([0.1]),
      { mode: 'dca', amount: 100 },
      [1],
      1,
      1000,
    )

    // Return grows holdings to 1100, then the full 100 contribution is added untouched
    expect(result.holdings).toEqual([1200])
    expect(result.contribution).toBe(100)
    expect(result.equity).toBe(1200)
  })

  it('drifts holdings away from target weights when only contributions are rebalanced', () => {
    let holdings: readonly number[] = allocateInitialInvestment(
      1000,
      [0.5, 0.5],
    )

    // Asset 0 always gains, asset 1 always loses; no rebalancing of existing holdings
    for (let period = 1; period <= 3; period += 1) {
      const result = stepPortfolioPeriod(
        holdings,
        scenario([0.1, -0.1]),
        { mode: 'lumpSum' },
        [0.5, 0.5],
        period,
        1000,
      )
      holdings = result.holdings
    }

    const [assetZero, assetOne] = holdings
    const totalEquity = assetZero + assetOne
    expect(assetZero / totalEquity).toBeGreaterThan(0.5)
    expect(assetOne / totalEquity).toBeLessThan(0.5)
  })

  it('never withdraws for value averaging once equity already exceeds the target', () => {
    const holdings = [2000]
    const contribution = computeScheduledContribution(
      { mode: 'valueAveraging', targetIncrease: 100 },
      1,
      1000,
      2000,
    )

    // Target at t=1 is 1100, equity is already 2000, so the shortfall is negative -> clamp to 0
    expect(contribution).toBe(0)

    const result = stepPortfolioPeriod(
      holdings,
      scenario([0]),
      { mode: 'valueAveraging', targetIncrease: 100 },
      [1],
      1,
      1000,
    )
    expect(result.contribution).toBe(0)
    expect(result.equity).toBe(2000)
  })

  it('tops up exactly the shortfall for value averaging when equity is below target', () => {
    const contribution = computeScheduledContribution(
      { mode: 'valueAveraging', targetIncrease: 100 },
      2,
      1000,
      1150,
    )

    // Target at t=2 is 1000 + 2*100 = 1200, equity is 1150, shortfall is 50
    expect(contribution).toBe(50)
  })

  it('conserves value: equity equals start equity times (1 + neutral return) plus contribution', () => {
    const holdings = [700, 300]
    const result = stepPortfolioPeriod(
      holdings,
      scenario([0.03, -0.02]),
      { mode: 'dca', amount: 50 },
      [0.7, 0.3],
      1,
      1000,
    )

    const startEquity = 1000
    expect(result.equity).toBeCloseTo(
      startEquity * (1 + result.neutralReturn) + result.contribution,
    )
  })
})

describe('investContribution', () => {
  it('spends the whole contribution at target weights without touching existing holdings', () => {
    expect(investContribution([660, 380], [0.6, 0.4], 100)).toEqual([720, 420])
  })
})
