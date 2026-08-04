export type PlaceholderResult = {
  readonly engine: 'phase-0-placeholder'
  readonly terminalWealth: number
}

export function runPlaceholderSimulation(): PlaceholderResult {
  return {
    engine: 'phase-0-placeholder',
    terminalWealth: 100_000,
  }
}
