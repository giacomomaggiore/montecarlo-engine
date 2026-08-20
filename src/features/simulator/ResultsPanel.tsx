import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DisplayMode } from '../../charts/chartData'
import type { MetricSummary } from '../../core/portfolio/metrics'
import type {
  RetainedPath,
  SimulationResult,
} from '../../core/simulation/simulationTypes'
import { ExportDownloads } from './ExportDownloads'
import { PortfolioChart } from './PortfolioChart'
import { LeverageChart } from './LeverageChart'

// Phase 4.6 — everything below the input workspace once a run has completed:
// the previous-run label, the chart with its tabular alternative, the metrics
// table, and the retained-path inspector. Pure presentation over one
// SimulationResult: no Worker, reducer, or fetch logic belongs here.

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const ratio = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatPercentile(level: number): string {
  return `p${Math.round(level * 100)}`
}

function formatExecutedTrades(
  trades: readonly {
    readonly assetIndex: number
    readonly value: number
    readonly transactionCost: number
  }[],
): string {
  if (trades.length === 0) return 'none'
  return trades
    .map(
      (trade) =>
        `Asset ${trade.assetIndex + 1} ${trade.value > 0 ? 'buy' : 'sell'} ${currency.format(Math.abs(trade.value))}; fee ${currency.format(trade.transactionCost)}`,
    )
    .join('; ')
}

// One row of the metric-distribution table. A null summary renders as N/A
// WITH its reason, per the spec — a blank cell hides information, a bare
// "N/A" invites wrong guesses.
function MetricRow({
  label,
  summary,
  totalPaths,
  format,
  unavailableReason,
}: {
  readonly label: string
  readonly summary: MetricSummary | null
  readonly totalPaths: number
  readonly format: (value: number) => string
  readonly unavailableReason: string
}) {
  if (summary === null) {
    return (
      <tr>
        <th scope="row">{label}</th>
        <td colSpan={5}>N/A — {unavailableReason}</td>
      </tr>
    )
  }
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{format(summary.p01)}</td>
      <td>{format(summary.p10)}</td>
      <td>
        {format(summary.p50)}
        {summary.availablePathCount < totalPaths && (
          <span className="input-hint">
            {' '}
            (defined on {summary.availablePathCount} of {totalPaths} paths)
          </span>
        )}
      </td>
      <td>{format(summary.p90)}</td>
      <td>{format(summary.p99)}</td>
    </tr>
  )
}

function MetricsTable({ result }: { readonly result: SimulationResult }) {
  const { metrics } = result
  const terminalWealth = metrics.terminalWealth
  const totalPaths = result.metadata.config.paths
  const growthLabel =
    metrics.growth.kind === 'cagr'
      ? 'CAGR (annualized growth)'
      : 'IRR (money-weighted annual return)'

  return (
    <section aria-labelledby="metrics-heading" className="result-table-section">
      <h3 className="result-table-heading" id="metrics-heading">
        Key metrics
      </h3>
      {terminalWealth === null && (
        <p role="alert">Terminal wealth: N/A — every simulated path failed.</p>
      )}

      <table className="metrics-table">
        <caption className="result-table-subtitle">
          Each metric is a distribution across simulated paths on nominal
          values. <Link to="/education">Definitions</Link>
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">p01</th>
            <th scope="col">p10</th>
            <th scope="col">Median</th>
            <th scope="col">p90</th>
            <th scope="col">p99</th>
          </tr>
        </thead>
        <tbody>
          <MetricRow
            format={(value) => percent.format(value)}
            label={growthLabel}
            summary={metrics.growth.summary}
            totalPaths={totalPaths}
            unavailableReason={
              metrics.growth.kind === 'irr'
                ? 'no path had a finite admissible IRR root'
                : 'no path produced a defined growth rate'
            }
          />
          <MetricRow
            format={(value) => percent.format(value)}
            label="Annualized volatility"
            summary={metrics.annualizedVolatility}
            totalPaths={totalPaths}
            unavailableReason="volatility needs at least two completed periods"
          />
          <MetricRow
            format={(value) => ratio.format(value)}
            label="Sharpe ratio"
            summary={metrics.sharpeRatio}
            totalPaths={totalPaths}
            unavailableReason="excess returns had zero variance on every path"
          />
          <MetricRow
            format={(value) => percent.format(value)}
            label="Maximum drawdown"
            summary={metrics.maxDrawdown}
            totalPaths={totalPaths}
            unavailableReason="no path completed enough periods"
          />
          <MetricRow
            format={(value) => currency.format(value)}
            label="Cumulative transaction costs"
            summary={metrics.transactionCosts}
            totalPaths={totalPaths}
            unavailableReason="no path completed accounting"
          />
          <MetricRow
            format={(value) => currency.format(value)}
            label="Cumulative borrowing interest"
            summary={metrics.borrowingInterest ?? null}
            totalPaths={totalPaths}
            unavailableReason="leverage was disabled or no leveraged path completed"
          />
          <MetricRow
            format={(value) => currency.format(value)}
            label="Realised gain / loss"
            summary={metrics.realizedGainLoss}
            totalPaths={totalPaths}
            unavailableReason="no path completed accounting"
          />
          <MetricRow
            format={(value) => currency.format(value)}
            label="Capital-gains tax paid"
            summary={metrics.taxesPaid}
            totalPaths={totalPaths}
            unavailableReason="no path completed accounting"
          />
          <MetricRow
            format={(value) => currency.format(value)}
            label="Unused loss carryforward"
            summary={metrics.lossCarryforward}
            totalPaths={totalPaths}
            unavailableReason="no path completed accounting"
          />
        </tbody>
      </table>

    </section>
  )
}

function ResultsSummary({ result }: { readonly result: SimulationResult }) {
  const { metrics } = result

  return (
    <div className="results-summary-grid">
        {metrics.benchmark !== null &&
          result.metadata.benchmarkAssetId !== null && (
            <section aria-labelledby="benchmark-heading">
              <h4 id="benchmark-heading">
                Benchmark comparison: {result.metadata.benchmarkAssetId}
              </h4>
              {metrics.benchmark.terminalDifference === null ? (
                <p>
                  N/A — no path completed with both a portfolio and benchmark
                  terminal value.
                </p>
              ) : (
                <table className="metrics-table">
                  <caption>
                    Portfolio minus benchmark terminal wealth (nominal)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">p10</th>
                      <th scope="col">Median</th>
                      <th scope="col">p90</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{currency.format(metrics.benchmark.terminalDifference.p10)}</td>
                      <td>{currency.format(metrics.benchmark.terminalDifference.p50)}</td>
                      <td>{currency.format(metrics.benchmark.terminalDifference.p90)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              <p className="input-hint">
                {metrics.benchmark.outperformanceProbability === null
                  ? 'No comparable paths completed.'
                  : `${percent.format(metrics.benchmark.outperformanceProbability)} of ${metrics.benchmark.comparablePathCount} comparable paths outperformed.`}{' '}
                The benchmark received this portfolio&apos;s realised external
                contributions on the same simulated dates.
              </p>
            </section>
          )}
        <dl className="probability-list">
          <dt>Loss probability</dt>
          <dd>
            {percent.format(metrics.lossProbability)} of paths ended below the
            total amount paid in.
          </dd>
          <dt>Ruin probability</dt>
          <dd>
            {percent.format(metrics.ruinProbability)}
            {metrics.ruinProbability === 0 &&
              ' — structurally zero until leverage exists: an unleveraged long-only portfolio cannot go insolvent.'}
          </dd>
          {metrics.marginCallProbability != null && (
            <>
              <dt>Margin-call incidence</dt>
              <dd>
                {percent.format(metrics.marginCallProbability)} of paths had at
                least one forced deleveraging sale.
              </dd>
            </>
          )}
        </dl>
    </div>
  )
}

// The spec's Interactive Highlights: click into one retained path and see
// exactly what it experienced — including, for bootstrap runs, WHICH real
// historical week each period was resampled from.
function PathInspector({
  result,
  displayMode,
}: {
  readonly result: SimulationResult
  readonly displayMode: DisplayMode
}) {
  const [selectedPathIndex, setSelectedPathIndex] = useState<number | null>(
    null,
  )
  const retained = result.retainedPaths
  if (retained.length === 0) {
    return null
  }

  const selected: RetainedPath | undefined = retained.find(
    (path) => path.pathIndex === selectedPathIndex,
  )

  return (
    <section aria-labelledby="path-inspector-heading">
      <h3 id="path-inspector-heading">Inspect an individual path</h3>
      <p className="input-hint">
        The first {retained.length} simulated paths keep full period-by-period
        detail. Each is one equally likely future, not a forecast.
      </p>
      <label htmlFor="path-inspector-select">Path to inspect</label>
      <select
        id="path-inspector-select"
        onChange={(event) =>
          setSelectedPathIndex(
            event.target.value === '' ? null : Number(event.target.value),
          )
        }
        value={selectedPathIndex ?? ''}
      >
        <option value="">Select a path…</option>
        {retained.map((path) => (
          <option key={path.pathIndex} value={path.pathIndex}>
            Path {path.pathIndex} — ends at{' '}
            {Number.isFinite(path.values[path.values.length - 1])
              ? currency.format(path.values[path.values.length - 1])
              : 'failed'}
          </option>
        ))}
      </select>

      {selected !== undefined && (
        <div className="path-detail-scroll">
          {selected.leverage != null &&
            result.metadata.config.leverage?.mode === 'enabled' && (
              <section aria-labelledby="leverage-chart-heading">
                <h4 id="leverage-chart-heading">Weekly leverage ratio</h4>
                <LeverageChart
                  maintenanceMargin={
                    result.metadata.config.leverage.maintenanceMargin
                  }
                  path={selected}
                  targetGrossExposure={
                    result.metadata.config.leverage.targetGrossExposure
                  }
                />
              </section>
            )}
          <table className="metrics-table">
            <caption>
              Path {selected.pathIndex}, period by period
              {displayMode === 'real' &&
                ' (real column deflated by this path’s own inflation)'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Sampled week</th>
                <th scope="col">Equity</th>
                {displayMode === 'real' && <th scope="col">Real equity</th>}
                <th scope="col">Contribution</th>
                {selected.leverage != null && <th scope="col">Debt</th>}
                {selected.leverage != null && (
                  <th scope="col">Gross leverage</th>
                )}
                {selected.leverage != null && <th scope="col">Margin</th>}
                {selected.leverage != null && (
                  <th scope="col">Leverage event</th>
                )}
                <th scope="col">Executed orders</th>
                <th scope="col">Costs</th>
                <th scope="col">Gain / loss</th>
                <th scope="col">Tax</th>
                <th scope="col">Basis</th>
                <th scope="col">Loss carryforward</th>
                <th scope="col">Price level</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(selected.values, (equity, periodIndex) => {
                // scenarios[k] produced period k+1; period 0 is the initial
                // allocation and has no sampled scenario.
                const scenario =
                  periodIndex > 0
                    ? selected.scenarios[periodIndex - 1]
                    : undefined
                const sourceDate =
                  scenario?.sourceRowIndex != null
                    ? result.metadata.datasetDates[scenario.sourceRowIndex]
                    : '—'
                const priceLevel = selected.priceLevels[periodIndex]
                return (
                  <tr key={periodIndex}>
                    <th scope="row">{periodIndex}</th>
                    <td>{sourceDate}</td>
                    <td>
                      {Number.isFinite(equity)
                        ? currency.format(equity)
                        : 'failed'}
                    </td>
                    {displayMode === 'real' && (
                      <td>
                        {Number.isFinite(equity / priceLevel)
                          ? currency.format(equity / priceLevel)
                          : 'failed'}
                      </td>
                    )}
                    <td>
                      {Number.isFinite(selected.contributions[periodIndex])
                        ? currency.format(selected.contributions[periodIndex])
                        : '—'}
                    </td>
                    {selected.leverage != null && (
                      <td>
                        {currency.format(selected.leverage.debts[periodIndex])}
                      </td>
                    )}
                    {selected.leverage != null && (
                      <td>
                        {ratio.format(
                          selected.leverage.grossLeverages[periodIndex],
                        )}
                        x
                      </td>
                    )}
                    {selected.leverage != null && (
                      <td>
                        {percent.format(
                          selected.leverage.maintenanceMargins[periodIndex],
                        )}
                      </td>
                    )}
                    {selected.leverage != null && (
                      <td>
                        {selected.leverage.marginCalls[periodIndex] === 1
                          ? 'margin call'
                          : selected.leverage.leverageResets[periodIndex] === 1
                            ? 'reset'
                            : 'none'}
                      </td>
                    )}
                    <td>
                      {formatExecutedTrades(
                        selected.executedTrades[periodIndex] ?? [],
                      )}
                    </td>
                    <td>
                      {Number.isFinite(selected.transactionCosts[periodIndex])
                        ? currency.format(
                            selected.transactionCosts[periodIndex],
                          )
                        : '—'}
                    </td>
                    <td>
                      {Number.isFinite(selected.realizedGainLosses[periodIndex])
                        ? currency.format(
                            selected.realizedGainLosses[periodIndex],
                          )
                        : '—'}
                    </td>
                    <td>
                      {Number.isFinite(selected.taxesPaid[periodIndex])
                        ? currency.format(selected.taxesPaid[periodIndex])
                        : '—'}
                    </td>
                    <td>
                      {Number.isFinite(selected.costBases[periodIndex])
                        ? currency.format(selected.costBases[periodIndex])
                        : '—'}
                    </td>
                    <td>
                      {Number.isFinite(selected.lossCarryforwards[periodIndex])
                        ? currency.format(
                            selected.lossCarryforwards[periodIndex],
                          )
                        : '—'}
                    </td>
                    <td>
                      {Number.isFinite(priceLevel)
                        ? priceLevel.toFixed(4)
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function ResultsPanel({
  result,
  displayMode,
}: {
  readonly result: SimulationResult
  readonly displayMode: DisplayMode
}) {
  const resultsRef = useRef<HTMLElement>(null)
  const { config } = result.metadata
  const periodsPerYear =
    result.metadata.dataset.frequency === 'weekly' ? 52 : 12
  const leverageLabel =
    config.leverage?.mode === 'enabled'
      ? `leverage ${ratio.format(config.leverage.targetGrossExposure)}x, maintenance ${percent.format(config.leverage.maintenanceMargin)}, spread ${percent.format(config.leverage.annualBorrowingSpread)}`
      : 'no leverage'
  const failureSummary = Array.from(
    result.failures.reduce((counts, failure) => {
      counts.set(failure.code, (counts.get(failure.code) ?? 0) + 1)
      return counts
    }, new Map<string, number>()),
  )
    .map(([code, count]) => `${code}: ${count}`)
    .join(', ')

  useEffect(() => {
    const resultsElement = resultsRef.current
    if (resultsElement === null) return
    if (typeof resultsElement.scrollIntoView === 'function') {
      resultsElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    resultsElement.focus({ preventScroll: true })
  }, [result])

  return (
    <section
      aria-labelledby="results-heading"
      className="results-panel"
      ref={resultsRef}
      tabIndex={-1}
    >
      <h2 id="results-heading">Results</h2>

      {/* The previous-run label the spec requires: this block describes the
          COMPLETED run's own metadata, so editing the form above can never
          silently relabel an old chart as a new configuration. */}
      <p className="completed-run-label">
        Completed run: {result.metadata.algorithms.model}, seed {config.seed},{' '}
        {config.paths.toLocaleString('en-US')} paths x {config.periods} periods
        (~{Math.round(config.periods / periodsPerYear)} years), dataset{' '}
        {result.metadata.dataset.version}, rebalancing{' '}
        {config.rebalancing?.mode ?? 'none'}, fixed order cost{' '}
        {currency.format(config.transactionCosts?.fixedPerOrder ?? 0)},
        proportional cost{' '}
        {percent.format(config.transactionCosts?.proportionalRate ?? 0)}, tax{' '}
        {percent.format(config.tax?.capitalGainsRate ?? 0)}, {leverageLabel}.
        Edits made to the settings above do not apply until the next run.
      </p>

      {result.failures.length > 0 && (
        <p role="alert">
          {result.failures.length} path(s) failed during accounting and are
          excluded from metrics (see ruin probability). {failureSummary}
        </p>
      )}

      <PortfolioChart displayMode={displayMode} result={result} />

      {/* The accessible tabular alternative for the chart's essential
          values: which real path each drawn line is, and where it ends. */}
      <div className="results-tables-grid">
        <MetricsTable result={result} />
        <section
          aria-labelledby="terminal-wealth-heading"
          className="result-table-section terminal-wealth-table"
        >
          <h3 className="result-table-heading" id="terminal-wealth-heading">
            Terminal wealth
          </h3>
          <table className="metrics-table">
            <caption className="result-table-subtitle">
              Chart lines as a table ({displayMode} values).
            </caption>
            <thead>
              <tr>
                <th scope="col">Percentile (by terminal wealth)</th>
                <th scope="col">Path #</th>
                <th scope="col">Terminal wealth</th>
              </tr>
            </thead>
            <tbody>
              {result.representativePaths.map((path) => {
                const lastIndex = path.values.length - 1
                const displayedTerminal =
                  displayMode === 'real'
                    ? path.values[lastIndex] / path.priceLevels[lastIndex]
                    : path.values[lastIndex]
                return (
                  <tr key={path.quantileLevel}>
                    <th scope="row">{formatPercentile(path.quantileLevel)}</th>
                    <td>{path.pathIndex}</td>
                    <td>
                      {Number.isFinite(displayedTerminal)
                        ? currency.format(displayedTerminal)
                        : 'failed'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      </div>
      <ResultsSummary result={result} />
      <PathInspector displayMode={displayMode} result={result} />
      <ExportDownloads result={result} />
    </section>
  )
}
