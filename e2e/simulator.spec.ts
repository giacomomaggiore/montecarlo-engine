import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Pick one real released asset, then shrink the otherwise user-facing
// defaults for a quick deterministic end-to-end smoke run. This is a browser
// test of the transport path; numerical correctness stays in core unit tests.
async function configureSmallBootstrapRun(page: Page, ticker = 'SPY') {
  await page.goto('/')
  await expect(page.getByLabel('Search ETFs and assets')).toBeVisible()

  await page.getByLabel('Search ETFs and assets').fill(ticker)
  await page.getByRole('button', { name: new RegExp(`^${ticker} -`) }).click()
  await page.getByLabel('Simulated paths').fill('10')
  await page.getByLabel('Horizon (years)').fill('1')
}

test('routes render their intended pages', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Engine' })).toBeVisible()

  await page.goto('/education')
  await expect(page.getByRole('heading', { name: 'Educational' })).toBeVisible()

  await page.goto('/resources')
  await expect(
    page.getByRole('heading', { name: 'External Resources' }),
  ).toBeVisible()
})

test('runs Bootstrap against the released browser artifacts and renders results', async ({
  page,
}) => {
  await configureSmallBootstrapRun(page)
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled()

  await page.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
  await expect(
    page.getByText(/Completed run: historical-bootstrap-v1/),
  ).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download Terminal outcomes CSV' })
    .click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/terminal-outcomes\.csv$/)
})

test('selects and runs newly released QUAL from the expanded USD catalogue', async ({
  page,
}) => {
  await configureSmallBootstrapRun(page, 'QUAL')
  await page.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
  await expect(page.getByText(/QUAL/).first()).toBeVisible()
})

test('runs DCA with transaction costs and capital-gains tax', async ({
  page,
}) => {
  await configureSmallBootstrapRun(page)
  await page.getByLabel('DCA (fixed contribution each period)').check()
  await page
    .getByLabel('Contribution per period (USD, end of period)')
    .fill('100')
  await page.getByLabel('Fixed cost per executed order (USD)').fill('1')
  await page.getByLabel('Proportional transaction cost (%)').fill('0.1')
  await page.getByLabel('Capital-gains tax rate (%)').fill('20')

  await page.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
  await expect(page.getByText('Cumulative transaction costs')).toBeVisible()
  await expect(page.getByText('Capital-gains tax paid')).toBeVisible()
  await expect(page.getByText(/fixed order cost \$1.*tax 20.0%/)).toBeVisible()
})

test('runs weekly leverage and renders retained-path leverage evidence', async ({
  page,
}) => {
  await configureSmallBootstrapRun(page)
  await page.getByLabel('Enable weekly margin leverage').check()
  await page.getByLabel(/Target gross exposure/).fill('2')
  await page.getByLabel('Maintenance margin (%)').fill('40')
  await page.getByLabel('Annual borrowing spread (%)').fill('1')
  await page.getByRole('button', { name: 'Run' }).click()

  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
  await expect(page.getByText('Cumulative borrowing interest')).toBeVisible()
  await page.getByLabel('Path to inspect').selectOption('0')
  await expect(
    page.getByRole('heading', { name: 'Weekly leverage ratio' }),
  ).toBeVisible()
  await expect(page.getByLabel('Weekly leverage ratio chart')).toBeVisible()
})

test('cancels a still-running large simulation', async ({ page }) => {
  await configureSmallBootstrapRun(page)
  // 19,000 x 52 is within the 10,000,000-work cap but long enough that the
  // button click below normally reaches the Worker before it can complete.
  await page.getByLabel('Simulated paths').fill('19000')
  await page.getByRole('button', { name: 'Run' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Run cancelled.')).toBeVisible()
})
