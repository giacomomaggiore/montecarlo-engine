// A benchmark starts with the same period-zero external investment as the
// portfolio. It has no weights, trades, or cash-flow policy of its own.
export function initializeBenchmark(initialInvestment: number): number {
  return initialInvestment
}

export type BenchmarkPeriodResult = {
  readonly value: number
  readonly contribution: number
}

// Apply the benchmark return before the portfolio's realised external cash
// flow. This matches the portfolio's end-of-period contribution convention.
export function stepBenchmarkPeriod(
  previousValue: number,
  benchmarkReturn: number,
  contribution: number,
): BenchmarkPeriodResult {
  return {
    value: previousValue * (1 + benchmarkReturn) + contribution,
    contribution,
  }
}
