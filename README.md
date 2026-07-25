# Asset Allocation Monte Carlo Simulator

## Project Vision
* Build a Monte Carlo simulator specifically for retail investors.
* Run all calculations directly in the browser.
* Keep infrastructure costs at zero by using static hosting.
* Protect user privacy by never sending data to a server.
* Provide a fast, interactive, real-time user interface.

## Main Goals
* Use modern web technologies such as Web Workers and typed arrays to run thousands of simulations without freezing the interface.
* Implement accurate mathematical models for asset correlation and risk metrics.
* Update charts and data instantly when the user changes inputs like portfolio weights or time horizons.
* Use a curated dataset to keep download sizes small and optimize performance.

## Data Architecture
* **Selected Dataset:**
  * Avoid downloading the entire stock market.
  * Ship manifest-described, little-endian `Float32` binary files containing 200 to 300 popular tickers and ETFs.
  * Rely on HTTP compression from the static host. Do not parse Parquet or large JSON return matrices in the browser.
* **Backfilling via Asset-Class Proxy:**
  * Handle new ETFs that lack long historical data.
  * Map new funds to their parent index to fill in missing past data.
  * Example: Use MSCI World data to simulate the history of a recent global ETF during the 2008 and 2000 crashes.
  * Record the proxy, splice date, and backfill method in `assets.json`. The educational page discloses that proxy backfills are used.
* **Data Frequency:**
  * Set monthly data as the default for the best balance of speed and long-term accuracy.
  * Offer weekly data as an advanced option and require it whenever leverage is enabled.
* **Currency:**
  * Let users choose USD or EUR as the portfolio base currency.
  * Prepare separate return matrices for each base currency. Returns must include currency conversion before they reach the browser.
* **Inflation and Risk-Free Rates:**
  * Include historical Consumer Price Index (CPI) and risk-free rate data.
  * Allow users to switch between nominal returns and real, inflation-adjusted returns.
  * Use base-currency series: CPI and EFFR for USD; HICP and a prepared EUR short-rate series for EUR.

## Simulation Engines
* **Historical Joint Bootstrap:**
  * Build one aligned matrix for the selected assets, inflation, and rates. Remove any row containing a missing required value after proxy backfilling.
  * Sample complete rows with replacement. Never sample each asset independently.
  * Preserve contemporaneous cross-asset dependence and empirical one-period outcomes. Independent row sampling does not preserve serial dependence, volatility clustering, or crisis duration.
* **Parametric Student's $t$ Simulation:**
  * Fit the model to aligned periodic log total returns.
  * Let users choose historical annualized geometric returns or enter annual geometric returns for each asset.
  * Estimate one shared degrees-of-freedom value from pooled standardized historical residuals using excess kurtosis: $\nu = 4 + 6 / \gamma_2$. Clamp $\nu$ to $[5, 100]$ and use $\nu = 100$ when excess kurtosis is not positive.
  * Convert covariance $\Sigma$ to the Student's $t$ scale matrix $S = \Sigma(\nu - 2) / \nu$.
  * Apply Higham's nearest-correlation algorithm while preserving asset variances, then use Cholesky decomposition with a documented numerical tolerance.
  * Convert generated log returns back to simple returns before portfolio accounting.
* **Future Markov-Chain Simulation:**
  * Add this engine after the historical bootstrap and parametric engines are validated.
  * Model a small number of market regimes and sample the next regime from a transition matrix. Draw the period's joint asset returns, inflation, and rate from the selected regime.
  * This can preserve regime persistence and crisis duration, unlike independent historical bootstrap sampling.
  * Use the same aligned historical matrix, common-period rules, portfolio accounting, worker, charts, exports, and simulation limits as the other engines.

## Portfolio Logic and Cash Flows
* **Contributions:** Allow users to choose between an initial lump sum and a recurring contribution made at the end of every simulation period. Contributions do not earn the return of the period in which they are added.
* **Taxes:**
  * Use one user-entered capital-gains tax rate and average cost basis for each asset.
  * Apply tax to sales caused by rebalancing, margin calls, and final liquidation. Dividends are reinvested through total returns and are not taxed separately.
  * Carry realized losses forward within each path to offset later realized gains. Do not generate tax refunds.
  * Deduct tax immediately after a taxable sale and report after-tax terminal wealth following final liquidation.
* **Rebalancing Methods:**
  * **Time-based:** Rebalance after a user-entered number of simulation periods.
  * **Tolerance Bands:** Rebalance when an asset differs from its target by a user-entered number of percentage points. Evaluate bands once per period after contributions and forced margin actions.
* **Leverage Options:**
  * Support long-only portfolios with target gross exposure from 1x to 4x. Asset target weights sum to the selected gross exposure.
  * Warn that 4x starts exactly at the 25% maintenance threshold and therefore has no margin-call buffer.
  * Define debt as gross asset value minus equity and maintenance margin as equity divided by gross asset value.
  * Charge the base-currency short rate plus a user-entered spread on debt.
  * Support time-based and tolerance-band leverage-resetting strategies.
  * Check margin every weekly simulation period. If maintenance margin falls below 25%, sell assets proportionally until target leverage is restored after tax and costs.
  * Do not model cash deposits during a margin call. If equity is non-positive or target leverage cannot be restored, mark the path insolvent with zero terminal wealth.
* **Transaction Costs:** Apply both a fixed base-currency cost per nonzero asset order and a percentage of absolute trade value. Buy costs increase cost basis; sell costs reduce proceeds.

For every simulation period, apply operations in this order:
1. Apply asset returns and borrowing interest.
2. Add the scheduled contribution.
3. Check maintenance margin and execute forced deleveraging when required.
4. Evaluate time-based or tolerance-band rebalancing.
5. Execute trades, update average cost basis, and deduct transaction costs and realized-gain tax.
6. Record end-of-period holdings, debt, wealth, and metrics.

## Visualization and Metrics
* **Optimized Charts:**
  * Avoid heavy "spaghetti plots" that slow down the browser.
  * Display a quantile band chart showing the 10th, 25th, 50th, 75th, and 90th percentiles.
  * Limit the display to a maximum of 50 individual line paths.
* **Interactive Highlights:**
  * Allow users to click retained individual paths and inspect their returns, drawdowns, trades, taxes, and historical row selections.
  * Treat percentile bands as aggregate statistics, not individual paths. Do not make them path-selectable.
* **Key Metrics Panel:**
  * Show compound annual growth rate (CAGR) only for lump-sum paths without later contributions. Show money-weighted return (IRR) when recurring contributions are enabled.
  * Compute volatility from contribution-neutral periodic portfolio returns using sample standard deviation and annualize by $\sqrt{12}$ or $\sqrt{52}$.
  * Compute the Sharpe ratio from arithmetic excess returns using the aligned period risk-free series.
  * Compute maximum drawdown from a unitized portfolio index so that contributions do not appear as investment gains.
  * Calculate percentiles with linear interpolation and use the same method throughout the application.
* **Data Export:**
  * Export settings, seed, dataset version, summary metrics, and terminal outcomes for all completed paths as CSV.
  * Export full period-by-period data only for the retained sample of up to 50 paths to keep browser memory bounded.

## Technical Design

### Technology Choices
* Build the application with React, TypeScript, and Vite.
* Deploy the static site on Vercel.
* Use uPlot for fast simulation charts.
* Keep all simulation code framework-independent so that it can be tested without rendering the UI.
* Run simulations in a single Web Worker. The main thread is reserved for input, results, and chart rendering.

### Recommended Project Structure

```text
src/
  app/
    App.tsx
    routes.tsx
  features/
    simulator/
      SimulatorPage.tsx
      SimulatorInputs.tsx
      SimulatorResults.tsx
      simulatorState.ts
    education/
      EducationPage.tsx
  core/
    data/
      loadDataset.ts
      datasetTypes.ts
    math/
      matrix.ts
      quantiles.ts
      statistics.ts
    portfolio/
      cashFlows.ts
      rebalancing.ts
      taxes.ts
      leverage.ts
      transactionCosts.ts
    simulation/
      simulationEngine.ts
      historicalBootstrap.ts
      parametricStudentT.ts
      markovRegime.ts
      simulationTypes.ts
      runSimulation.ts
  workers/
    simulation.worker.ts
  charts/
    portfolioChart.ts
    leverageChart.ts
  styles/
    global.css
  main.tsx

public/
  data/
    manifest.json
    assets.json
    returns-monthly-usd.f32
    returns-monthly-eur.f32
    returns-weekly-usd.f32
    returns-weekly-eur.f32
```

This structure deliberately avoids separate service, repository, and utility layers. `core/` contains small, pure financial and mathematical functions; `features/` contains the React interface; the worker only coordinates data and calls the simulation engine.

`simulationEngine.ts` defines the only extension boundary required for simulation methods. Every engine produces one `PeriodScenario` containing joint asset returns, inflation, the period risk-free rate, and optional metadata such as a historical row index or Markov regime ID. `runSimulation.ts` passes this scenario to the unchanged portfolio-accounting loop. A new engine must not implement contributions, rebalancing, taxes, leverage, charts, or exports.

### Interface
* Use a desktop-first two-column dashboard.
* Keep the configuration panel on the left and results, metrics, and charts on the right.
* Provide a separate educational page for formulas, assumptions, proxy backfills, and the distinction between historical and user-entered expected returns.

### Dataset Format and Loading
* Convert source CSV files into aligned monthly and weekly return series before deployment.
* Derive adjusted-close total returns using the last valid observation in each calendar week or month. Do not forward-fill prices across periods.
* Ship `manifest.json` and `assets.json` first. The manifest defines the schema version, checksum, frequency, base currency, ordered date vector, ordered columns, dimensions, byte offsets, units, and special CPI and rate columns.
* Store every matrix in little-endian, column-major `Float32` format, with one contiguous series per asset or special column. Represent unavailable observations as `NaN` on disk.
* Convert loaded values to JavaScript `number` values for compounding, debt, tax, cost-basis, and matrix calculations. `Float32` is a transport format, not the accounting precision.
* At runtime, retain only rows that are finite for every selected asset and required special series. Use this same common period for bootstrap sampling and parametric estimation. Display its start date, end date, and observation count.
* Require at least 60 monthly or 260 weekly common observations. Disable simulation when the selected portfolio has less history.
* Fetch only the file for the selected frequency and base currency, then cache it in memory for the current session.
* Limit the investment horizon to 30 years and the portfolio to eight assets.

### Simulation Limits
* Default to 1,000 simulation paths.
* Set an absolute maximum of 50,000 paths and enforce $\text{paths} \times \text{periods} \le 10{,}000{,}000$. Reduce the selectable path maximum when the requested frequency and horizon exceed this work budget.
* Process paths in bounded batches. Retain terminal metrics for every path, period values for aggregate quantiles, and full details for at most 50 sampled paths.
* Transfer typed-array result buffers between the worker and main thread instead of cloning them.
* Publish progress after each batch. On cancellation, terminate and replace the worker; ignore stale messages by comparing run IDs.
* Support monthly and weekly frequencies from the first release. Enabling leverage automatically selects and locks weekly frequency.

### Financial Rules
* Simulate and perform all accounting in nominal base-currency values.
* For real-value display, deflate nominal path values by a jointly sampled historical inflation path. In parametric mode, use a user-entered constant annual inflation assumption.
* In parametric mode, use a user-entered constant annual base-currency risk-free rate for debt costs and Sharpe-ratio calculations.
* Keep recurring contributions nominal; do not increase them with inflation.
* Show a weekly leverage-ratio chart whenever leverage is enabled.
* Use a locally implemented `xoshiro128**` pseudo-random number generator initialized from a deterministic 32-bit seed. Do not use `Math.random()` in either simulation engine.
* Include the seed, PRNG name, and dataset schema version in every result and export.

### Future Markov-Chain Extension
* Keep this feature out of the first release. The initial release supports only historical joint bootstrap and multivariate Student's $t$ engines.
* Represent a Markov model with $K$ discrete regimes, an initial-state probability vector $\pi$, and a $K \times K$ transition matrix $P$. Every row of $P$ must sum to one.
* Train the model only from the aligned common historical matrix used by the other engines. Do not train separate state sequences for each asset.
* Start with $K = 2$ or $K = 3$ regimes. Make the state-classification method explicit in the UI and educational page before exposing the engine. A future implementation may use volatility/return buckets, deterministic clustering, or a hidden Markov model, but these methods are not interchangeable.
* Store each regime's joint emission model behind the same `PeriodScenario` output. The first implementation should draw complete historical rows assigned to the current regime. This preserves observed cross-asset dependence and avoids fitting a separate covariance matrix for every regime.
* For a path, sample its initial regime from $\pi$; for each period, sample the next regime from the current row of $P$, then draw one regime-compatible historical row. Sample inflation and rates from that same row.
* Preserve the regime ID for retained paths so the interface can show a compact regime timeline. Do not add a new chart until the basic return, drawdown, and leverage charts are complete.
* Keep Markov-model inputs small: transition matrices, state labels, and row-index lists are sufficient. They may be built in the worker from the loaded return matrix or supplied later as an optional versioned static artifact.
* Add tests for valid probability vectors, transition-matrix row sums, deterministic seeds, state-transition frequencies, regime-compatible row sampling, and unchanged portfolio results when fed identical `PeriodScenario` sequences.

### Implementation Order
1. Create the Vite application, the two-column simulator page, and the educational route.
2. Define and validate the binary dataset contract, including both base currencies, both frequencies, inflation, and rates.
3. Implement and test aligned historical joint bootstrap, portfolio weights, contributions, and quantile metrics.
4. Move the simulation runner into a Web Worker and connect it to uPlot.
5. Add parametric Student's $t$ simulation, including degrees-of-freedom estimation and covariance repair.
6. Add rebalancing, taxes, transaction costs, leverage, margin calls, and CSV export in that order.
7. Add the Markov-chain engine only after the two existing engines and their accounting paths are fully tested.

### Validation Requirements
* Keep `core/` functions deterministic and independently testable.
* Add hand-calculated tests for one-asset compounding, end-of-period contributions, rebalancing, average cost basis, loss carryforward, final liquidation tax, transaction costs, borrowing interest, margin calls, and insolvency.
* Add statistical tests for aligned bootstrap rows, seeded reproducibility, Student's $t$ scale conversion, covariance repair, and generated dependence.
* Add worker tests for progress, stale run IDs, cancellation, and transferred buffers.
* Validate one small simulation against an equivalent spreadsheet or Python calculation before optimizing it.