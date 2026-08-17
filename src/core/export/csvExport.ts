import type { MetricSummary, SimulationMetrics } from '../portfolio/metrics'
import type { ExecutedPortfolioTrade } from '../portfolio/transactionCosts'
import type { PortfolioTrade } from '../portfolio/rebalancing'
import type {
  SimulationFailure,
  SimulationResult,
} from '../simulation/simulationTypes'

export const CSV_EXPORT_VERSION = 'csv-export-v1'

export type CsvExport = {
  readonly filename: string
  readonly content: string
}

type CsvCell = boolean | null | number | string | undefined

export function createCsvExports(
  result: SimulationResult,
): readonly CsvExport[] {
  const filenamePrefix = createFilenamePrefix(result)

  return [
    {
      filename: `${filenamePrefix}-run-metadata.csv`,
      content: createRunMetadataCsv(result),
    },
    {
      filename: `${filenamePrefix}-metric-summaries.csv`,
      content: createMetricSummariesCsv(result.metrics),
    },
    {
      filename: `${filenamePrefix}-terminal-outcomes.csv`,
      content: createTerminalOutcomesCsv(result),
    },
    {
      filename: `${filenamePrefix}-retained-path-details.csv`,
      content: createRetainedPathDetailsCsv(result),
    },
  ]
}

export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  const formulaSafeValue = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${formulaSafeValue.replaceAll('"', '""')}"`
}

function createRunMetadataCsv(result: SimulationResult): string {
  const { algorithms, benchmarkAssetId, config, dataset, portfolioAssetIds } =
    result.metadata
  const rebalancing = config.rebalancing ?? { mode: 'none' as const }
  const transactionCosts = config.transactionCosts ?? {
    fixedPerOrder: 0,
    proportionalRate: 0,
  }
  const tax = config.tax ?? { capitalGainsRate: 0, initialCostBasis: null }
  const leverage = config.leverage ?? { mode: 'none' as const }

  return serializeCsv(
    [
      'schema_version',
      'dataset_version',
      'dataset_checksum',
      'frequency',
      'base_currency',
      'model_version',
      'prng_version',
      'quantile_version',
      'metrics_version',
      'accounting_version',
      'seed',
      'paths',
      'periods',
      'initial_investment',
      'portfolio_asset_ids_json',
      'weights_json',
      'cash_flow_mode',
      'dca_amount',
      'value_averaging_target_increase',
      'rebalancing_mode',
      'rebalancing_every_periods',
      'rebalancing_percentage_points',
      'fixed_cost_per_order',
      'proportional_cost_rate',
      'capital_gains_tax_rate',
      'initial_cost_basis',
      'leverage_mode',
      'target_gross_exposure',
      'maintenance_margin',
      'annual_borrowing_spread',
      'leverage_reset_mode',
      'leverage_reset_every_periods',
      'leverage_reset_percentage_points',
      'benchmark_asset_id',
    ],
    [
      [
        CSV_EXPORT_VERSION,
        dataset.version,
        dataset.checksum,
        dataset.frequency,
        dataset.baseCurrency,
        algorithms.model,
        algorithms.prng,
        algorithms.quantile,
        algorithms.metrics,
        algorithms.accounting,
        config.seed,
        config.paths,
        config.periods,
        config.initialInvestment,
        JSON.stringify(portfolioAssetIds),
        JSON.stringify(config.weights),
        config.cashFlow.mode,
        config.cashFlow.mode === 'dca' ? config.cashFlow.amount : null,
        config.cashFlow.mode === 'valueAveraging'
          ? config.cashFlow.targetIncrease
          : null,
        rebalancing.mode,
        rebalancing.mode === 'time' ? rebalancing.everyPeriods : null,
        rebalancing.mode === 'toleranceBand'
          ? rebalancing.percentagePoints
          : null,
        transactionCosts.fixedPerOrder,
        transactionCosts.proportionalRate,
        tax.capitalGainsRate,
        tax.initialCostBasis,
        leverage.mode,
        leverage.mode === 'enabled' ? leverage.targetGrossExposure : null,
        leverage.mode === 'enabled' ? leverage.maintenanceMargin : null,
        leverage.mode === 'enabled' ? leverage.annualBorrowingSpread : null,
        leverage.mode === 'enabled' ? leverage.reset.mode : null,
        leverage.mode === 'enabled' && leverage.reset.mode === 'time'
          ? leverage.reset.everyPeriods
          : null,
        leverage.mode === 'enabled' && leverage.reset.mode === 'toleranceBand'
          ? leverage.reset.percentagePoints
          : null,
        benchmarkAssetId,
      ],
    ],
  )
}

function createMetricSummariesCsv(metrics: SimulationMetrics): string {
  const rows: CsvCell[][] = []
  addMetricSummary(rows, 'terminal_wealth', metrics.terminalWealth)
  addMetricSummary(rows, metrics.growth.kind, metrics.growth.summary)
  addMetricSummary(rows, 'annualized_volatility', metrics.annualizedVolatility)
  addMetricSummary(rows, 'sharpe_ratio', metrics.sharpeRatio)
  addMetricSummary(rows, 'maximum_drawdown', metrics.maxDrawdown)
  addMetricSummary(rows, 'transaction_costs', metrics.transactionCosts)
  addMetricSummary(rows, 'realized_gain_loss', metrics.realizedGainLoss)
  addMetricSummary(rows, 'taxes_paid', metrics.taxesPaid)
  addMetricSummary(rows, 'loss_carryforward', metrics.lossCarryforward)
  addMetricSummary(
    rows,
    'borrowing_interest',
    metrics.borrowingInterest ?? null,
  )
  addScalarMetric(rows, 'loss_probability', metrics.lossProbability)
  addScalarMetric(rows, 'ruin_probability', metrics.ruinProbability)
  addScalarMetric(
    rows,
    'margin_call_probability',
    metrics.marginCallProbability,
  )
  if (metrics.benchmark !== null) {
    addMetricSummary(
      rows,
      'benchmark_terminal_difference',
      metrics.benchmark.terminalDifference,
    )
    addScalarMetric(
      rows,
      'benchmark_outperformance_probability',
      metrics.benchmark.outperformanceProbability,
      metrics.benchmark.comparablePathCount,
    )
  }

  return serializeCsv(
    [
      'metric',
      'p01',
      'p10',
      'p25',
      'p50',
      'p75',
      'p90',
      'p99',
      'scalar_value',
      'available_path_count',
    ],
    rows,
  )
}

function createTerminalOutcomesCsv(result: SimulationResult): string {
  const failuresByPath = new Map<number, SimulationFailure>()
  for (const failure of result.failures) {
    if (!failuresByPath.has(failure.pathIndex)) {
      failuresByPath.set(failure.pathIndex, failure)
    }
  }

  const rows: CsvCell[][] = []
  for (
    let pathIndex = 0;
    pathIndex < result.terminalWealth.length;
    pathIndex += 1
  ) {
    const failure = failuresByPath.get(pathIndex)
    const terminalWealth = result.terminalWealth[pathIndex]
    const benchmarkTerminalWealth =
      result.benchmarkTerminalWealth?.[pathIndex] ?? NaN
    const comparable =
      Number.isFinite(terminalWealth) &&
      Number.isFinite(benchmarkTerminalWealth)
    rows.push([
      pathIndex,
      failure === undefined
        ? 'completed'
        : failure.code === 'insolvent'
          ? 'insolvent'
          : 'failed',
      terminalWealth,
      benchmarkTerminalWealth,
      comparable ? terminalWealth - benchmarkTerminalWealth : null,
      comparable,
      failure?.periodIndex,
      failure?.code,
      failure?.message,
    ])
  }

  return serializeCsv(
    [
      'path_index',
      'path_status',
      'terminal_wealth_after_liquidation',
      'benchmark_terminal_wealth',
      'terminal_difference',
      'benchmark_comparable',
      'failure_period_index',
      'failure_code',
      'failure_message',
    ],
    rows,
  )
}

function createRetainedPathDetailsCsv(result: SimulationResult): string {
  const rows: CsvCell[][] = []
  for (const path of result.retainedPaths) {
    for (
      let periodIndex = 0;
      periodIndex < path.values.length;
      periodIndex += 1
    ) {
      const scenario = periodIndex > 0 ? path.scenarios[periodIndex - 1] : null
      const sourceRowIndex = scenario?.sourceRowIndex ?? null
      rows.push([
        path.pathIndex,
        periodIndex,
        scenario === null
          ? null
          : sourceRowIndex === null
            ? null
            : result.metadata.datasetDates[sourceRowIndex],
        path.values[periodIndex],
        path.contributions[periodIndex],
        path.priceLevels[periodIndex],
        sourceRowIndex,
        serializeTrades(
          path.trades[periodIndex] ?? [],
          result.metadata.portfolioAssetIds,
        ),
        serializeExecutedTrades(
          path.executedTrades[periodIndex] ?? [],
          result.metadata.portfolioAssetIds,
        ),
        path.transactionCosts[periodIndex],
        path.realizedGainLosses[periodIndex],
        path.taxesPaid[periodIndex],
        path.costBases[periodIndex],
        path.lossCarryforwards[periodIndex],
        path.leverage?.debts[periodIndex],
        path.leverage?.grossAssets[periodIndex],
        path.leverage?.grossLeverages[periodIndex],
        path.leverage?.maintenanceMargins[periodIndex],
        path.leverage?.marginCalls[periodIndex] === 1,
        path.leverage?.leverageResets[periodIndex] === 1,
      ])
    }
  }

  return serializeCsv(
    [
      'path_index',
      'period_index',
      'source_date',
      'equity',
      'gross_external_contribution',
      'cumulative_price_level',
      'source_row_index',
      'intended_trades_json',
      'executed_trades_json',
      'transaction_cost',
      'realized_gain_loss',
      'tax_paid',
      'cost_basis',
      'loss_carryforward',
      'debt',
      'gross_assets',
      'gross_leverage',
      'maintenance_margin',
      'margin_call',
      'leverage_reset',
    ],
    rows,
  )
}

function addMetricSummary(
  rows: CsvCell[][],
  metric: string,
  summary:
    | MetricSummary
    | {
        readonly p10: number
        readonly p25: number
        readonly p50: number
        readonly p75: number
        readonly p90: number
      }
    | null,
): void {
  if (summary === null || summary === undefined) {
    rows.push([metric])
    return
  }

  if ('p01' in summary) {
    rows.push([
      metric,
      summary.p01,
      summary.p10,
      null,
      summary.p50,
      null,
      summary.p90,
      summary.p99,
      null,
      summary.availablePathCount,
    ])
    return
  }

  rows.push([
    metric,
    null,
    summary.p10,
    summary.p25,
    summary.p50,
    summary.p75,
    summary.p90,
  ])
}

function addScalarMetric(
  rows: CsvCell[][],
  metric: string,
  value: number | null | undefined,
  availablePathCount: number | null = null,
): void {
  rows.push([
    metric,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    value,
    availablePathCount,
  ])
}

function serializeTrades(
  trades: readonly PortfolioTrade[],
  portfolioAssetIds: readonly string[],
): string {
  return JSON.stringify(
    trades.map((trade) => ({
      assetId: portfolioAssetIds[trade.assetIndex] ?? null,
      assetIndex: trade.assetIndex,
      value: trade.value,
    })),
  )
}

function serializeExecutedTrades(
  trades: readonly ExecutedPortfolioTrade[],
  portfolioAssetIds: readonly string[],
): string {
  return JSON.stringify(
    trades.map((trade) => ({
      assetId: portfolioAssetIds[trade.assetIndex] ?? null,
      assetIndex: trade.assetIndex,
      value: trade.value,
      transactionCost: trade.transactionCost,
    })),
  )
}

function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n')
    .concat('\r\n')
}

function createFilenamePrefix(result: SimulationResult): string {
  const { dataset, algorithms, config } = result.metadata
  return [dataset.version, algorithms.model, `seed-${config.seed}`]
    .map(sanitizeFilenamePart)
    .join('-')
}

function sanitizeFilenamePart(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '')
}
