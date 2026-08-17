import type {
  LeverageConfig,
  LeverageResetConfig,
} from '../simulation/simulationTypes'
import type { ValidationResult } from '../validation'
import type { PortfolioTrade } from './rebalancing'

export const LEVERAGE_TOLERANCE = 1e-10

export type LeverageSnapshot = {
  readonly grossAssets: number
  readonly debt: number
  readonly equity: number
  readonly grossLeverage: number | null
  readonly maintenanceMargin: number | null
}

// Financial intuition: leverage buys more assets than investor equity by
// borrowing the difference; the opening tax basis is the full asset purchase.
export function initializeLeveragedPortfolio(
  initialInvestment: number,
  weights: readonly number[],
  leverage: LeverageConfig | undefined,
): { readonly holdings: readonly number[]; readonly debt: number } {
  const targetGrossExposure =
    leverage?.mode === 'enabled' ? leverage.targetGrossExposure : 1
  const grossAssets = initialInvestment * targetGrossExposure
  return {
    holdings: weights.map((weight) => grossAssets * weight),
    debt: grossAssets - initialInvestment,
  }
}

// Financial intuition: debt compounds at the sampled base short rate plus
// the lender spread, before the period's investor contribution can help it.
export function accrueDebt(
  debt: number,
  riskFreeRate: number,
  annualBorrowingSpread: number,
): ValidationResult<{
  readonly debt: number
  readonly borrowingInterest: number
}> {
  const periodicSpread = (1 + annualBorrowingSpread) ** (1 / 52) - 1
  const borrowingRate = riskFreeRate + periodicSpread
  const nextDebt = debt * (1 + borrowingRate)
  if (
    !Number.isFinite(debt) ||
    debt < 0 ||
    !Number.isFinite(riskFreeRate) ||
    !Number.isFinite(periodicSpread) ||
    borrowingRate <= -1 ||
    !Number.isFinite(nextDebt) ||
    nextDebt < 0
  ) {
    return {
      ok: false,
      errors: [
        {
          code: 'leverage.debt.invalid',
          message: 'Borrowing interest produced an invalid debt balance.',
        },
      ],
    }
  }
  return {
    ok: true,
    value: { debt: nextDebt, borrowingInterest: nextDebt - debt },
  }
}

export function snapshotLeverage(
  holdings: readonly number[],
  debt: number,
): LeverageSnapshot {
  const grossAssets = holdings.reduce((total, holding) => total + holding, 0)
  const equity = grossAssets - debt
  return {
    grossAssets,
    debt,
    equity,
    grossLeverage: grossAssets > 0 && equity > 0 ? grossAssets / equity : null,
    maintenanceMargin:
      grossAssets > 0 && equity > 0 ? equity / grossAssets : null,
  }
}

export function requiresMarginCall(
  snapshot: LeverageSnapshot,
  maintenanceMargin: number,
): boolean {
  return (
    snapshot.equity <= 0 ||
    snapshot.maintenanceMargin === null ||
    snapshot.maintenanceMargin < maintenanceMargin
  )
}

export function isLeverageResetDue(
  reset: LeverageResetConfig,
  periodIndex: number,
  grossLeverage: number | null,
  targetGrossExposure: number,
): boolean {
  if (reset.mode === 'none') return false
  if (reset.mode === 'time') {
    return periodIndex > 0 && periodIndex % reset.everyPeriods === 0
  }
  return (
    grossLeverage !== null &&
    Math.abs(grossLeverage - targetGrossExposure) >
      reset.percentagePoints / 100 + LEVERAGE_TOLERANCE
  )
}

// Time complexity O(D), space complexity O(D), where D <= 6 assets.
// A proportional sale preserves the current asset mix during a margin call.
export function createProportionalSaleTrades(
  holdings: readonly number[],
  fraction: number,
): readonly PortfolioTrade[] {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) return []
  return holdings.flatMap((holding, assetIndex) => {
    const value = -holding * fraction
    return Math.abs(value) > LEVERAGE_TOLERANCE ? [{ assetIndex, value }] : []
  })
}

// Borrowed cash purchases target weights, preserving the configured mix when
// voluntary leverage is reset upward after the portfolio has drifted.
export function createTargetWeightBuyTrades(
  weights: readonly number[],
  grossPurchaseValue: number,
): readonly PortfolioTrade[] {
  if (!(grossPurchaseValue > 0) || !Number.isFinite(grossPurchaseValue)) {
    return []
  }
  return weights.flatMap((weight, assetIndex) =>
    weight > 0 ? [{ assetIndex, value: weight * grossPurchaseValue }] : [],
  )
}
