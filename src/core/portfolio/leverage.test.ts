import { describe, expect, it } from 'vitest'
import {
  accrueDebt,
  createProportionalSaleTrades,
  createTargetWeightBuyTrades,
  initializeLeveragedPortfolio,
  isLeverageResetDue,
  requiresMarginCall,
  snapshotLeverage,
} from './leverage'

describe('leverage accounting primitives', () => {
  it('opens a 2x portfolio from investor equity and debt', () => {
    const opening = initializeLeveragedPortfolio(100, [0.6, 0.4], {
      mode: 'enabled',
      targetGrossExposure: 2,
      maintenanceMargin: 0.25,
      annualBorrowingSpread: 0,
      reset: { mode: 'none' },
    })
    expect(opening.holdings).toEqual([120, 80])
    expect(opening.debt).toBe(100)
  })

  it('accrues weekly debt interest before later accounting', () => {
    const accrued = accrueDebt(100, 0.001, 0.052)
    expect(accrued.ok).toBe(true)
    if (accrued.ok) {
      expect(accrued.value.debt).toBeCloseTo(
        100 * (1 + 0.001 + (1.052 ** (1 / 52) - 1)),
      )
    }
  })

  it('calls strictly below the maintenance boundary, not at it', () => {
    expect(requiresMarginCall(snapshotLeverage([200], 150), 0.25)).toBe(false)
    expect(requiresMarginCall(snapshotLeverage([200], 151), 0.25)).toBe(true)
  })

  it('uses strict reset bands and proportional trade intents', () => {
    expect(
      isLeverageResetDue(
        { mode: 'toleranceBand', percentagePoints: 10 },
        1,
        2.1,
        2,
      ),
    ).toBe(false)
    expect(
      isLeverageResetDue(
        { mode: 'toleranceBand', percentagePoints: 10 },
        1,
        2.101,
        2,
      ),
    ).toBe(true)
    expect(createProportionalSaleTrades([120, 80], 0.25)).toEqual([
      { assetIndex: 0, value: -30 },
      { assetIndex: 1, value: -20 },
    ])
    expect(createTargetWeightBuyTrades([0.6, 0.4], 50)).toEqual([
      { assetIndex: 0, value: 30 },
      { assetIndex: 1, value: 20 },
    ])
  })
})
