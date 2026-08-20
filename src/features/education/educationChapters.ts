import { lazy, type ComponentType } from 'react'

const FoundationsChapter = lazy(() => import('./chapters/foundations.mdx'))
const MarketDataChapter = lazy(() => import('./chapters/market-data.mdx'))
const MetricsChapter = lazy(() => import('./chapters/metrics.mdx'))
const NumericalSafetyChapter = lazy(
  () => import('./chapters/numerical-safety.mdx'),
)
const SimulationModelsChapter = lazy(
  () => import('./chapters/simulation-models.mdx'),
)
const StatisticsChapter = lazy(() => import('./chapters/statistics.mdx'))

export type EducationChapter = {
  readonly slug: string
  readonly title: string
  readonly Content: ComponentType
}

export const EDUCATION_CHAPTERS: readonly EducationChapter[] = [
  {
    slug: 'foundations',
    title: 'Financial Foundations',
    Content: FoundationsChapter,
  },
  {
    slug: 'market-data',
    title: 'Market Data',
    Content: MarketDataChapter,
  },
  {
    slug: 'statistics',
    title: 'Probability and Stats',
    Content: StatisticsChapter,
  },
  {
    slug: 'numerical-safety',
    title: 'Numerical Safety',
    Content: NumericalSafetyChapter,
  },
  {
    slug: 'simulation-models',
    title: 'Simulation Methods',
    Content: SimulationModelsChapter,
  },
  {
    slug: 'metrics',
    title: 'Portfolio Construction and Risk',
    Content: MetricsChapter,
  },
]

export function findEducationChapter(
  slug: string | undefined,
): EducationChapter | undefined {
  return EDUCATION_CHAPTERS.find((chapter) => chapter.slug === slug)
}
