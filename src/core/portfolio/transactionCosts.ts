import type { PortfolioTrade } from './rebalancing'
import type { TransactionCostConfig } from '../simulation/simulationTypes'
import type { ValidationResult } from '../validation'

export const ZERO_TRANSACTION_COSTS: TransactionCostConfig = {
  fixedPerOrder: 0,
  proportionalRate: 0,
}

export type ExecutedPortfolioTrade = PortfolioTrade & {
  readonly transactionCost: number
}

export type PricedTrades = {
  readonly trades: readonly ExecutedPortfolioTrade[]
  readonly buyCosts: number
  readonly sellCosts: number
  readonly grossBuys: number
  readonly grossSells: number
}

// Price every explicit nonzero order. Time O(D), space O(D), where D <= 6.
// Keeping the fee beside its order makes later tax accounting auditable.
export function priceTrades(
  trades: readonly PortfolioTrade[],
  transactionCosts: TransactionCostConfig | undefined,
): PricedTrades {
  const costs = transactionCosts ?? ZERO_TRANSACTION_COSTS
  const pricedTrades: ExecutedPortfolioTrade[] = []
  let buyCosts = 0
  let sellCosts = 0
  let grossBuys = 0
  let grossSells = 0

  for (const trade of trades) {
    if (trade.value === 0) continue

    const grossValue = Math.abs(trade.value)
    const transactionCost =
      costs.fixedPerOrder + costs.proportionalRate * grossValue
    const pricedTrade = { ...trade, transactionCost }
    pricedTrades.push(pricedTrade)

    if (trade.value > 0) {
      grossBuys += grossValue
      buyCosts += transactionCost
    } else {
      grossSells += grossValue
      sellCosts += transactionCost
    }
  }

  return {
    trades: pricedTrades,
    buyCosts,
    sellCosts,
    grossBuys,
    grossSells,
  }
}

// A contribution is gross investor cash. Solve C = B + n*f + p*B so every
// dollar becomes either an asset purchase or a clearly recorded order cost.
export function createContributionTrades(
  contribution: number,
  weights: readonly number[],
  transactionCosts: TransactionCostConfig | undefined,
): ValidationResult<readonly PortfolioTrade[]> {
  if (contribution === 0) return { ok: true, value: [] }

  const costs = transactionCosts ?? ZERO_TRANSACTION_COSTS
  const nonzeroWeights = weights.filter((weight) => weight > 0)
  const fixedCosts = nonzeroWeights.length * costs.fixedPerOrder
  const grossPurchases =
    (contribution - fixedCosts) / (1 + costs.proportionalRate)

  if (!(grossPurchases > 0) || !Number.isFinite(grossPurchases)) {
    return {
      ok: false,
      errors: [
        {
          code: 'transactionCosts.contribution.infeasible',
          message:
            'The scheduled contribution cannot fund its required purchase orders and transaction costs.',
        },
      ],
    }
  }

  return {
    ok: true,
    value: weights.flatMap((weight, assetIndex) =>
      weight > 0 ? [{ assetIndex, value: grossPurchases * weight }] : [],
    ),
  }
}

// Sales occur before buys. This scales the buy leg of Phase 6's frictionless
// intent to the actual cash left after sale fees and immediate tax; it never
// invents borrowing or an unmodelled cash balance.
export function fundRebalanceBuys(
  buyIntent: readonly PortfolioTrade[],
  availableProceeds: number,
  transactionCosts: TransactionCostConfig | undefined,
): ValidationResult<readonly PortfolioTrade[]> {
  if (buyIntent.length === 0) return { ok: true, value: [] }

  const costs = transactionCosts ?? ZERO_TRANSACTION_COSTS
  const fixedCosts = buyIntent.length * costs.fixedPerOrder
  const intendedGrossBuys = buyIntent.reduce(
    (total, trade) => total + trade.value,
    0,
  )
  const affordableGrossBuys =
    (availableProceeds - fixedCosts) / (1 + costs.proportionalRate)

  if (
    !(availableProceeds >= fixedCosts) ||
    !(intendedGrossBuys > 0) ||
    !Number.isFinite(affordableGrossBuys)
  ) {
    return {
      ok: false,
      errors: [
        {
          code: 'transactionCosts.rebalance.infeasible',
          message:
            'Sale proceeds cannot fund the rebalancing purchase orders and transaction costs.',
        },
      ],
    }
  }

  const scale = Math.min(1, affordableGrossBuys / intendedGrossBuys)
  return {
    ok: true,
    value: buyIntent.map((trade) => ({
      ...trade,
      value: trade.value * scale,
    })),
  }
}

export function applyExecutedTrades(
  holdings: readonly number[],
  trades: readonly ExecutedPortfolioTrade[],
): ValidationResult<readonly number[]> {
  const nextHoldings = [...holdings]
  for (const trade of trades) {
    nextHoldings[trade.assetIndex] += trade.value
  }

  if (
    nextHoldings.some(
      (holding) => !Number.isFinite(holding) || holding < -1e-10,
    )
  ) {
    return {
      ok: false,
      errors: [
        {
          code: 'transactionCosts.holdings.invalid',
          message:
            'Transaction execution produced an invalid portfolio holding.',
        },
      ],
    }
  }

  return {
    ok: true,
    value: nextHoldings.map((holding) => (holding < 0 ? 0 : holding)),
  }
}
