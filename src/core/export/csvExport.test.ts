import { describe, expect, it } from 'vitest'
import type { MetricSummary } from '../portfolio/metrics'
import type { SimulationResult } from '../simulation/simulationTypes'
import {
  CSV_EXPORT_VERSION,
  createCsvExports,
  escapeCsvCell,
} from './csvExport'

const summary: MetricSummary = {
  p01: 1,
  p10: 2,
  p50: 3,
  p90: 4,
  p99: 5,
  availablePathCount: 2,
}

function fixtureResult(): SimulationResult {
  return {
    metadata: {
      config: {
        weights: [0.6, 0.4],
        initialInvestment: 1000,
        cashFlow: { mode: 'dca', amount: 100 },
        rebalancing: { mode: 'time', everyPeriods: 2 },
        transactionCosts: { fixedPerOrder: 1, proportionalRate: 0.001 },
        tax: { capitalGainsRate: 0.2 },
        leverage: {
          mode: 'enabled',
          targetGrossExposure: 2,
          maintenanceMargin: 0.4,
          annualBorrowingSpread: 0.01,
          reset: { mode: 'toleranceBand', percentagePoints: 10 },
        },
        paths: 2,
        periods: 1,
        seed: 42,
      },
      dataset: {
        version: 'usd-weekly-v1',
        checksum: 'sha256:fixture',
        frequency: 'weekly',
        baseCurrency: 'USD',
      },
      portfolioAssetIds: ['SPY', 'AGG'],
      datasetDates: ['2020-01-05', '2020-01-12'],
      benchmarkAssetId: 'BIL',
      algorithms: {
        model: 'historical-bootstrap-v1',
        prng: 'xoshiro128**-v1',
        quantile: 'quantile-linear-interpolation-v1',
        metrics: 'metrics-v3',
        accounting: 'cost-tax-accounting-v1',
      },
    },
    terminalWealth: new Float64Array([1200, 0]),
    benchmarkTerminalWealth: new Float64Array([1100, NaN]),
    metrics: {
      terminalWealth: { p10: 1200, p25: 1200, p50: 1200, p75: 1200, p90: 1200 },
      lossProbability: 0.5,
      ruinProbability: 0.5,
      growth: { kind: 'irr', summary },
      annualizedVolatility: summary,
      sharpeRatio: summary,
      maxDrawdown: summary,
      transactionCosts: summary,
      realizedGainLoss: summary,
      taxesPaid: summary,
      lossCarryforward: summary,
      borrowingInterest: summary,
      marginCallProbability: 0.5,
      benchmark: {
        terminalDifference: summary,
        outperformanceProbability: 1,
        comparablePathCount: 1,
      },
    },
    representativePaths: [],
    retainedPaths: [
      {
        pathIndex: 0,
        values: new Float64Array([1000, 1200]),
        contributions: new Float64Array([0, 100]),
        priceLevels: new Float64Array([1, 1.01]),
        trades: [
          [],
          [
            { assetIndex: 0, value: -30 },
            { assetIndex: 1, value: 30 },
          ],
        ],
        executedTrades: [
          [],
          [
            { assetIndex: 0, value: -29, transactionCost: 1 },
            { assetIndex: 1, value: 28, transactionCost: 1 },
          ],
        ],
        transactionCosts: new Float64Array([0, 2]),
        realizedGainLosses: new Float64Array([0, 10]),
        taxesPaid: new Float64Array([0, 2]),
        costBases: new Float64Array([900, 918]),
        lossCarryforwards: new Float64Array([0, 0]),
        scenarios: [
          {
            assetReturns: [0.1, 0],
            inflation: 0.01,
            riskFreeRate: 0.001,
            sourceRowIndex: 1,
          },
        ],
        leverage: {
          debts: new Float64Array([1000, 800]),
          grossAssets: new Float64Array([2000, 2000]),
          grossLeverages: new Float64Array([2, 1.67]),
          maintenanceMargins: new Float64Array([0.5, 0.6]),
          marginCalls: new Uint8Array([0, 1]),
          leverageResets: new Uint8Array([0, 0]),
        },
      },
    ],
    failures: [
      {
        pathIndex: 1,
        periodIndex: 1,
        code: 'insolvent',
        message: '=margin loss, "final"',
      },
    ],
  }
}

describe('csvExport', () => {
  it('encodes text safely while keeping numeric values locale-independent', () => {
    expect(escapeCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"')
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe('"\'=SUM(A1:A2)"')
    expect(escapeCsvCell(-12.5)).toBe('-12.5')
    expect(escapeCsvCell(NaN)).toBe('')
  })

  it('creates stable metadata, metrics, terminal, and retained-detail tables', () => {
    const exports = createCsvExports(fixtureResult())

    expect(exports.map((entry) => entry.filename)).toEqual([
      'usd-weekly-v1-historical-bootstrap-v1-seed-42-run-metadata.csv',
      'usd-weekly-v1-historical-bootstrap-v1-seed-42-metric-summaries.csv',
      'usd-weekly-v1-historical-bootstrap-v1-seed-42-terminal-outcomes.csv',
      'usd-weekly-v1-historical-bootstrap-v1-seed-42-retained-path-details.csv',
    ])

    expect(exports[0].content).toContain(`"${CSV_EXPORT_VERSION}"`)
    expect(exports[0].content).toContain('"[""SPY"",""AGG""]"')
    expect(exports[0].content).toContain('"toleranceBand"')
    expect(exports[1].content).toContain('benchmark_outperformance_probability')
    expect(exports[2].content).toContain('0,"completed",1200,1100,100,true')
    expect(exports[2].content).toContain(
      '1,"insolvent",0,,,false,1,"insolvent","\'=margin loss, ""final"""',
    )
    expect(exports[3].content).toContain('0,0,,1000,0,1,,"[]","[]"')
    expect(exports[3].content).toContain('2020-01-12')
    expect(exports[3].content).toContain(
      '"[{""assetId"":""SPY"",""assetIndex"":0,""value"":-30}',
    )
    expect(exports[3].content).toContain(',true,false\r\n')
  })
})
