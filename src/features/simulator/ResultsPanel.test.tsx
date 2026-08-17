import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { SimulationResult } from '../../core/simulation/simulationTypes'
import { ResultsPanel } from './ResultsPanel'

// uPlot needs a real canvas; jsdom has none. The chart's pure data mapping is
// covered by chartData.test.ts, so the component is stubbed here and these
// tests cover everything AROUND it: label, tables, inspector.
vi.mock('./PortfolioChart', () => ({
  PortfolioChart: () => <div data-testid="chart-stub" />,
}))

function fixtureResult(): SimulationResult {
  return {
    metadata: {
      config: {
        weights: [1],
        initialInvestment: 1000,
        cashFlow: { mode: 'lumpSum' },
        paths: 2,
        periods: 2,
        seed: 9,
      },
      dataset: {
        version: 'usd-weekly-v1',
        checksum: 'sha256:fixture',
        frequency: 'weekly',
        baseCurrency: 'USD',
      },
      portfolioAssetIds: ['AAA'],
      datasetDates: ['2020-01-05', '2020-01-12', '2020-01-19'],
      benchmarkAssetId: null,
      algorithms: {
        model: 'historical-bootstrap-v1',
        prng: 'xoshiro128**-v1',
        quantile: 'quantile-linear-interpolation-v1',
        metrics: 'metrics-v1',
      },
    },
    terminalWealth: new Float64Array([1210, 900]),
    benchmarkTerminalWealth: null,
    metrics: {
      terminalWealth: {
        p10: 931,
        p25: 977.5,
        p50: 1055,
        p75: 1132.5,
        p90: 1179,
      },
      lossProbability: 0.5,
      ruinProbability: 0,
      growth: {
        kind: 'cagr',
        summary: {
          p01: 0.05,
          p10: 0.05,
          p50: 0.1,
          p90: 0.15,
          p99: 0.15,
          availablePathCount: 2,
        },
      },
      annualizedVolatility: {
        p01: 0.1,
        p10: 0.1,
        p50: 0.12,
        p90: 0.14,
        p99: 0.14,
        availablePathCount: 2,
      },
      sharpeRatio: null,
      maxDrawdown: {
        p01: 0.02,
        p10: 0.02,
        p50: 0.05,
        p90: 0.09,
        p99: 0.09,
        availablePathCount: 2,
      },
      transactionCosts: {
        p01: 1,
        p10: 1,
        p50: 2,
        p90: 3,
        p99: 3,
        availablePathCount: 2,
      },
      realizedGainLoss: {
        p01: -1,
        p10: -1,
        p50: 1,
        p90: 3,
        p99: 3,
        availablePathCount: 2,
      },
      taxesPaid: {
        p01: 0,
        p10: 0,
        p50: 1,
        p90: 2,
        p99: 2,
        availablePathCount: 2,
      },
      lossCarryforward: {
        p01: 0,
        p10: 0,
        p50: 1,
        p90: 2,
        p99: 2,
        availablePathCount: 2,
      },
      benchmark: null,
    },
    representativePaths: [
      {
        quantileLevel: 0.5,
        pathIndex: 0,
        terminalWealth: 1210,
        values: new Float64Array([1000, 1100, 1210]),
        // 10% inflation per period: the nominal 1210 is worth exactly 1000
        // in period-0 purchasing power.
        priceLevels: new Float64Array([1, 1.1, 1.21]),
      },
    ],
    retainedPaths: [
      {
        pathIndex: 0,
        values: new Float64Array([1000, 1100, 1210]),
        contributions: new Float64Array([0, 0, 0]),
        priceLevels: new Float64Array([1, 1.1, 1.21]),
        trades: [[], [], []],
        executedTrades: [[], [], []],
        transactionCosts: new Float64Array([0, 1, 2]),
        realizedGainLosses: new Float64Array([0, 3, 4]),
        taxesPaid: new Float64Array([0, 1, 1]),
        costBases: new Float64Array([1000, 1050, 1100]),
        lossCarryforwards: new Float64Array([0, 0, 0]),
        scenarios: [
          {
            assetReturns: [0.1],
            inflation: 0.0953,
            riskFreeRate: 0.001,
            sourceRowIndex: 1,
          },
          {
            assetReturns: [0.1],
            inflation: 0.0953,
            riskFreeRate: 0.001,
            sourceRowIndex: 2,
          },
        ],
      },
    ],
    failures: [],
  }
}

function renderPanel(displayMode: 'nominal' | 'real' = 'nominal') {
  return render(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <ResultsPanel displayMode={displayMode} result={fixtureResult()} />
    </MemoryRouter>,
  )
}

describe('ResultsPanel', () => {
  it('labels the completed run with its own metadata, not the live form state', () => {
    renderPanel()
    const label = screen.getByText(/Completed run:/)
    expect(label.textContent).toContain('historical-bootstrap-v1')
    expect(label.textContent).toContain('seed 9')
    expect(label.textContent).toContain('usd-weekly-v1')
    expect(label.textContent).toContain('do not apply until the next run')
  })

  it('renders metric medians and an N/A with its reason for an unavailable metric', () => {
    renderPanel()
    // Median CAGR 10% (also volatility's p01/p10 in this fixture).
    expect(screen.getAllByText('10.0%').length).toBeGreaterThan(0)
    // Sharpe is null in the fixture: the row must say WHY, not just "N/A".
    expect(
      screen.getByText(/N\/A — excess returns had zero variance/),
    ).toBeInTheDocument()
    // Probabilities with the ruin explanation.
    expect(
      screen.getByText(/50.0% of paths ended below the total amount paid in/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/structurally zero until leverage exists/),
    ).toBeInTheDocument()
    expect(screen.getByText('Cumulative transaction costs')).toBeInTheDocument()
    expect(screen.getByText('Capital-gains tax paid')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader', { name: 'p01' }).length).toBe(1)
    expect(screen.getAllByRole('columnheader', { name: 'p99' }).length).toBe(1)
    expect(
      screen.queryByText('Terminal wealth after final liquidation (nominal)'),
    ).not.toBeInTheDocument()
  })

  it('shows nominal terminal values by default and per-path deflated values in real mode', () => {
    const { unmount } = renderPanel('nominal')
    const nominalTable = screen.getByText(/Chart lines as a table \(nominal/)
    expect(
      within(nominalTable.closest('table') as HTMLElement).getByText('$1,210'),
    ).toBeInTheDocument()
    unmount()

    renderPanel('real')
    const realTable = screen.getByText(/Chart lines as a table \(real/)
    // 1210 / 1.21 = 1000 of period-0 purchasing power.
    expect(
      within(realTable.closest('table') as HTMLElement).getByText('$1,000'),
    ).toBeInTheDocument()
  })

  it('lets the user inspect a retained path and maps bootstrap rows to historical weeks', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.selectOptions(screen.getByLabelText('Path to inspect'), '0')

    const table = screen
      .getByText(/Path 0, period by period/)
      .closest('table') as HTMLElement
    // Period 1 was resampled from the aligned row 1 = 2020-01-12; period 2
    // from row 2 = 2020-01-19. Period 0 has no sampled week.
    expect(within(table).getByText('2020-01-12')).toBeInTheDocument()
    expect(within(table).getByText('2020-01-19')).toBeInTheDocument()
    expect(within(table).getAllByText('$1,100').length).toBeGreaterThan(0)
    expect(within(table).getByText('Executed orders')).toBeInTheDocument()
    expect(within(table).getByText('Loss carryforward')).toBeInTheDocument()
  })

  it('downloads terminal outcomes from the immutable completed result', async () => {
    const user = userEvent.setup()
    const blobParts: unknown[] = []
    const createObjectURL = vi.fn(() => 'blob:terminal-outcomes')
    const revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    class BlobStub {
      constructor(parts: readonly unknown[]) {
        blobParts.push(...parts)
      }
    }

    vi.stubGlobal('Blob', BlobStub)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    try {
      renderPanel()
      await user.click(
        screen.getByRole('button', { name: 'Download Terminal outcomes CSV' }),
      )

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(blobParts.join('')).toContain('path_index')
      expect(blobParts.join('')).toContain('0,"completed",1210')
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:terminal-outcomes')
    } finally {
      click.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
