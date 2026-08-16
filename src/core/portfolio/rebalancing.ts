import type { RebalancingConfig } from '../simulation/simulationTypes'

export type PortfolioTrade = {
  readonly assetIndex: number
  // Positive means buy; negative means sell. Values are base-currency amounts.
  readonly value: number
}

export type RebalanceResult = {
  readonly holdings: readonly number[]
  readonly trades: readonly PortfolioTrade[]
  readonly triggered: boolean
}

const TRADE_TOLERANCE = 1e-10

// Decide and apply one frictionless rebalance after returns and contributions.
// Time complexity: O(D), space complexity: O(D), where D <= 6 holdings.
export function rebalancePortfolio(
  holdings: readonly number[],
  weights: readonly number[],
  rebalancing: RebalancingConfig | undefined,
  periodIndex: number,
): RebalanceResult {
  const config = rebalancing ?? { mode: 'none' as const }
  const equity = sum(holdings)
  if (!shouldRebalance(holdings, weights, config, periodIndex, equity)) {
    return { holdings, trades: [], triggered: false }
  }

  // Simultaneous target allocation: every trade is measured from the same
  // post-contribution holdings snapshot, not from a sequential mutation.
  const targetHoldings = weights.map((weight) => equity * weight)
  const trades: PortfolioTrade[] = []
  for (let assetIndex = 0; assetIndex < holdings.length; assetIndex += 1) {
    const value = targetHoldings[assetIndex] - holdings[assetIndex]
    if (Math.abs(value) > TRADE_TOLERANCE) {
      trades.push({ assetIndex, value })
    }
  }

  return { holdings: targetHoldings, trades, triggered: true }
}

function shouldRebalance(
  holdings: readonly number[],
  weights: readonly number[],
  config: RebalancingConfig,
  periodIndex: number,
  equity: number,
): boolean {
  if (config.mode === 'none' || periodIndex === 0 || equity <= 0) return false
  if (config.mode === 'time') return periodIndex % config.everyPeriods === 0

  const band = config.percentagePoints / 100
  return holdings.some(
    (holding, assetIndex) =>
      Math.abs(holding / equity - weights[assetIndex]) > band + TRADE_TOLERANCE,
  )
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
