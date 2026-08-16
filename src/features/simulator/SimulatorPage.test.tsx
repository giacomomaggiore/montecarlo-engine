import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAssetsCatalogueCacheForTests } from '../../core/data/assetCatalogue'
import type { RunSimulationRequest } from './useSimulationWorker'
import { SimulatorPage } from './SimulatorPage'

// The Worker hook is mocked at the module boundary: these tests prove the
// PAGE's wiring (search -> select -> weight -> run produces the exact config
// the Worker protocol expects), not the Worker itself, which executeRun.test
// and the hook/reducer tests already cover.
const runMock = vi.fn<(request: RunSimulationRequest) => void>()
const cancelMock = vi.fn()
let mockState: unknown = { status: 'idle' }

vi.mock('./useSimulationWorker', () => ({
  useSimulationWorker: () => ({
    state: mockState,
    run: runMock,
    cancel: cancelMock,
  }),
}))

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
      {
        assetId: 'AGG',
        ticker: 'AGG',
        name: 'iShares Core U.S. Aggregate Bond ETF',
        assetClass: 'bond',
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

async function renderPage() {
  render(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <SimulatorPage />
    </MemoryRouter>,
  )
  // Wait for the catalogue fetch to resolve and the workspace to appear.
  return await screen.findByLabelText('Search ETFs and assets')
}

beforeEach(() => {
  mockState = { status: 'idle' }
  runMock.mockReset()
  cancelMock.mockReset()
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

describe('SimulatorPage — the search -> select -> weight -> run flow', () => {
  it('runs a one-asset portfolio with the spec defaults after picking it from search', async () => {
    const user = userEvent.setup()
    const search = await renderPage()

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    await user.type(search, 'sp')
    await user.click(
      screen.getByRole('button', {
        name: 'SPY - SPDR S&P 500 ETF Trust',
      }),
    )

    // First holding defaults to 100%, so the plan is immediately valid.
    expect(screen.getByText('Allocation total: 100.00%')).toBeInTheDocument()
    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(runButton).toBeEnabled()

    await user.click(runButton)
    expect(runMock).toHaveBeenCalledTimes(1)
    const request = runMock.mock.calls[0][0]
    // The exact derived plan: spec defaults (2,000 paths, 10 weekly years),
    // typed seed, single full-weight holding, bootstrap engine.
    expect(request.config).toEqual({
      weights: [1],
      initialInvestment: 10_000,
      cashFlow: { mode: 'lumpSum' },
      rebalancing: { mode: 'none' },
      paths: 2000,
      periods: 520,
      seed: 42,
    })
    expect(request.engineSelection).toEqual({ engine: 'bootstrap' })
  })

  it('places a total-allocation error beside the controls and disables Run until it is fixed', async () => {
    const user = userEvent.setup()
    const search = await renderPage()

    await user.type(search, 'e')
    await user.click(
      screen.getByRole('button', {
        name: 'SPY - SPDR S&P 500 ETF Trust',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'AGG - iShares Core U.S. Aggregate Bond ETF',
      }),
    )

    // SPY defaulted to 100 and AGG is blank: fill AGG with 30 -> total 130.
    await user.type(screen.getByLabelText('Allocation percent for AGG'), '30')
    expect(
      screen.getAllByText(/Allocations must total 100%/).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    // Rebalance to 70/30: the error disappears and Run unlocks.
    const spyWeight = screen.getByLabelText('Allocation percent for SPY')
    await user.clear(spyWeight)
    await user.type(spyWeight, '70')
    expect(screen.queryByText(/Allocations must total 100%/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  })

  it('shows parametric controls only for the Parametric engine and derives its options', async () => {
    const user = userEvent.setup()
    const search = await renderPage()
    await user.type(search, 'sp')
    await user.click(
      screen.getByRole('button', {
        name: 'SPY - SPDR S&P 500 ETF Trust',
      }),
    )

    expect(screen.queryByText('Parametric model')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Parametric' }))
    expect(screen.getByText('Parametric model')).toBeInTheDocument()

    // Manual nu outside [5, 100] blocks the run with a beside-control error.
    await user.click(screen.getByRole('radio', { name: 'Manual' }))
    const nuField = screen.getByLabelText(/Degrees of freedom \(5 to 100/)
    await user.clear(nuField)
    await user.type(nuField, '4')
    expect(
      screen.getAllByText('Degrees of freedom must be between 5 and 100.')
        .length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    await user.clear(nuField)
    await user.type(nuField, '8')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(runMock).toHaveBeenCalledTimes(1)
    expect(runMock.mock.calls[0][0].engineSelection).toEqual({
      engine: 'studentT',
      options: {
        annualInflation: 0.02,
        annualRiskFreeRate: 0.03,
        degreesOfFreedom: 8,
      },
    })
  })

  it('terminates an in-flight run when an input changes (spec: edits replace the worker)', async () => {
    const user = userEvent.setup()
    mockState = {
      status: 'running',
      runId: 'r1',
      pathsCompleted: 1,
      totalPaths: 2000,
    }
    const search = await renderPage()

    await user.type(search, 's')
    expect(cancelMock).not.toHaveBeenCalled()

    // The search box is presentational; a real INPUT edit must cancel.
    await user.type(screen.getByLabelText('Random seed'), '7')
    expect(cancelMock).toHaveBeenCalled()
  })
})
