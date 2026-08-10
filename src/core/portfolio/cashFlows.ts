import type {
  CashFlowConfig,
  PeriodScenario,
} from '../simulation/simulationTypes'

// One period's outcome: holdings after return and contribution, the contribution
// itself, total equity, and the return caused by markets alone (before the contribution).
export type PortfolioPeriodResult = {
  readonly holdings: readonly number[]
  readonly contribution: number
  readonly equity: number
  readonly neutralReturn: number
}

// Split the initial lump sum across assets at target weights. This is the only
// place the initial investment is allocated; later contributions reuse the same rule.
export function allocateInitialInvestment(
  initialInvestment: number,
  weights: readonly number[],
): number[] {
  return weights.map((weight) => initialInvestment * weight)
}

// Grow each asset's holding by its own simple return. No cross-asset interaction.
export function applyPeriodReturn(
  holdings: readonly number[],
  assetReturns: readonly number[],
): number[] {
  return holdings.map((holding, index) => holding * (1 + assetReturns[index]))
}

// Decide how much new external cash enters this period, before it is invested.
export function computeScheduledContribution(
  cashFlow: CashFlowConfig,
  periodIndex: number,
  initialInvestment: number,
  preContributionEquity: number,
): number {
  switch (cashFlow.mode) {
    case 'lumpSum':
      return 0
    case 'dca':
      return cashFlow.amount
    case 'valueAveraging': {
      // Target path A_t = A_0 + t * targetIncrease. Only top up the shortfall,
      // never withdraw when equity is already above the target.
      const targetValue =
        initialInvestment + periodIndex * cashFlow.targetIncrease
      return Math.max(0, targetValue - preContributionEquity)
    }
  }
}

// Spend the whole contribution at target weights. Existing holdings are left
// untouched, so weight drift from prior returns is never corrected here.
export function investContribution(
  holdings: readonly number[],
  weights: readonly number[],
  contribution: number,
): number[] {
  return holdings.map(
    (holding, index) => holding + weights[index] * contribution,
  )
}

// Apply one full period to the portfolio: return, then scheduled contribution.
// This is the only ordering the README allows: a contribution never earns the
// return of the period in which it arrives.
export function stepPortfolioPeriod(
  holdings: readonly number[],
  scenario: PeriodScenario,
  cashFlow: CashFlowConfig,
  weights: readonly number[],
  periodIndex: number,
  initialInvestment: number,
): PortfolioPeriodResult {
  const startEquity = sum(holdings)

  const grownHoldings = applyPeriodReturn(holdings, scenario.assetReturns)
  const preContributionEquity = sum(grownHoldings)

  const contribution = computeScheduledContribution(
    cashFlow,
    periodIndex,
    initialInvestment,
    preContributionEquity,
  )
  const finalHoldings = investContribution(grownHoldings, weights, contribution)

  return {
    holdings: finalHoldings,
    contribution,
    equity: sum(finalHoldings),
    neutralReturn: preContributionEquity / startEquity - 1,
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
