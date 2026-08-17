import { describe, expect, it } from 'vitest'
import { rebalancePortfolio } from './rebalancing'

describe('rebalancePortfolio', () => {
  it('rebalances at a time boundary with signed value-conserving trades', () => {
    const result = rebalancePortfolio(
      [700, 300],
      [0.5, 0.5],
      { mode: 'time', everyPeriods: 2 },
      2,
    )

    expect(result).toEqual({
      holdings: [500, 500],
      trades: [
        { assetIndex: 0, value: -200 },
        { assetIndex: 1, value: 200 },
      ],
      triggered: true,
    })
  })

  it('does not trade at a non-boundary time period', () => {
    const holdings = [700, 300]
    expect(
      rebalancePortfolio(
        holdings,
        [0.5, 0.5],
        { mode: 'time', everyPeriods: 2 },
        1,
      ),
    ).toEqual({ holdings, trades: [], triggered: false })
  })

  it('uses a strict tolerance-band boundary', () => {
    const atBand = rebalancePortfolio(
      [550, 450],
      [0.5, 0.5],
      { mode: 'toleranceBand', percentagePoints: 5 },
      1,
    )
    const beyondBand = rebalancePortfolio(
      [551, 449],
      [0.5, 0.5],
      { mode: 'toleranceBand', percentagePoints: 5 },
      1,
    )

    expect(atBand.triggered).toBe(false)
    expect(beyondBand).toEqual({
      holdings: [500, 500],
      trades: [
        { assetIndex: 0, value: -51 },
        { assetIndex: 1, value: 51 },
      ],
      triggered: true,
    })
  })

  it('does not divide by zero for a wiped-out portfolio', () => {
    expect(
      rebalancePortfolio(
        [0, 0],
        [0.5, 0.5],
        { mode: 'toleranceBand', percentagePoints: 1 },
        1,
      ),
    ).toEqual({ holdings: [0, 0], trades: [], triggered: false })
  })
})
