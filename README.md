# Asset Allocation Monte Carlo Simulator

## Project Vision
* Build a Monte Carlo simulator specifically for retail investors.
* Run all calculations directly in the browser.
* Keep infrastructure requirements minimal by using static hosting within provider quotas.
* Keep portfolio settings and simulation results in the browser; static asset requests still reach the hosting provider.
* Provide a responsive interface within measured device and simulation limits.

## Main Goals
* Use modern web technologies such as Web Workers and typed arrays to run thousands of simulations without freezing the interface.
* Implement accurate mathematical models for asset correlation and risk metrics.
* Keep the last completed result visible while inputs change; start expensive computation only when the user selects **Run**.
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
  * Use weekly data by default and offer monthly data when leverage is disabled.
  * Enabling leverage selects and locks weekly frequency. Daily simulation is outside the first-release scope.
* **Currency:**
  * Let users choose USD or EUR as the portfolio base currency.
  * Prepare separate return matrices for each base currency. Returns must include currency conversion before they reach the browser.
* **Inflation and Risk-Free Rates:**
  * Include historical Consumer Price Index (CPI) and risk-free rate data.
  * Allow users to switch between nominal returns and real, inflation-adjusted returns.
  * Use base-currency series: CPI and EFFR for USD; HICP and a prepared EUR short-rate series for EUR.
  * Convert monthly CPI/HICP observations into weekly log-inflation increments with a documented deterministic interpolation rule. This changes frequency but does not create new economic information.
  * Convert annualized short-rate observations into effective weekly or monthly rates before borrowing and Sharpe calculations.
  * Release a currency only when its versioned inflation, short-rate, FX-converted return, and metadata artifacts are complete.

## Data Pipeline
* Build the artifacts described in "Dataset Format and Loading" with a `pipeline/` directory of Python scripts (pandas/numpy), run offline before deployment. This code never ships to the browser and follows the Python coding standards, not the TypeScript ones.
* Record each asset's **exposure currency** and whether it is a currency-hedged share class in `assets.json`, and convert returns to each base currency using that exposure currency rather than the ticker's listing venue. A Milan-listed ETF that tracks a USD-denominated index (for example `CSSPX.MI`) has USD exposure; converting it as if it were EUR-denominated would misstate its currency risk.
* Fail the pipeline (non-zero exit) when an asset has no resolvable exposure currency or proxy mapping, consistent with the "never silently clip invalid values" rule in Financial Rules.

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
* **Future Markov-Chain Simulation:** Show a disabled, clearly labelled future option in the interface. Do not ship Markov code in the first release; add it only after both live engines and portfolio accounting are validated.

## Portfolio Logic and Cash Flows
* **Cash-flow modes:**
  * **Lump sum:** invest an initial amount with no later external cash flows.
  * **DCA:** add a fixed contribution at the end of each period. It does not earn that period's return.
  * **Contribution-only value averaging:** define the target path $A_t=A_0+t\Delta$, where $\Delta$ is the user-entered periodic target-value increase. After returns and borrowing interest, contribute $C_t=\max(0,A_t-E_t^-)$, where $E_t^-$ is pre-contribution equity. Never withdraw when equity exceeds the target.
  * Invest each contribution at target asset proportions. Purchase costs apply and increase cost basis.
* **Benchmark:** Allow one optional ETF. It receives the portfolio's actual external cash flows on the same dates, including value-averaging contributions calculated from the portfolio. It is a separate 1x buy-and-hold comparison with no leverage, borrowing, rebalancing, taxes, or transaction costs.
* **Taxes:**
  * Use one user-entered capital-gains tax rate and average cost basis for each asset.
  * Initial holdings use the initial invested amount as basis unless the user explicitly enters another basis. Every simulated purchase updates average basis.
  * Apply tax to sales caused by rebalancing, margin calls, and final liquidation. Dividends are reinvested through total returns and are not taxed separately.
  * Carry realized losses forward within each path to offset later realized gains. Do not generate tax refunds.
  * Deduct tax immediately after a taxable sale and report after-tax terminal wealth following final liquidation.
* **Rebalancing Methods:**
  * **Time-based:** Rebalance after a user-entered number of simulation periods.
  * **Tolerance Bands:** Rebalance when an asset differs from its target by a user-entered number of percentage points. Evaluate bands once per period after contributions and forced margin actions.
* **Leverage Options:**
  * Support long-only target gross exposure $L$ with editable maintenance margin $m$, where $0<m\le1$ and $1\le L\le\min(4,1/m)$. Changing $m$ automatically limits the leverage input.
  * Warn when $L=1/m$: the portfolio starts exactly at maintenance margin and has no buffer.
  * Define debt as gross asset value minus equity and maintenance margin as equity divided by gross asset value.
  * Charge the base-currency short rate plus a user-entered spread on debt.
  * Support time-based and tolerance-band leverage-resetting strategies.
  * Check margin every weekly simulation period. If maintenance margin falls below $m$, sell assets proportionally and repay debt until target leverage is restored after tax and costs.
  * Do not model cash deposits during a margin call. If equity is non-positive or target leverage cannot be restored, mark the path insolvent with zero terminal wealth.
* **Transaction Costs:** Apply both a fixed base-currency cost per nonzero asset order and a percentage of absolute trade value. Buy costs increase cost basis; sell costs reduce proceeds.

For every simulation period, apply operations in this order:
1. Apply asset returns and borrowing interest.
2. Determine and add the scheduled DCA or value-averaging contribution, then invest it at target proportions.
3. Check maintenance margin and execute forced deleveraging when required. Scheduled contributions may prevent a call; unscheduled rescue deposits are not allowed.
4. Evaluate and execute portfolio rebalancing or leverage resetting.
5. Update debt, average cost basis, transaction costs, loss carryforward, and realized-gain tax for every trade.
6. Record end-of-period holdings, debt, equity, neutral return, and metrics.

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
  * Report after-liquidation terminal wealth at p10, p25, p50, p75, and p90.
  * Define loss probability as $P(W_T<\sum_t C_t)$ and ruin probability as the fraction of insolvent paths. A target shortfall is not ruin.
  * Report annualized IRR for DCA and value averaging; display unavailable when no finite admissible root exists.
  * When a benchmark is selected, report terminal-value difference and probability that the portfolio outperforms it under identical external cash flows.
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

### Maintenance Policy
* Enable TypeScript strict mode. Validate untrusted JSON and binary metadata at runtime instead of relying on compile-time types.
* Use React local state or `useReducer` for the simulator state machine. Do not add a global state library, dependency-injection layer, or generic repository/service layer without a demonstrated need.
* Keep financial and statistical functions pure and colocate focused tests with their modules. Use Vitest for unit/statistical tests, Testing Library for user interactions, and a small Playwright smoke suite for routing, running, cancellation, and one result render.
* Pin the runtime major version and package-manager version; commit the lockfile. Keep dependencies few, review updates, and avoid packages for short deterministic algorithms that are easier to test locally.
* CI must run formatting, linting, TypeScript checking, unit tests, and a production build. Release only immutable, versioned data artifacts that pass the same validation used by the browser.
* Treat README financial conventions as authoritative. Any change to timing, formulas, data schema, PRNG behavior, or metric definitions requires a version note and matching tests.

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
    resources/
      ResourcesPage.tsx
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
* Provide three routes: `/` for Engine, `/education` for explanations, and `/resources` for curated external references.
* Use a desktop-first two-column input workspace followed by full-width charts and metrics. Stack these sections on narrow screens.
* Keep completed results visible while settings are edited, but label them as belonging to the previous completed run.

### Dataset Format and Loading
* Convert source CSV files into aligned monthly and weekly return series before deployment.
* Derive adjusted-close total returns using the last valid observation in each calendar week or month. Do not forward-fill prices across periods.
* Ship `manifest.json` and `assets.json` first. The manifest defines the schema version, checksum, frequency, base currency, ordered date vector, ordered columns, dimensions, byte offsets, units, and special CPI and rate columns.
* Build every artifact reproducibly. Record source/provider, license, retrieval date, timezone, trading calendar, total-return interpretation, FX series, proxy and splice rules, outlier checks, and content hash.
* Validate the manifest at runtime with an explicit schema. Verify checksum, exact dimensions and byte length, monotonic dates, expected units, and finite selected rows before simulation. Dataset updates are atomic and versioned.
* Store every matrix in little-endian, column-major `Float32` format, with one contiguous series per asset or special column. Represent unavailable observations as `NaN` on disk.
* Convert loaded values to JavaScript `number` values for compounding, debt, tax, cost-basis, and matrix calculations. `Float32` is a transport format, not the accounting precision.
* At runtime, retain only rows that are finite for every selected asset and required special series. Use this same common period for bootstrap sampling and parametric estimation. Display its start date, end date, and observation count.
* Require at least 60 monthly or 260 weekly common observations. Disable simulation when the selected portfolio has less history.
* Fetch only the file for the selected frequency and base currency, then cache it in memory for the current session.
* Limit the investment horizon to 30 years and the portfolio to six assets.

### Simulation Limits
* Default to 2,000 simulation paths and a 10-year horizon.
* Set an absolute maximum of 50,000 paths and enforce $\text{paths} \times \text{periods} \le 10{,}000{,}000$. Reduce the selectable path maximum when the requested frequency and horizon exceed this work budget.
* Process paths in bounded batches. Retain terminal metrics for every path, period values for aggregate quantiles, and full details for at most 50 sampled paths.
* Transfer only percentile arrays, terminal metrics, and at most 50 retained paths from the worker. Do not transfer complete holdings, debt, or basis histories for every path.
* Publish progress after each batch. On cancellation, terminate and replace the worker; ignore stale messages by comparing run IDs.
* Support monthly and weekly frequencies from the first release. Enabling leverage automatically selects and locks weekly frequency.

### Financial Rules
* Simulate and perform all accounting in nominal base-currency values.
* For real-value display, deflate nominal path values by a jointly sampled historical inflation path. In parametric mode, use a user-entered constant annual inflation assumption.
* In parametric mode, use a user-entered constant annual base-currency risk-free rate for debt costs and Sharpe-ratio calculations.
* Keep recurring contributions nominal; do not increase them with inflation.
* Show a weekly leverage-ratio chart whenever leverage is enabled.
* Use a locally implemented `xoshiro128**` pseudo-random number generator initialized from a deterministic 32-bit seed. Do not use `Math.random()` in either simulation engine.
* Expand the 32-bit seed deterministically into all four generator state words and reject the all-zero state. Version this expansion rule.
* Include the seed, PRNG/model version, dataset checksum, full configuration, and quantile algorithm version in every result and export.
* Treat non-finite returns or accounting values, invalid covariance, infeasible trades, non-positive equity, and failed numerical routines as explicit path or run failures. Never silently clip invalid values into plausible results.

### Future Markov-Chain Extension
Keep Markov outside the first-release source tree. Its eventual implementation must use the same aligned data and `PeriodScenario` interface, emit complete regime-compatible rows, and pass deterministic transition and accounting tests. The educational page may describe it before release, but the Engine control remains disabled.

### Implementation Order
1. Create the Vite application shell, three routes, responsive two-column simulator inputs, and static placeholder results.
2. Define and validate one complete base-currency binary dataset contract before adding a second currency.
3. Implement and test aligned historical joint bootstrap, portfolio weights, contributions, and quantile metrics.
4. Move the simulation runner into a Web Worker and connect it to uPlot.
5. Add parametric Student's $t$ simulation, including degrees-of-freedom estimation and covariance repair.
6. Add benchmark comparison, rebalancing, transaction costs, taxes, leverage, margin calls, and CSV export in that order.
7. Add the second base currency only after its complete FX, inflation, rate, and provenance pipeline passes validation.
8. Add the Markov-chain engine only after the two existing engines and their accounting paths are fully tested.

### Validation Requirements
* Keep `core/` functions deterministic and independently testable.
* Add hand-calculated tests for one-asset compounding, end-of-period contributions, rebalancing, average cost basis, loss carryforward, final liquidation tax, transaction costs, borrowing interest, margin calls, and insolvency.
* Add statistical tests for aligned bootstrap rows, seeded reproducibility, Student's $t$ scale conversion, covariance repair, and generated dependence.
* Add worker tests for progress, stale run IDs, cancellation, and transferred buffers.
* Add invariant tests for benchmark cash-flow identity, value conservation without costs, non-negative long-only holdings, debt repayment, basis conservation, and exact maintenance-margin boundaries.
* Validate one small simulation against an equivalent spreadsheet or Python calculation before optimizing it.

## Frontend Layout and Interaction Specification

This section is authoritative when an older statement elsewhere conflicts with a frontend default.

### Navigation and Responsive Layout

* The persistent header contains the product name and links to **Engine**, **Educational**, and **External Resources**. Show the active route and provide keyboard-operable mobile navigation.
* On desktop, the Engine route begins with a two-column input workspace. The left column contains portfolio construction; the right contains simulation and portfolio settings. The chart and metrics table span the full width below both columns.
* On narrow screens, stack portfolio construction, simulation settings, portfolio settings, chart, and metrics in that order.

### Portfolio Construction

* Provide a keyboard-searchable ETF picker backed by `assets.json` and allow at most six holdings.
* Each row shows ticker, name, allocation, and remove control. Display the allocation total continuously and require it to equal 100% within a 0.01 percentage-point tolerance.
* Provide a separate optional one-ETF benchmark selector. Do not include it in portfolio holding limits, weight validation, or accounting controls.

### Simulation and Portfolio Inputs

* Use a three-button engine selector: **Bootstrap** and **Parametric** are enabled; **Markov Chain** is disabled and labelled “future”. Render only the selected live engine's controls.
* Bootstrap inputs: deterministic seed and a read-only common-history summary.
* Parametric inputs: deterministic seed, historical or user-entered annual geometric return for each holding, automatic or manual degrees of freedom, annual inflation, and annual risk-free rate. Derive covariance from aligned data rather than exposing an editable matrix.
* Common defaults are weekly frequency, 2,000 paths, and 10 years. Paths and horizon are adjustable within the global work budget. Monthly frequency appears as an advanced unleveraged option.
* Portfolio settings include initial investment; lump sum, DCA, or contribution-only value averaging; rebalancing mode (`none`, time, or tolerance band); nominal or real display; tax rate; fixed and proportional trade costs; and initial cost-basis override.
* Leverage settings include target leverage, maintenance margin, borrowing spread, and reset mode (`none`, time, or tolerance band). Show only controls relevant to the active mode and automatically enforce $L\le\min(4,1/m)$.

### Execution State

* Use explicit `idle`, `loading-data`, `running`, `completed`, `cancelled`, and `failed` states with one current run ID.
* Provide **Run** and **Cancel** actions and batch progress. Input changes during a run terminate and replace the worker; messages with stale run IDs are ignored.
* Disable Run while inputs or data are invalid. Do not automatically rerun expensive simulations when a field changes.

### Results

* Draw p10, p25, p50, p75, and p90 quantile series, up to 50 retained individual paths, and the optional benchmark line. Percentile series are aggregates and cannot be selected as if they were paths.
* The initial metrics table includes terminal-wealth percentiles, loss probability, ruin probability, CAGR or IRR, annualized volatility, maximum drawdown, Sharpe ratio, benchmark terminal difference, and probability of benchmark outperformance.
* Show `N/A` with a short reason when a metric is undefined. Keep metric definitions linked to the Educational route.

### Validation and Accessibility

* Validate finite numeric values, bounds, six-holding maximum, allocation total, data-history minimum, path-period budget, tax and cost ranges, rebalancing periods and bands, and leverage-margin compatibility.
* Place errors beside their controls and summarize them in an `aria-live` region. Use semantic `nav`, `main`, headings, `fieldset`, and `legend`; visible labels and focus indicators; keyboard-operable controls; and status cues that do not rely only on color.
* Provide a tabular alternative for essential chart values and respect reduced-motion preferences.