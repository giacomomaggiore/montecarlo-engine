import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { DisplayMode } from '../../charts/chartData'
import type { MetricSummary } from '../../core/portfolio/metrics'
import type {
  RetainedPath,
  SimulationResult,
} from '../../core/simulation/simulationTypes'
import { PortfolioChart } from './PortfolioChart'

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

function formatTrades(
  trades: readonly { readonly assetIndex: number; readonly value: number }[],
): string {
  if (trades.length === 0) return 'none'
  return trades
    .map(
      (trade) =>
        `Asset ${trade.assetIndex + 1} ${trade.value > 0 ? 'buy' : 'sell'} ${currency.format(Math.abs(trade.value))}`,
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
        <td colSpan={3}>N/A — {unavailableReason}</td>
      </tr>
    )
  }
  return (
    <tr>
      <th scope="row">{label}</th>
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
    <section aria-labelledby="metrics-heading">
      <h3 id="metrics-heading">Key metrics</h3>
      <p className="input-hint">
        Each metric is a distribution across simulated paths — the headline is
        the median path, not a promise. Metrics are computed on nominal values.{' '}
        <Link to="/education">Definitions</Link>
      </p>

      {terminalWealth === null ? (
        <p role="alert">Terminal wealth: N/A — every simulated path failed.</p>
      ) : (
        <table className="metrics-table">
          <caption>Terminal wealth after the full horizon (nominal)</caption>
          <thead>
            <tr>
              {(['p10', 'p25', 'p50', 'p75', 'p90'] as const).map((level) => (
                <th key={level} scope="col">
                  {level}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {(['p10', 'p25', 'p50', 'p75', 'p90'] as const).map((level) => (
                <td key={level}>{currency.format(terminalWealth[level])}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}

      <table className="metrics-table">
        <caption>Distribution across paths (p10 / median / p90)</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">p10</th>
            <th scope="col">Median</th>
            <th scope="col">p90</th>
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
        </tbody>
      </table>

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
      </dl>

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
                    <td>
                      {currency.format(
                        metrics.benchmark.terminalDifference.p10,
                      )}
                    </td>
                    <td>
                      {currency.format(
                        metrics.benchmark.terminalDifference.p50,
                      )}
                    </td>
                    <td>
                      {currency.format(
                        metrics.benchmark.terminalDifference.p90,
                      )}
                    </td>
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
    </section>
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
                <th scope="col">Trades</th>
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
                    <td>{formatTrades(selected.trades[periodIndex] ?? [])}</td>
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
  const { config } = result.metadata
  const periodsPerYear =
    result.metadata.dataset.frequency === 'weekly' ? 52 : 12

  return (
    <section aria-labelledby="results-heading" className="results-panel">
      <h2 id="results-heading">Results</h2>

      {/* The previous-run label the spec requires: this block describes the
          COMPLETED run's own metadata, so editing the form above can never
          silently relabel an old chart as a new configuration. */}
      <p className="completed-run-label">
        Completed run: {result.metadata.algorithms.model}, seed {config.seed},{' '}
        {config.paths.toLocaleString('en-US')} paths x {config.periods} periods
        (~{Math.round(config.periods / periodsPerYear)} years), dataset{' '}
        {result.metadata.dataset.version}, rebalancing{' '}
        {config.rebalancing?.mode ?? 'none'}. Edits made to the settings above
        do not apply until the next run.
      </p>

      {result.failures.length > 0 && (
        <p role="alert">
          {result.failures.length} path(s) failed during accounting and are
          excluded from metrics (see ruin probability).
        </p>
      )}

      <PortfolioChart displayMode={displayMode} result={result} />

      {/* The accessible tabular alternative for the chart's essential
          values: which real path each drawn line is, and where it ends. */}
      <table className="metrics-table">
        <caption>
          Chart lines as a table ({displayMode} values): one real simulated path
          per terminal-wealth percentile
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

      <MetricsTable result={result} />
      <PathInspector displayMode={displayMode} result={result} />
    </section>
  )
}
