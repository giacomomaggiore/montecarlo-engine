import { describe, expect, it } from 'vitest'
import {
  applyExecutedTrades,
  createContributionTrades,
  fundRebalanceBuys,
  priceTrades,
} from './transactionCosts'

const costs = { fixedPerOrder: 2, proportionalRate: 0.01 }

describe('transaction-cost ledger', () => {
  it('splits a gross contribution between target-weight buys and their fees', () => {
    const trades = createContributionTrades(105, [0.6, 0.4], costs)
    if (!trades.ok) throw new Error('expected feasible contribution')

    // C = B + 2 * $2 + 1% * B, so B = 100. The two orders are 60/40.
    expect(trades.value).toEqual([
      { assetIndex: 0, value: 60 },
      { assetIndex: 1, value: 40 },
    ])
    const priced = priceTrades(trades.value, costs)
    expect(priced.buyCosts).toBeCloseTo(5)
    expect(priced.grossBuys + priced.buyCosts).toBeCloseTo(105)
  })

  it('omits zero orders and leaves a zero contribution untraded', () => {
    expect(createContributionTrades(0, [1, 0], costs)).toEqual({
      ok: true,
      value: [],
    })
    expect(priceTrades([{ assetIndex: 0, value: 0 }], costs)).toEqual({
      trades: [],
      buyCosts: 0,
      sellCosts: 0,
      grossBuys: 0,
      grossSells: 0,
    })
  })

  it('rejects a contribution that cannot pay its required fixed order costs', () => {
    const result = createContributionTrades(4, [0.5, 0.5], costs)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].code).toBe(
        'transactionCosts.contribution.infeasible',
      )
    }
  })

  it('scales rebalancing buys to the cash available after sales', () => {
    const funded = fundRebalanceBuys(
      [
        { assetIndex: 0, value: 80 },
        { assetIndex: 1, value: 120 },
      ],
      200,
      costs,
    )
    if (!funded.ok) throw new Error('expected feasible rebalance')

    // Available cash buys B = (200 - 2 * $2) / 1.01 = 194.0594..., so the
    // original 80/120 buy intent is scaled by B / 200.
    expect(funded.value[0].value).toBeCloseTo(77.623762376)
    expect(funded.value[1].value).toBeCloseTo(116.435643564)
    const priced = priceTrades(funded.value, costs)
    expect(priced.grossBuys + priced.buyCosts).toBeCloseTo(200)
  })

  it('rejects invalid post-trade holdings instead of silently clipping them', () => {
    const result = applyExecutedTrades(
      [100],
      [{ assetIndex: 0, value: -101, transactionCost: 0 }],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].code).toBe('transactionCosts.holdings.invalid')
    }
  })
})
