import { defineConfig } from '@playwright/test'

// A dedicated local server makes the browser smoke suite reproduce the same
// public-artifact fetches a deployed browser makes. The suite deliberately
// exercises a tiny one-asset run, keeping its runtime bounded while proving
// the full catalogue -> loader -> Worker -> result path.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env['CI'],
  },
})
