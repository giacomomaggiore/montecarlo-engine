import { createXoshiro128StarStar } from '../../core/math/random'
import type { RandomGenerator } from '../../core/math/random'
import type { AlignedDataset } from '../../core/data/datasetTypes'

// Phase 2 proves the Worker/chart architecture, not the production dataset.
// This is a synthetic stand-in for the real, versioned dataset the Dataset
// artifact gate will eventually load from public/data/*.f32 — the
// 'placeholder' marker in the version string is what stops a Phase 2 result
// from ever being mistaken for one produced by real historical data.
export const PLACEHOLDER_DATASET_VERSION = 'phase-2-placeholder-dataset-v1'

const PLACEHOLDER_SEED = 0x9a2f1c04
const ROW_COUNT = 312 // 6 years of weekly rows; comfortably above the 260-row minimum.
const FIRST_MONDAY = Date.parse('2015-01-05T00:00:00.000Z')
const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

// Two-asset return model: asset "GROWTH" behaves like a volatile equity
// index (higher mean, higher spread); asset "STABLE" behaves like a
// lower-volatility bond index. Mapping a uniform draw onto [mean - spread,
// mean + spread] is a placeholder for a real empirical distribution — it
// exists only to produce plausible, finite, > -100% weekly returns.
const ASSET_RETURN_SHAPES = [
  { assetId: 'PLACEHOLDER_GROWTH', meanReturn: 0.0018, spread: 0.03 },
  { assetId: 'PLACEHOLDER_STABLE', meanReturn: 0.0006, spread: 0.008 },
] as const

const INFLATION_MEAN = 0.0004
const INFLATION_SPREAD = 0.0006
const RISK_FREE_MEAN = 0.00035
const RISK_FREE_SPREAD = 0.0002

// Time complexity: O(ROW_COUNT * assetCount) to fill the return columns —
// this runs once at module load, never inside the paths * periods
// simulation loop. Space complexity: O(ROW_COUNT * assetCount) for the
// Float32Array columns, matching the on-disk column-major layout the real
// dataset will use.
export function createPlaceholderDataset(): AlignedDataset {
  const random = createXoshiro128StarStar(PLACEHOLDER_SEED)

  const dates = buildWeeklyDates(ROW_COUNT)
  const assetReturns = ASSET_RETURN_SHAPES.map(({ meanReturn, spread }) =>
    buildReturnColumn(random, meanReturn, spread),
  )
  const inflation = buildReturnColumn(random, INFLATION_MEAN, INFLATION_SPREAD)
  const riskFreeRates = buildReturnColumn(
    random,
    RISK_FREE_MEAN,
    RISK_FREE_SPREAD,
  )

  return {
    identity: {
      version: PLACEHOLDER_DATASET_VERSION,
      checksum: 'not-checksummed-placeholder-dataset',
      frequency: 'weekly',
      baseCurrency: 'USD',
    },
    assetIds: ASSET_RETURN_SHAPES.map((shape) => shape.assetId),
    dates,
    assetReturns,
    inflation,
    riskFreeRates,
  }
}

function buildWeeklyDates(rowCount: number): string[] {
  const dates = new Array<string>(rowCount)
  for (let i = 0; i < rowCount; i += 1) {
    dates[i] = new Date(FIRST_MONDAY + i * MILLISECONDS_PER_WEEK)
      .toISOString()
      .slice(0, 10)
  }
  return dates
}

function buildReturnColumn(
  random: RandomGenerator,
  meanReturn: number,
  spread: number,
): Float32Array {
  const column = new Float32Array(ROW_COUNT)
  for (let i = 0; i < ROW_COUNT; i += 1) {
    // nextUniform() is in [0, 1); rescale to [mean - spread, mean + spread).
    column[i] = meanReturn + spread * (2 * random.nextUniform() - 1)
  }
  return column
}
