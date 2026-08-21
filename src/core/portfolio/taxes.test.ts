import { describe, expect, it } from 'vitest'
import {
  applyTaxableBuys,
  applyTaxableSales,
  initializeTaxState,
} from './taxes'

describe('average-basis taxes', () => {
  it('uses the initial investment as basis', () => {
    expect(initializeTaxState(1_000, [0.6, 0.4])).toEqual({
      costBases: [600, 400],
      lossCarryforward: 0,
    })
  })

  it('adds the gross buy and its fee to average cost basis', () => {
    const state = applyTaxableBuys({ costBases: [100], lossCarryforward: 0 }, [
      { assetIndex: 0, value: 50, transactionCost: 3 },
    ])
    expect(state).toEqual({ costBases: [153], lossCarryforward: 0 })
  })

  it('uses net sale proceeds and proportional basis for a partial sale', () => {
    const result = applyTaxableSales(
      { costBases: [100], lossCarryforward: 0 },
      [200],
      [{ assetIndex: 0, value: -50, transactionCost: 2 }],
      { capitalGainsRate: 0.2 },
    )
    if (!result.ok) throw new Error('expected valid sale')

    // 25% of a $200 holding disposes $25 basis. Net proceeds are $48, so
    // gain is $23 and immediate tax is 20% * $23 = $4.60.
    expect(result.value.disposedBasis).toBeCloseTo(25)
    expect(result.value.realizedGainLoss).toBeCloseTo(23)
    expect(result.value.taxPaid).toBeCloseTo(4.6)
    expect(result.value.state).toEqual({
      costBases: [75],
      lossCarryforward: 0,
    })
  })

  it('carries a loss across assets to offset a later gain without a refund', () => {
    const result = applyTaxableSales(
      { costBases: [100, 20], lossCarryforward: 0 },
      [50, 50],
      [
        { assetIndex: 0, value: -50, transactionCost: 0 },
        { assetIndex: 1, value: -50, transactionCost: 0 },
      ],
      { capitalGainsRate: 0.2 },
    )
    if (!result.ok) throw new Error('expected valid sales')

    // Asset 0 loses $50, then asset 1 gains $30. The gain uses $30 of the
    // carryforward, so tax remains zero and $20 loss stays available.
    expect(result.value.realizedGainLoss).toBeCloseTo(-20)
    expect(result.value.taxPaid).toBe(0)
    expect(result.value.state.lossCarryforward).toBeCloseTo(20)
  })

  it('rejects a sale that exceeds its available holding', () => {
    const result = applyTaxableSales(
      { costBases: [100], lossCarryforward: 0 },
      [50],
      [{ assetIndex: 0, value: -51, transactionCost: 0 }],
      undefined,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].code).toBe('tax.sale.invalid')
    }
  })
})
