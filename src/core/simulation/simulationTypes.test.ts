import { describe, expect, it } from 'vitest'
import {
  MAX_SIMULATION_WORK,
  type CashFlowConfig,
  type SimulationConfig,
  validateSimulationConfig,
} from './simulationTypes'

describe('validateSimulationConfig', () => {
  it.each<CashFlowConfig>([
    { mode: 'lumpSum' },
    { mode: 'dca', amount: 100 },
    { mode: 'valueAveraging', targetIncrease: 100 },
  ])('accepts %o', (cashFlow) => {
    const result = validateSimulationConfig(
      createConfig({ cashFlow }),
      2,
      'weekly',
    )

    expect(result.ok).toBe(true)
  })

  it('accepts both unsigned 32-bit seed boundaries', () => {
    expect(
      validateSimulationConfig(createConfig({ seed: 0 }), 2, 'weekly').ok,
    ).toBe(true)
    expect(
      validateSimulationConfig(createConfig({ seed: 0xffff_ffff }), 2, 'weekly')
        .ok,
    ).toBe(true)
  })

  it('accepts the work-budget boundary', () => {
    const result = validateSimulationConfig(
      createConfig({ paths: 50_000, periods: MAX_SIMULATION_WORK / 50_000 }),
      2,
      'weekly',
    )

    expect(result.ok).toBe(true)
  })

  it.each([
    [
      'a weight count that does not match assets',
      createConfig({ weights: [1] }),
      2,
      'weekly' as const,
      'config.weights.count',
    ],
    [
      'negative weights',
      createConfig({ weights: [1.1, -0.1] }),
      2,
      'weekly' as const,
      'config.weights.values',
    ],
    [
      'weights that do not total 100%',
      createConfig({ weights: [0.6, 0.3] }),
      2,
      'weekly' as const,
      'config.weights.total',
    ],
    [
      'a negative initial investment',
      createConfig({ initialInvestment: -1 }),
      2,
      'weekly' as const,
      'config.initialInvestment',
    ],
    [
      'a negative DCA amount',
      createConfig({ cashFlow: { mode: 'dca', amount: -1 } }),
      2,
      'weekly' as const,
      'config.cashFlow.amount',
    ],
    [
      'a negative value-averaging increase',
      createConfig({
        cashFlow: { mode: 'valueAveraging', targetIncrease: -1 },
      }),
      2,
      'weekly' as const,
      'config.cashFlow.targetIncrease',
    ],
    [
      'a seed outside unsigned 32-bit range',
      createConfig({ seed: 0x1_0000_0000 }),
      2,
      'weekly' as const,
      'config.seed',
    ],
    [
      'a horizon above 30 weekly years',
      createConfig({ periods: 1_561 }),
      2,
      'weekly' as const,
      'config.periods',
    ],
    [
      'more than 50,000 paths',
      createConfig({ paths: 50_001 }),
      2,
      'weekly' as const,
      'config.paths',
    ],
    [
      'work above the global limit',
      createConfig({ paths: 50_000, periods: 201 }),
      2,
      'weekly' as const,
      'config.work',
    ],
  ])(
    'rejects %s',
    (_description, config, assetCount, frequency, expectedCode) => {
      const result = validateSimulationConfig(config, assetCount, frequency)

      expect(errorCodes(result)).toContain(expectedCode)
    },
  )
})

function createConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return {
    weights: [0.6, 0.4],
    initialInvestment: 10_000,
    cashFlow: { mode: 'lumpSum' },
    paths: 2_000,
    periods: 520,
    seed: 1,
    ...overrides,
  }
}

function errorCodes(result: {
  readonly ok: boolean
  readonly errors?: readonly { code: string }[]
}): readonly string[] {
  return result.ok ? [] : (result.errors ?? []).map((error) => error.code)
}
