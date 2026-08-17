import { describe, expect, it } from 'vitest'
import { initializeBenchmark, stepBenchmarkPeriod } from './benchmark'

describe('benchmark accumulator', () => {
  it('uses the same initial investment as the portfolio', () => {
    expect(initializeBenchmark(1_000)).toBe(1_000)
  })

  it('applies the return before an end-of-period DCA contribution', () => {
    const result = stepBenchmarkPeriod(1_000, 0.1, 100)

    // 1,000 grows to 1,100 before the new 100 enters the account.
    expect(result).toEqual({ value: 1_200, contribution: 100 })
  })

  it('accepts the portfolio value-averaging contribution without recalculating it', () => {
    const firstPeriod = stepBenchmarkPeriod(1_000, -0.1, 200)
    const secondPeriod = stepBenchmarkPeriod(firstPeriod.value, 0.05, 0)

    // The benchmark receives the portfolio's realised 200 then 0 cash
    // flows. Its own returns never affect that externally supplied schedule.
    expect(firstPeriod.value).toBe(1_100)
    expect(secondPeriod.value).toBe(1_155)
  })
})
