import type { QuantileSeries } from '../simulation/simulationTypes'

// One canonical percentile rule, used everywhere in the app so a chart value
// and a metrics-table value for "p50" always agree. This is the same method
// spreadsheets call PERCENTILE.INC and NumPy calls its default "linear" method.
export const QUANTILE_VERSION = 'quantile-linear-interpolation-v1'

export const QUANTILE_LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9] as const

// sortedAscendingValues must already be sorted and contain only finite numbers.
// h = (n - 1) * q locates the quantile between two order statistics, then we
// interpolate linearly between them.
export function computeQuantile(
  sortedAscendingValues: readonly number[],
  q: number,
): number {
  const n = sortedAscendingValues.length

  if (n === 0) {
    return NaN
  }

  if (n === 1) {
    return sortedAscendingValues[0]
  }

  const h = (n - 1) * q
  const lowerIndex = Math.floor(h)
  const upperIndex = Math.ceil(h)
  const lowerValue = sortedAscendingValues[lowerIndex]
  const upperValue = sortedAscendingValues[upperIndex]

  return lowerValue + (h - lowerIndex) * (upperValue - lowerValue)
}

// One sample per period: "every path's equity at period t". Aggregates across
// paths (the cross-section), never across a single path's own history.
export function computeQuantileSeries(
  periodSamples: readonly (readonly number[])[],
): QuantileSeries {
  const periodCount = periodSamples.length
  const p10 = new Float64Array(periodCount)
  const p25 = new Float64Array(periodCount)
  const p50 = new Float64Array(periodCount)
  const p75 = new Float64Array(periodCount)
  const p90 = new Float64Array(periodCount)

  for (let period = 0; period < periodCount; period += 1) {
    // Non-finite entries mark failed paths; they are excluded, not treated as zero.
    const finiteSorted = periodSamples[period]
      .filter((value) => Number.isFinite(value))
      .slice()
      .sort((a, b) => a - b)

    p10[period] = computeQuantile(finiteSorted, 0.1)
    p25[period] = computeQuantile(finiteSorted, 0.25)
    p50[period] = computeQuantile(finiteSorted, 0.5)
    p75[period] = computeQuantile(finiteSorted, 0.75)
    p90[period] = computeQuantile(finiteSorted, 0.9)
  }

  return { p10, p25, p50, p75, p90 }
}
