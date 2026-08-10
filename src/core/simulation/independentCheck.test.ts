import { describe, expect, it } from 'vitest'
import type { AlignedDataset } from '../data/datasetTypes'
import { stepPortfolioPeriod } from '../portfolio/cashFlows'
import { createHistoricalBootstrapEngine } from './historicalBootstrap'
import { runSimulation } from './runSimulation'
import type { CashFlowConfig, SimulationConfig } from './simulationTypes'

// Phase 1.6 completion gate: prove the engine against numbers that were not
// derived by reading this file's own logic. validation/phase_1_6_independent_check.py
// reimplements xoshiro128** and the accounting rules from the README's prose
// alone, in a second language, and prints the period-by-period trace pasted
// below as EXPECTED_* constants. If a bug were symmetric — the same mistake
// made here and in a same-language hand-calculated test — this cross-check
// over a second, independent implementation is what would still catch it.

const WEIGHTS = [0.6, 0.4]
const INITIAL_INVESTMENT = 1000
const PERIODS = 4

function createDataset(): AlignedDataset {
  return {
    identity: {
      version: 'independent-check-v1',
      checksum: 'independent-check',
      frequency: 'weekly',
      baseCurrency: 'USD',
    },
    assetIds: ['A', 'B'],
    dates: [
      '2024-01-05',
      '2024-01-12',
      '2024-01-19',
      '2024-01-26',
      '2024-02-02',
      '2024-02-09',
    ],
    // Distinctive, non-repeating per-row values: a wrong row draw cannot
    // accidentally reproduce the right numbers.
    assetReturns: [
      new Float32Array([0.05, -0.03, 0.02, 0.1, -0.07, 0.01]),
      new Float32Array([-0.02, 0.04, 0.01, -0.05, 0.03, 0.02]),
    ],
    inflation: new Float32Array([0.001, 0.002, 0.0015, 0.003, 0.0025, 0.002]),
    riskFreeRates: new Float32Array([
      0.0002, 0.0002, 0.0002, 0.0002, 0.0002, 0.0002,
    ]),
  }
}

type ExpectedPeriod = {
  readonly sourceRowIndex: number
  readonly contribution: number
  readonly neutralReturn: number
  readonly holdings: readonly [number, number]
  readonly equity: number
}

// Pasted verbatim from validation/phase_1_6_independent_check.py's stdout
// (values already reflect the same Float32 rounding a Float32Array read
// would apply — see f32() in that script — so this is a like-for-like
// comparison, not floating-point noise from comparing float32 to float64).
const LUMP_SUM_SEED = 42
const EXPECTED_LUMP_SUM: readonly ExpectedPeriod[] = [
  {
    sourceRowIndex: 0,
    contribution: 0,
    neutralReturn: 0.022000000625848726,
    holdings: [630.0000004470348, 392.00000017881393],
    equity: 1022.0000006258488,
  },
  {
    sourceRowIndex: 1,
    contribution: 0,
    neutralReturn: -0.0031506848652779196,
    holdings: [611.1000008560717, 407.6799998354912],
    equity: 1018.7800006915629,
  },
  {
    sourceRowIndex: 2,
    contribution: 0,
    neutralReturn: 0.015998350615545887,
    holdings: [623.3220006000101, 411.7567997427225],
    equity: 1035.0788003427326,
  },
  {
    sourceRowIndex: 0,
    contribution: 0,
    neutralReturn: 0.02215383473802568,
    holdings: [654.4881010944217, 403.52166393193767],
    equity: 1058.0097650263594,
  },
]

const DCA_SEED = 7
const DCA_CASH_FLOW: CashFlowConfig = { mode: 'dca', amount: 100 }
const EXPECTED_DCA: readonly ExpectedPeriod[] = [
  {
    sourceRowIndex: 0,
    contribution: 100,
    neutralReturn: 0.022000000625848726,
    holdings: [690.0000004470348, 432.00000017881393],
    equity: 1122.0000006258488,
  },
  {
    sourceRowIndex: 5,
    contribution: 100,
    neutralReturn: 0.013850267069547728,
    holdings: [756.9000002972782, 480.6399999892712],
    equity: 1237.5400002865495,
  },
  {
    sourceRowIndex: 5,
    contribution: 100,
    neutralReturn: 0.01388383374657498,
    holdings: [824.4690001310706, 530.2527997741938],
    equity: 1354.7217999052646,
  },
  {
    sourceRowIndex: 2,
    contribution: 100,
    neutralReturn: 0.016085891224899562,
    holdings: [900.9583797651256, 575.555327653415],
    equity: 1476.5137074185407,
  },
]

const VALUE_AVERAGING_SEED = 123
const VALUE_AVERAGING_CASH_FLOW: CashFlowConfig = {
  mode: 'valueAveraging',
  targetIncrease: 80,
}
const EXPECTED_VALUE_AVERAGING: readonly ExpectedPeriod[] = [
  {
    sourceRowIndex: 1,
    contribution: 81.99999995529652,
    neutralReturn: -0.0019999999552965386,
    holdings: [631.2000003755093, 448.79999962449074],
    equity: 1080.0,
  },
  {
    sourceRowIndex: 1,
    contribution: 80.9840000042916,
    neutralReturn: -0.000911111115084795,
    holdings: [660.8544007900715, 499.14559920992855],
    equity: 1160.0,
  },
  {
    sourceRowIndex: 1,
    contribution: 79.85980805843838,
    neutralReturn: 0.00012085512203596771,
    holdings: [688.9446540445698, 551.0553459554301],
    equity: 1240.0,
  },
  {
    sourceRowIndex: 4,
    contribution: 111.69446597928982,
    neutralReturn: -0.025560053209104705,
    holdings: [707.7352076437023, 612.2647923562976],
    equity: 1320.0,
  },
]

function assertMatchesIndependentTrace(
  seed: number,
  cashFlow: CashFlowConfig,
  expected: readonly ExpectedPeriod[],
) {
  const dataset = createDataset()
  const engine = createHistoricalBootstrapEngine(dataset, seed)
  let holdings: readonly number[] = [
    (INITIAL_INVESTMENT * WEIGHTS[0]) as number,
    (INITIAL_INVESTMENT * WEIGHTS[1]) as number,
  ]

  for (let periodIndex = 1; periodIndex <= PERIODS; periodIndex += 1) {
    const scenario = engine.nextScenario()
    const result = stepPortfolioPeriod(
      holdings,
      scenario,
      cashFlow,
      WEIGHTS,
      periodIndex,
      INITIAL_INVESTMENT,
    )
    const want = expected[periodIndex - 1]

    expect(scenario.sourceRowIndex).toBe(want.sourceRowIndex)
    expect(result.contribution).toBeCloseTo(want.contribution, 6)
    expect(result.neutralReturn).toBeCloseTo(want.neutralReturn, 6)
    expect(result.holdings[0]).toBeCloseTo(want.holdings[0], 6)
    expect(result.holdings[1]).toBeCloseTo(want.holdings[1], 6)
    expect(result.equity).toBeCloseTo(want.equity, 6)

    holdings = result.holdings
  }

  // The manual loop above and runSimulation must agree: this is the same
  // guarantee Phase 1.5 relies on (an engine plugs into an unmodified runner)
  // checked here against externally-derived numbers, not just against itself.
  const config: SimulationConfig = {
    weights: WEIGHTS,
    initialInvestment: INITIAL_INVESTMENT,
    cashFlow,
    paths: 1,
    periods: PERIODS,
    seed,
  }
  const runnerResult = runSimulation({
    engine: createHistoricalBootstrapEngine(dataset, seed),
    dataset,
    config,
    modelVersion: 'historical-bootstrap-v1',
    prngVersion: 'xoshiro128**-v1',
  })
  if (!runnerResult.ok) throw new Error('expected a successful run')
  expect(runnerResult.value.retainedPaths[0].values[PERIODS]).toBeCloseTo(
    expected[PERIODS - 1].equity,
    6,
  )
}

describe('independent Python cross-check (Phase 1.6)', () => {
  it('matches the independently computed lump-sum trace', () => {
    assertMatchesIndependentTrace(
      LUMP_SUM_SEED,
      { mode: 'lumpSum' },
      EXPECTED_LUMP_SUM,
    )
  })

  it('matches the independently computed DCA trace', () => {
    assertMatchesIndependentTrace(DCA_SEED, DCA_CASH_FLOW, EXPECTED_DCA)
  })

  it('matches the independently computed value-averaging trace', () => {
    assertMatchesIndependentTrace(
      VALUE_AVERAGING_SEED,
      VALUE_AVERAGING_CASH_FLOW,
      EXPECTED_VALUE_AVERAGING,
    )
  })
})
