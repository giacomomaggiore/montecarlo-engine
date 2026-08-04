import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('shows a placeholder result when Run is selected', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <App />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Run' }))

    expect(screen.getByLabelText('Simulation result')).toHaveTextContent(
      '"terminalWealth": 100000',
    )
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
