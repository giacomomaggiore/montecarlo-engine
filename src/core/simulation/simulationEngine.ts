import type { PeriodScenario } from './simulationTypes'

export type SimulationEngine = {
  nextScenario(): PeriodScenario
}
