import type { AlignedDataset } from '../data/datasetTypes'
import { createXoshiro128StarStar } from '../math/random'
import type { SimulationEngine } from './simulationEngine'

export const HISTORICAL_BOOTSTRAP_MODEL_VERSION = 'historical-bootstrap-v1'

export function createHistoricalBootstrapEngine(
  dataset: AlignedDataset,
  seed: number,
): SimulationEngine {
  const random = createXoshiro128StarStar(seed)

  function nextScenario() {
    const sourceRowIndex = random.nextInt(dataset.dates.length)

    return {
      assetReturns: dataset.assetReturns.map(
        (returns) => returns[sourceRowIndex],
      ),
      inflation: dataset.inflation[sourceRowIndex],
      riskFreeRate: dataset.riskFreeRates[sourceRowIndex],
      sourceRowIndex,
    }
  }

  return { nextScenario }
}
