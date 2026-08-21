import type { TaxConfig } from '../simulation/simulationTypes'
import type { ValidationResult } from '../validation'
import type { ExecutedPortfolioTrade } from './transactionCosts'

export const ZERO_TAX: TaxConfig = {
  capitalGainsRate: 0,
}

export type TaxState = {
  readonly costBases: readonly number[]
  readonly lossCarryforward: number
}

export type TaxSaleResult = {
  readonly state: TaxState
  readonly realizedGainLoss: number
  readonly taxPaid: number
  readonly disposedBasis: number
}

export function initializeTaxState(
  initialInvestment: number,
  weights: readonly number[],
): TaxState {
  return {
    costBases: weights.map((weight) => initialInvestment * weight),
    lossCarryforward: 0,
  }
}

// Buy costs are part of the tax basis: they are cash paid to acquire the lot.
export function applyTaxableBuys(
  state: TaxState,
  trades: readonly ExecutedPortfolioTrade[],
): TaxState {
  const costBases = [...state.costBases]
  for (const trade of trades) {
    if (trade.value > 0) {
      costBases[trade.assetIndex] += trade.value + trade.transactionCost
    }
  }
  return { ...state, costBases }
}

// Sales use average dollar basis. Loss carryforward is path-level, so a loss
// from one asset can offset a later gain from another asset in the same path.
export function applyTaxableSales(
  state: TaxState,
  holdingsBeforeSales: readonly number[],
  sales: readonly ExecutedPortfolioTrade[],
  tax: TaxConfig | undefined,
): ValidationResult<TaxSaleResult> {
  const taxConfig = tax ?? ZERO_TAX
  const costBases = [...state.costBases]
  let lossCarryforward = state.lossCarryforward
  let realizedGainLoss = 0
  let taxPaid = 0
  let disposedBasis = 0

  for (const sale of sales) {
    if (sale.value >= 0) continue
    const grossSale = -sale.value
    const holding = holdingsBeforeSales[sale.assetIndex]
    if (!(holding > 0) || grossSale > holding + 1e-10) {
      return {
        ok: false,
        errors: [
          {
            code: 'tax.sale.invalid',
            message: 'A taxable sale exceeds the available portfolio holding.',
          },
        ],
      }
    }

    const basisDisposed = (costBases[sale.assetIndex] * grossSale) / holding
    const gainLoss = grossSale - sale.transactionCost - basisDisposed
    costBases[sale.assetIndex] -= basisDisposed
    disposedBasis += basisDisposed
    realizedGainLoss += gainLoss

    if (gainLoss < 0) {
      lossCarryforward += -gainLoss
      continue
    }

    const carryforwardUsed = Math.min(lossCarryforward, gainLoss)
    lossCarryforward -= carryforwardUsed
    taxPaid += (gainLoss - carryforwardUsed) * taxConfig.capitalGainsRate
  }

  return {
    ok: true,
    value: {
      state: { costBases, lossCarryforward },
      realizedGainLoss,
      taxPaid,
      disposedBasis,
    },
  }
}
