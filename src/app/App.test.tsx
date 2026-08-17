import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAssetsCatalogueCacheForTests } from '../core/data/assetCatalogue'
import { App } from './App'

// The Engine page now fetches assets.json on mount (Phase 4.3); jsdom has no
// static file server, so the catalogue fetch is stubbed here.
function catalogueJson() {
  return {
    schemaVersion: 'assets-catalogue-v1',
    datasetVersion: 'usd-weekly-v1',
    baseCurrency: 'USD',
    assets: [
      {
        assetId: 'SPY',
        ticker: 'SPY',
        name: 'SPDR S&P 500 ETF Trust',
        assetClass: 'equity',
        history: {
          firstDate: '2005-01-02',
          lastDate: '2026-01-04',
          rowCount: 1000,
          meetsWeeklyMinimum: true,
        },
      },
    ],
  }
}

beforeEach(() => {
  resetAssetsCatalogueCacheForTests()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => catalogueJson(),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the Engine route with Run disabled until a valid portfolio exists', async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <App />
      </MemoryRouter>,
    )

    // The workspace appears once the catalogue fetch resolves.
    expect(
      await screen.findByLabelText('Search ETFs and assets'),
    ).toBeInTheDocument()
    // Phase 4 semantics: no holdings selected yet, so the inputs are invalid
    // and Run must be disabled (spec: "Disable Run while inputs or data are
    // invalid"), unlike the Phase 0-3 demo shell's always-runnable fixed
    // portfolio.
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it.each([
    ['/education', 'Educational'],
    ['/resources', 'External Resources'],
  ])('renders %s', (path, heading) => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[path]}
      >
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })
})
