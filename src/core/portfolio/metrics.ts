// Phase 4.2 — per-path performance metrics, computed STREAMING inside
// runSimulation's existing path loop (never by re-walking the flat equity
// buffer afterwards). Everything here is a pure function of numbers the
// accounting loop already has in hand each period: the external contribution,
// the contribution-neutral return, and the sampled risk-free rate.
//
// The statistical stance: every simulated path is one independent draw from
// the portfolio's outcome distribution, so a metric like "volatility" is not
// one number — it is a distribution across paths. Each per-path value is
// computed here, and summarizeAcrossPaths() reduces the cross-section to
// p10/p50/p90 with the same canonical quantile rule the whole app uses.
// The UI's headline number is the median, labelled as such.
//
// Unavailability convention: a per-path metric that cannot be defined for a
// given path (a failed path, a zero-variance Sharpe denominator, an IRR with
// no admissible root) is NaN — "no observation", the same meaning NaN already
// carries in the runner's equity buffers — and NaN entries are excluded from
// the cross-sectional summary, never counted as zero.

import { computeQuantile } from '../math/quantiles'

// Versioned per the Financial Rules: metric definitions are part of a
// result's reproducible identity, exactly like the PRNG and model versions.
// Any change to a formula below requires bumping this string.
export const METRICS_VERSION = 'metrics-v2'

// Cross-sectional summary of one per-path metric. availablePathCount says how
// many paths actually produced a defined value — the honest denominator.
export type MetricSummary = {
  readonly p10: number
  readonly p50: number
  readonly p90: number
  readonly availablePathCount: number
}

// The five canonical terminal-wealth levels the README's Key Metrics Panel
// reports (deliberately narrower than the chart's seven representative
// levels — see quantiles.ts).
export type TerminalWealthPercentiles = {
  readonly p10: number
  readonly p25: number
  readonly p50: number
  readonly p75: number
  readonly p90: number
}

export type SimulationMetrics = {
  // null only when every path failed and no terminal-wealth distribution exists.
  readonly terminalWealth: TerminalWealthPercentiles | null
  // P(W_T < total contributed capital), counting failed paths as losses:
  // a path that could not even finish certainly did not beat its own inflows.
  readonly lossProbability: number
  // Fraction of paths explicitly marked insolvent by leverage accounting.
  // Transaction-cost/tax execution failures remain visible in `failures` but
  // are not economic ruin. Structurally zero until Phase 8 adds leverage.
  readonly ruinProbability: number
  // CAGR for lump sum (no later external flows), money-weighted IRR when
  // recurring contributions exist — per the Key Metrics Panel rule that a
  // time-weighted growth rate is meaningless once external cash arrives
  // mid-path.
  readonly growth: {
    readonly kind: 'cagr' | 'irr'
    readonly summary: MetricSummary | null
  }
  readonly annualizedVolatility: MetricSummary | null
  readonly sharpeRatio: MetricSummary | null
  readonly maxDrawdown: MetricSummary | null
  readonly transactionCosts: MetricSummary | null
  readonly realizedGainLoss: MetricSummary | null
  readonly taxesPaid: MetricSummary | null
  readonly lossCarryforward: MetricSummary | null
  readonly benchmark: BenchmarkMetrics | null
}

export type BenchmarkMetrics = {
  readonly terminalDifference: MetricSummary | null
  readonly outperformanceProbability: number | null
  readonly comparablePathCount: number
}

// ---------------------------------------------------------------------------
// Streaming per-path accumulator
// ---------------------------------------------------------------------------

export type PathMetricsAccumulator = {
  recordPeriod(
    contribution: number,
    neutralReturn: number,
    riskFreeRate: number,
  ): void
  finish(): {
    readonly annualizedVolatility: number
    readonly sharpeRatio: number
    readonly maxDrawdown: number
    readonly totalContributions: number
  }
}

// One accumulator per path, fed once per period by the runner. Time O(1) per
// recorded period, space O(1) per path — this is what makes metrics free to
// compute for ALL N paths, not just the retained ones.
//
// Factory-closure style rather than a class, matching createXoshiro128StarStar
// and the engine factories: the state words live in the closure, and the
// returned functions are the whole surface.
export function createPathMetricsAccumulator(
  periodsPerYear: number,
): PathMetricsAccumulator {
  // Running sums for the sample variance identity
  //   Var = (sumSq - n * mean^2) / (n - 1)   (ddof = 1, per the README).
  // Plain sums instead of Welford's update: weekly returns are ~1e-2 and
  // horizons are <= 1560 periods, so float64 cancellation error here is
  // negligible, and the two-sum form is what a student can check against a
  // spreadsheet's VAR.S directly.
  let periodCount = 0
  let sumNeutral = 0
  let sumSqNeutral = 0
  // Same two sums for the EXCESS return (neutral minus the period's sampled
  // risk-free rate) — the Sharpe ratio is defined on arithmetic excess
  // returns against the aligned risk-free series, not on raw returns.
  let sumExcess = 0
  let sumSqExcess = 0
  // Unitized index: start at 1 and compound ONLY the contribution-neutral
  // return. A DCA top-up therefore never "fills in" a drawdown — the index
  // tracks what one unit of money invested at period 0 experienced, which is
  // the only series on which "maximum drawdown" measures investment risk
  // rather than savings behavior.
  let unitizedIndex = 1
  let peakIndex = 1
  let maxDrawdown = 0
  let totalContributions = 0

  function recordPeriod(
    contribution: number,
    neutralReturn: number,
    riskFreeRate: number,
  ): void {
    periodCount += 1
    sumNeutral += neutralReturn
    sumSqNeutral += neutralReturn * neutralReturn

    const excess = neutralReturn - riskFreeRate
    sumExcess += excess
    sumSqExcess += excess * excess

    unitizedIndex *= 1 + neutralReturn
    if (unitizedIndex > peakIndex) {
      peakIndex = unitizedIndex
    }
    // Drawdown is measured from the running peak; the maximum over the path
    // is the deepest peak-to-trough loss an investor holding since period 0
    // would have sat through.
    const drawdown = 1 - unitizedIndex / peakIndex
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
    }

    totalContributions += contribution
  }

  function finish() {
    // Sample statistics need at least two observations for ddof = 1; a
    // one-period path has no defined volatility. NaN = "no observation".
    const variance =
      periodCount >= 2
        ? (sumSqNeutral - (sumNeutral * sumNeutral) / periodCount) /
          (periodCount - 1)
        : NaN
    // Annualize a periodic standard deviation by sqrt(periods per year):
    // variance of a sum of independent periods scales linearly with time, so
    // its square root scales with sqrt(time).
    const annualizedVolatility =
      Math.sqrt(Math.max(variance, 0)) * Math.sqrt(periodsPerYear)

    const excessVariance =
      periodCount >= 2
        ? (sumSqExcess - (sumExcess * sumExcess) / periodCount) /
          (periodCount - 1)
        : NaN
    const excessStdDev = Math.sqrt(Math.max(excessVariance, 0))
    // Sharpe = mean(excess) / std(excess), annualized by sqrt(p): the mean
    // scales with p and the std with sqrt(p), so the ratio scales with
    // sqrt(p). A zero-variance excess series (e.g. a constant-return fake
    // engine) has no defined risk-adjusted return — NaN, never Infinity.
    const sharpeRatio =
      excessStdDev > 0
        ? (sumExcess / periodCount / excessStdDev) * Math.sqrt(periodsPerYear)
        : NaN

    return {
      annualizedVolatility,
      sharpeRatio,
      maxDrawdown,
      totalContributions,
    }
  }

  return { recordPeriod, finish }
}

// ---------------------------------------------------------------------------
// Growth: CAGR (lump sum) and money-weighted IRR (recurring contributions)
// ---------------------------------------------------------------------------

// CAGR is only meaningful when nothing entered the portfolio after period 0:
// (W_T / W_0)^(1/years) - 1 is the constant annual rate that turns the single
// initial investment into the terminal wealth. NaN when undefined (nothing
// invested, non-positive terminal, or a failed path's NaN terminal).
export function computeCagr(
  initialInvestment: number,
  terminalWealth: number,
  years: number,
): number {
  if (
    !(initialInvestment > 0) ||
    !(terminalWealth > 0) ||
    !(years > 0) ||
    !Number.isFinite(terminalWealth)
  ) {
    return NaN
  }
  return (terminalWealth / initialInvestment) ** (1 / years) - 1
}

// Money-weighted return for a path with recurring contributions: the periodic
// rate r solving NPV(r) = sum_t CF_t / (1+r)^t = 0 over the path's ACTUAL
// dated external cash flows (investor perspective: contributions negative,
// terminal value positive). Returned ANNUALIZED as (1+r)^p - 1, or NaN when
// no finite admissible root exists — the metrics table renders that as N/A,
// per the Key Metrics Panel rule.
//
// Why bisection and why it is safe: with all outflows at t < T and one
// terminal inflow at t = T, the polynomial in x = 1/(1+r) has exactly one
// coefficient sign change, so by Descartes' rule there is exactly ONE root
// with x > 0, i.e. one admissible r > -1. Deterministic bracketed bisection
// finds it without Newton's divergence risk, keeping the result bit-stable
// for a given input — reproducibility is a product requirement here.
//
// Time complexity: O(T * log2(bracketWidth / tolerance)) per path — about
// 60-80 NPV evaluations of O(T) each. Space complexity: O(1) beyond the
// caller's cash-flow array.
export function computeAnnualizedIrr(
  // ArrayLike so the runner can hand in its reusable Float64Array scratch
  // buffer directly — no per-path copy of a possibly 1560-entry schedule.
  netCashFlows: ArrayLike<number>,
  periodsPerYear: number,
): number {
  let hasOutflow = false
  let hasInflow = false
  for (let t = 0; t < netCashFlows.length; t += 1) {
    const flow = netCashFlows[t]
    if (!Number.isFinite(flow)) return NaN
    if (flow < 0) hasOutflow = true
    if (flow > 0) hasInflow = true
  }
  // Without both a payment in and a payment out there is no rate to solve
  // for (e.g. a wiped-out path whose terminal value is 0: money only ever
  // went in, so every admissible r gives NPV < 0).
  if (!hasOutflow || !hasInflow) {
    return NaN
  }

  // NPV via Horner's rule in x = 1/(1+r): one multiply-add per period,
  // numerically stable, O(T) per evaluation.
  const npv = (rate: number): number => {
    const x = 1 / (1 + rate)
    let acc = 0
    for (let t = netCashFlows.length - 1; t >= 0; t -= 1) {
      acc = acc * x + netCashFlows[t]
    }
    return acc
  }

  // Bracket the single root: near r = -1 the terminal inflow's discount
  // factor explodes, so NPV -> +infinity; for large r every future flow
  // discounts to nothing and NPV -> CF_0 <= 0. Double the upper bound until
  // the sign flips (or give up: no finite admissible root).
  let lower = -0.999999
  if (!(npv(lower) > 0)) {
    return NaN
  }
  let upper = 1
  let expansions = 0
  while (npv(upper) > 0) {
    upper *= 2
    expansions += 1
    if (expansions > 60) {
      return NaN
    }
  }

  // Bisection: the bracket halves every iteration, so ~80 iterations pin the
  // periodic rate far below any displayable precision.
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const mid = (lower + upper) / 2
    if (npv(mid) > 0) {
      lower = mid
    } else {
      upper = mid
    }
    if (upper - lower < 1e-12) {
      break
    }
  }

  const periodicRate = (lower + upper) / 2
  // Geometric annualization: compounding the periodic rate over one year of
  // periods, consistent with how the risk-free column was de-annualized.
  return (1 + periodicRate) ** periodsPerYear - 1
}

// ---------------------------------------------------------------------------
// Cross-sectional summaries
// ---------------------------------------------------------------------------

// Reduce one per-path metric (length-N array, NaN = unavailable for that
// path) to p10/p50/p90 across paths. Time O(N log N) for the sort; space
// O(N) for the finite copy. Returns null when NO path produced a value, so
// the UI can render one honest N/A instead of NaN arithmetic.
export function summarizeAcrossPaths(
  perPathValues: Float64Array,
): MetricSummary | null {
  const finiteValues: number[] = []
  for (const value of perPathValues) {
    if (Number.isFinite(value)) {
      finiteValues.push(value)
    }
  }
  if (finiteValues.length === 0) {
    return null
  }
  finiteValues.sort((a, b) => a - b)
  return {
    p10: computeQuantile(finiteValues, 0.1),
    p50: computeQuantile(finiteValues, 0.5),
    p90: computeQuantile(finiteValues, 0.9),
    availablePathCount: finiteValues.length,
  }
}

// Terminal wealth at the five canonical levels, excluding failed (NaN)
// paths as "no observation". Same quantile rule as everywhere else, so this
// number and any future chart annotation for "p50 terminal wealth" agree
// exactly.
export function computeTerminalWealthPercentiles(
  terminalWealth: Float64Array,
): TerminalWealthPercentiles | null {
  const finiteValues: number[] = []
  for (const value of terminalWealth) {
    if (Number.isFinite(value)) {
      finiteValues.push(value)
    }
  }
  if (finiteValues.length === 0) {
    return null
  }
  finiteValues.sort((a, b) => a - b)
  return {
    p10: computeQuantile(finiteValues, 0.1),
    p25: computeQuantile(finiteValues, 0.25),
    p50: computeQuantile(finiteValues, 0.5),
    p75: computeQuantile(finiteValues, 0.75),
    p90: computeQuantile(finiteValues, 0.9),
  }
}

// Compare paired portfolio and benchmark terminal values. A path is usable
// only when both accounts completed with finite values; ties are not wins.
export function summarizeBenchmarkComparison(
  portfolioTerminalWealth: Float64Array,
  benchmarkTerminalWealth: Float64Array,
): BenchmarkMetrics {
  const terminalDifferences = new Float64Array(portfolioTerminalWealth.length)
  terminalDifferences.fill(NaN)
  let comparablePathCount = 0
  let outperformanceCount = 0

  for (
    let pathIndex = 0;
    pathIndex < portfolioTerminalWealth.length;
    pathIndex += 1
  ) {
    const portfolioValue = portfolioTerminalWealth[pathIndex]
    const benchmarkValue = benchmarkTerminalWealth[pathIndex]
    if (!Number.isFinite(portfolioValue) || !Number.isFinite(benchmarkValue)) {
      continue
    }

    const difference = portfolioValue - benchmarkValue
    terminalDifferences[pathIndex] = difference
    comparablePathCount += 1
    if (difference > 0) {
      outperformanceCount += 1
    }
  }

  return {
    terminalDifference: summarizeAcrossPaths(terminalDifferences),
    outperformanceProbability:
      comparablePathCount === 0
        ? null
        : outperformanceCount / comparablePathCount,
    comparablePathCount,
  }
}
