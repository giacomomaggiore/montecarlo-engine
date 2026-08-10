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
* **FX Conversion and Hedge Treatment:**
  * The offline pipeline converts every asset return into the selected base currency before writing a return matrix. For an unhedged return series in currency $C$ and base currency $B$, with $X_t$ quoted as units of $B$ per unit of $C$, calculate $1+r_t^B=(1+r_t^C)(X_t/X_{t-1})$. When $C=B$, use the return unchanged.
  * Metadata distinguishes `listingCurrency`, `exposureCurrency`, and `returnCurrency`. For an unhedged fund, `returnCurrency` must equal its economic `exposureCurrency`; the listing venue does not decide the FX conversion. For a currency-hedged share class, `returnCurrency` is the hedge currency and `fxTreatment` is `already-hedged`; do not apply an additional underlying-exposure FX return, but still convert the hedged return from its return currency to the selected base currency when they differ.
  * Record the direct, inverted, or triangulated FX source, quote orientation, provider, source symbol, retrieval date, and transformation in provenance. Do not forward-fill unavailable FX observations; mark the converted return unavailable and let common-row alignment remove it. Fail the pipeline when a required FX route is missing or ambiguous.
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
* **Asset Metadata Catalogue:**
  * Maintain `pipeline/metadata/assets.csv` as the editable source-of-truth table, with one row per canonical `assetId`, and `pipeline/metadata/fx_routes.csv` as the referenced FX-route table. The pipeline joins each source return DataFrame to `assets.csv` by stable asset ID or explicitly mapped source symbol, then compiles the validated records into the browser-facing JSON catalogue. A separate route table keeps direct, inverted, and triangulated FX details out of duplicated ETF rows.
  * Build and ship a versioned `assets.json` catalogue with one canonical record per simulatable ETF or asset. Use a stable `assetId` as the binary-matrix column key; keep the displayed ticker and provider/source symbol as separate fields because tickers and listings can change or collide.
  * Required identity and presentation fields are `assetId`, ticker, complete name, asset class, source symbol, provider, listing exchange, listing currency, exposure currency, return currency, `fxTreatment`, `isCurrencyHedged`, and data/provenance references. Optional descriptive fields include ISIN, fund domicile, investment region/category, distribution policy, replication method, inception date, and AUM.
  * Record `terAnnual` as a non-negative decimal fraction together with `terAsOf` and `terSource`. It is informational in the first release: adjusted-close total returns already reflect fund expenses where the source provides them, so the simulator must not subtract TER a second time. A later forward-looking return-assumption feature may use an explicitly documented TER policy.
  * A proxy/backfill record is either absent or contains the proxy `assetId`, splice date, method, and rationale. An FX-provenance record contains the route and transformation used for each produced base currency. Validate unique IDs, supported currencies, no duplicate matrix columns, valid provenance references, non-negative TER, and hedge consistency: unhedged records use `returnCurrency=exposureCurrency`; hedged records require a hedge currency and use `fxTreatment='already-hedged'`.
  * Keep user-facing metadata separate from periodic return data. `assets.json` is loaded first for ETF search, labels, eligibility, and explanations; the large return matrices remain compact binary artifacts loaded only after the user chooses frequency and base currency.

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

## Core Engine Reference — Phase 1 (As Built)

This section documents every framework-independent function implemented so far in `src/core/`. It is a reading guide, not the source of truth — each module's colocated `*.test.ts` file is the actual proof of behavior. For each function: **Purpose** (what it is for), **Intuition** (the financial/statistical/algorithmic idea behind it), and **Code intuition** (the specific trick or invariant the implementation relies on). This mirrors the "explain *why*, not *what*" rule the code comments themselves follow.

### `core/validation.ts` — one shared result shape

```ts
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] }
```

* **Purpose:** every validator in the app (dataset, config, and later the runner itself) needs to say "this is fine, here is the checked value" or "here is exactly what is wrong," without throwing.
* **Intuition:** the README's rule "never silently clip invalid values into plausible results" only works if invalid input has somewhere safe to go. A discriminated union makes the two outcomes mutually exclusive at the type level: code that reads `result.value` cannot compile unless it first narrowed `result.ok`.
* **Code intuition:** because the failure branch (`{ ok: false; errors }`) does not mention `T`, the exact same type and the exact same failure-handling code works for a `ValidationResult<AlignedDataset>`, a `ValidationResult<SimulationConfig>`, and later a `ValidationResult<SimulationResult>` — `runSimulation` reuses `validateSimulationConfig`'s failure branch completely unchanged (see below).

### `core/data/datasetTypes.ts` — the aligned dataset contract

Key exports: `Frequency`, `BaseCurrency`, `DatasetIdentity`, `AlignedDataset`, `validateAlignedDataset`.

* **Purpose:** describe "one common history" — one date vector plus one return column per asset, one inflation column, one risk-free column — all sharing the same row count, so row `t` always means the same date everywhere.
* **Intuition:** the bootstrap engine's entire statistical validity rests on sampling *complete rows*. That is only meaningful if every column has already been aligned to the same calendar and every row is fully observed — this type is where that guarantee is stated and enforced, once, instead of re-checked by every consumer.
* **Code intuition:** `Frequency`/`BaseCurrency` are string literal unions (`'weekly' | 'monthly'`, `'USD' | 'EUR'`), not `string`, so an unsupported value is a compile error, not a runtime surprise. `validateAlignedDataset` checks matching dimensions, strictly increasing ISO dates, finite values, a `-100%` return floor, and the 60-month/260-week minimum history — all as structured `ValidationError`s rather than thrown exceptions or clipped values.

### `core/simulation/simulationTypes.ts` — configuration, scenario, and result contracts

Key exports: `CashFlowConfig`, `SimulationConfig`, `PeriodScenario`, `SimulationResult`, `validateSimulationConfig`.

* **Purpose:** define the shape of a run *before* any engine exists — what the user configured, what one sampled period looks like, and what a finished run reports.
* **Intuition:** `CashFlowConfig` is a discriminated union (`lumpSum` / `dca` / `valueAveraging`) instead of a bag of optional fields, because the README defines these as mutually exclusive modes with different required data (DCA needs an amount; value averaging needs a target increase; lump sum needs nothing else). Making invalid combinations unrepresentable is cheaper than validating them at runtime.
* **Code intuition:** `PeriodScenario` is the one shape every engine must produce (`assetReturns`, `inflation`, `riskFreeRate`, `sourceRowIndex`) — it deliberately contains nothing about holdings, weights, or contributions, which is what lets `runSimulation` stay engine-agnostic. `validateSimulationConfig` takes `assetCount` as a parameter rather than reading `config.weights.length`, so a config whose weight array accidentally has the wrong length is *caught*, not silently compared against itself.

### `core/simulation/simulationEngine.ts` — the one extension boundary

```ts
type SimulationEngine = { nextScenario(): PeriodScenario }
```

* **Purpose:** this is the entire contract a simulation method must satisfy to plug into the unchanged portfolio-accounting loop.
* **Intuition:** the README requires that a new engine "must not implement contributions, rebalancing, taxes, leverage, charts, or exports." Making the interface this narrow is what makes that rule enforceable — there is nothing wider to accidentally implement.
* **Code intuition:** an engine only ever returns a scenario; it never receives holdings or config. This is why the historical bootstrap engine (below) and the future Student's $t$ engine can be swapped without touching `runSimulation` or `stepPortfolioPeriod` at all.

### `core/math/random.ts` — deterministic `xoshiro128**`

Key exports: `XOSHIRO128_STAR_STAR_VERSION`, `createXoshiro128StarStar(seed)` → `{ nextUint32, nextUniform, nextInt }`.

* **Purpose:** every "random" choice in the app (which historical row to sample) must be exactly reproducible from one 32-bit seed, and must never call `Math.random()`.
* **Intuition:** reproducibility is a product requirement, not a nice-to-have — the README requires the seed, PRNG version, and full config in every export so a result can be regenerated exactly. `xoshiro128**` is a small, fast, well-studied generator that fits this without pulling in a dependency for "a short deterministic algorithm that is easier to test locally" (the Maintenance Policy's own words).
* **Code intuition:**
  * `expandSeed` turns one 32-bit seed into four state words using a SplitMix32-style rule: add the golden-gamma constant `0x9e3779b9`, then run it through two MurmurHash3 finalizer mixes (`0x85ebca6b`, then `0xc2b2ae35`). This exists because xoshiro's own state update is weak at scrambling a *single* seed value into four *independent-looking* words — SplitMix32 is a cheap, well-known way to do that expansion, and it is versioned (`XOSHIRO128_STAR_STAR_VERSION`) so a future change to this rule cannot silently change every past seed's sequence.
  * Every intermediate value is masked with `>>> 0` after each operation. JavaScript's bitwise operators otherwise produce *signed* 32-bit integers, which would silently corrupt the generator's internal state the first time a word's high bit was set.
  * `nextInt(upperExclusive)` uses **rejection sampling before the modulo**: it computes the largest multiple of `upperExclusive` that fits under `2^32` and redraws whenever `nextUint32()` lands above that cutoff. Without this, rows near the start of the table would be drawn very slightly more often than rows near the end whenever `upperExclusive` does not divide `2^32` evenly — for six historical rows that bias is tiny per draw, but it is exactly the kind of silent, compounding error a Monte Carlo engine cannot tolerate.
  * The all-zero expanded state is explicitly rejected, because xoshiro's XOR/shift update is a fixed point at all-zero: it would generate an infinite stream of zeros.

### `core/simulation/historicalBootstrap.ts` — historical joint bootstrap engine

`createHistoricalBootstrapEngine(dataset, seed) → SimulationEngine`

* **Purpose:** implement the README's "Historical Joint Bootstrap" — sample *complete* historical rows with replacement, never sample each asset independently.
* **Intuition:** the whole point of a joint bootstrap is preserving contemporaneous cross-asset dependence — if two assets crashed together in the same real week, an independent-column sampler could recombine that week's stock return with an unrelated week's bond return and manufacture a diversification benefit that never actually existed historically. Sampling one row index and reading every column at that same index is what prevents that.
* **Code intuition:** `nextScenario()` calls `random.nextInt(dataset.dates.length)` exactly once per call, then reads `dataset.assetReturns[i][sourceRowIndex]` for every asset, plus `dataset.inflation[sourceRowIndex]` and `dataset.riskFreeRates[sourceRowIndex]`, from that one index. Sampling *with* replacement (the same row can be drawn twice, even consecutively) is deliberate: it treats each historical week as one independent draw from the portfolio's true (unknown) return distribution, which is the entire statistical premise of a bootstrap. A fresh plain `number[]` is returned each call — never a typed-array view into the dataset — so nothing downstream can accidentally mutate the historical source data.

### `core/portfolio/cashFlows.ts` — minimal unleveraged portfolio accounting

Key exports: `allocateInitialInvestment`, `applyPeriodReturn`, `computeScheduledContribution`, `investContribution`, `stepPortfolioPeriod`.

* **Purpose:** turn one `PeriodScenario` plus the previous period's holdings into the next period's holdings — the smallest possible accounting step, with no rebalancing, taxes, costs, or leverage yet.
* **Intuition — timing matters:** the README's per-period operation order is "apply returns, *then* add the contribution." A DCA contribution added at the end of the period should not retroactively earn that period's market return — real brokerage cash arriving on a date does not travel back in time. Getting this ordering backwards is a common and very easy Monte-Carlo bug, so it is enforced in one function (`stepPortfolioPeriod`) rather than left to be repeated correctly by every caller.
* **Code intuition, function by function:**
  * `allocateInitialInvestment(initialInvestment, weights)` computes `initialInvestment * weights[i]` — the only place the lump sum is split across assets. Every later contribution reuses this same target-weight split.
  * `applyPeriodReturn(holdings, assetReturns)` computes `holdings[i] * (1 + assetReturns[i])` — one asset at a time, with no notion of a portfolio total. This is why it is correct regardless of which engine produced the returns.
  * `computeScheduledContribution(cashFlow, periodIndex, initialInvestment, preContributionEquity)` switches on the `CashFlowConfig` union: `0` for lump sum, the fixed `amount` for DCA, and for value averaging, $C_t=\max(0, A_0 + t\Delta - E_t^-)$ where $A_0 + t\Delta$ is the target path and $E_t^-$ is equity *before* this period's contribution. The `Math.max(0, ...)` is the entire mechanism that stops value averaging from ever describing a withdrawal — the README requires "never withdraw when equity exceeds the target," and this clamp is precisely why that can never happen: a negative target-shortfall becomes `0`, not a negative contribution.
  * `investContribution(holdings, weights, contribution)` computes `holdings[i] + weights[i] * contribution` — the contribution is spent at target weights, but *existing* holdings are left exactly where the return step put them. This is a deliberate limitation: weights are allowed to drift between contributions because rebalancing does not exist yet (a later phase adds it). A test proves this drift happens on purpose.
  * `stepPortfolioPeriod(...)` is the orchestrator: record `startEquity`, apply the return, compute `preContributionEquity`, compute and invest the contribution, then return `{ holdings, contribution, equity, neutralReturn }`. `neutralReturn = preContributionEquity / startEquity − 1` is the return caused by *markets alone*, before any external cash arrived — this is the number a future volatility/Sharpe calculation must use, precisely because mixing in contribution timing would make a $100 DCA top-up look like investment performance.
  * Every function here takes and returns plain `number[]`, never mutates its arguments, and never touches taxes, costs, or debt — so wrapping this function later (for taxes, leverage, etc.) cannot change what it already does.

### `core/math/quantiles.ts` — one canonical percentile rule

Key exports: `QUANTILE_VERSION`, `QUANTILE_LEVELS`, `computeQuantile`, `computeQuantileSeries`.

* **Purpose:** there is more than one textbook definition of "percentile." The README requires picking exactly one and using it everywhere, so a chart's p50 line always agrees with the metrics table's p50 number.
* **Intuition:** `computeQuantile(sortedAscendingValues, q)` implements linear interpolation between order statistics — $h=(n-1)q$, then interpolate between the values at $\lfloor h\rfloor$ and $\lceil h\rceil$. This is the same method Excel calls `PERCENTILE.INC` and NumPy calls its default `'linear'` method, chosen specifically so a hand-checked spreadsheet number and this app's own number agree exactly, not approximately.
* **Code intuition:** `computeQuantileSeries` calls `computeQuantile` five times per period (`p10`…`p90`) over the **cross-section of every path's value at that period** — not over one path's own history over time. This distinction is easy to get backwards and is exactly what the README's Visualization rules are protecting: a percentile band describes "how outcomes vary across simulated futures at this point in time," not "how one future evolved." `QUANTILE_VERSION` exists for the same reason `XOSHIRO128_STAR_STAR_VERSION` and `HISTORICAL_BOOTSTRAP_MODEL_VERSION` exist: so a stored result can say exactly which rule produced its numbers if the method is ever revisited.

### `core/simulation/runSimulation.ts` — the headless runner

`runSimulation({ engine, dataset, config, modelVersion, prngVersion }) → ValidationResult<SimulationResult>`

* **Purpose:** this is the first place every earlier Phase 1 piece runs together — validated dataset, seeded PRNG, an engine, and `stepPortfolioPeriod` — driven in a `paths × periods` loop and reduced into a chart-ready summary.
* **Intuition:** the function deliberately knows as little as possible. It receives an **already-constructed** engine rather than building one, so it stays usable by every future engine unchanged — Phase 3's Student's $t$ engine only needs to be constructed and handed in, exactly like the bootstrap engine is today. This is the practical payoff of the `SimulationEngine` boundary above.
* **Code intuition:**
  * Per-period equity for every path lives in one flat `Float64Array` of length `(periods + 1) * paths`, indexed as `period * paths + pathIndex`, instead of a nested `number[][]`. A flat typed array stores raw 8-byte numbers with no per-element object overhead — the same "typed arrays for large simulation data" principle the README's Main Goals section commits to — and the existing `paths × periods ≤ 10,000,000` work budget already caps this at roughly 80&nbsp;MB.
  * Paths run one at a time, period by period, calling `engine.nextScenario()` and `stepPortfolioPeriod` completely unmodified. This means the engine's internal PRNG stream advances in **path-major, period-minor order** — all of path 0, then all of path 1, and so on — and that ordering is now part of a run's reproducible identity, alongside the seed.
  * Only `equity` is checked for `Number.isFinite(...)` — not `neutralReturn`. Under the validated dataset's $-100\%$ return floor and long-only accounting, equity can hit exactly `0` (a total wipeout) but cannot go negative or non-finite; a wiped-out path can still legitimately compute a meaningless `0/0` `neutralReturn` later, and that belongs to a future volatility phase, not this one. When equity does fail, every remaining period for that path is explicitly written as `NaN`, never left at a typed array's default `0` — because a real wipeout (`$0`) and "this path stopped being simulated" (`NaN`) are different facts, and `computeQuantileSeries` must be able to tell them apart.
  * Retained paths (full period-by-period detail, for a future UI to let a user click through) are always the first `min(50, paths)` paths **by index** — never random, never picked to match a percentile. Every path is an equally valid independent draw, so a fixed prefix is not a biased sample, and it needs no extra PRNG draw or tie-breaking rule to be exactly reproducible.
  * The result's `metadata.algorithms` combines the caller-supplied `modelVersion`/`prngVersion` (this file cannot know which engine produced the scenarios) with this file's own `QUANTILE_VERSION` — so every result can answer "exactly which data, seed, model, and quantile rule produced this number."

### Phase 1.6 — independent cross-check

`validation/phase_1_6_independent_check.py` reimplements `xoshiro128**` and the cash-flow accounting rules **from this README's prose alone**, in Python, without reading the TypeScript line-by-line. It prints a period-by-period trace (sampled row, holdings, contribution, neutral return, equity) for one lump-sum, one DCA, and one value-averaging run. Those numbers are pasted as expected values into `src/core/simulation/independentCheck.test.ts`, which drives the real `createHistoricalBootstrapEngine` and `stepPortfolioPeriod`/`runSimulation` against the same seeds and dataset and asserts an exact match.

* **Intuition:** a hand-calculated test written by the same person who wrote the implementation can encode the same mistake twice — the test "passes" because the bug is symmetric. A second implementation, in a second language, derived only from the specification, does not share that risk.
* **Code intuition:** the Python script rounds every literal return through an actual 32-bit float (`struct.pack('f', ...)` then unpack) before using it in `float64` arithmetic. This matters because the dataset's returns are stored as `Float32` on disk — "a transport format, not the accounting precision," per the Dataset Format rules — so the *correct* independent ground truth is what double-precision arithmetic produces starting from a float32-rounded input, not from the unrounded decimal literal. Skipping this step would make the cross-check fail on real, expected floating-point rounding rather than catch an actual bug.

## Work-in-Progress Plan

This is a checklist tracking near-term execution, not a spec. It refines steps 1–5 of "Implementation Order" into a stricter test-before-UI sequence — same scope, different order of proof — and defers to "Implementation Order" for everything after. Check items off as they land; do not change scope here without updating the sections above.

- [x] **Phase 0 — Minimal frontend shell.** Vite app, the three routes, a single **Run** button, and a raw JSON/number dump of the result. No real input form. Purpose: a harness to exercise the backend, not a usable product.
- [x] **Phase 1 — Bootstrap engine + portfolio accounting, headless.** Build the following in `core/` only, with no dataset fetch, binary parsing, worker, chart, or real input UI. Keep scenario generation separate from portfolio accounting so later engines reuse the same accounting loop.
  - [x] **Phase 1.1 — Core contracts and validation.** Add `core/data/datasetTypes.ts`, `core/simulation/simulationTypes.ts`, and `core/simulation/simulationEngine.ts`. This subphase defines the small, framework-independent language that the bootstrap engine, portfolio loop, worker, and future engines share. It adds no loader, binary parser, worker, React state, or financial calculation.
    1. **Define closed scalar types and dataset identity.** Represent frequency as `'weekly' | 'monthly'`, base currency as `'USD' | 'EUR'`, and cash-flow mode as a discriminated union rather than strings scattered through code. Define one dataset-identity value containing the dataset version, checksum, frequency, and base currency. Use ISO calendar-date strings for the ordered date vector. This makes unsupported modes unrepresentable at compile time and ensures every later result can identify exactly which released data it used.
    2. **Define the aligned in-memory dataset.** Represent selected asset identifiers, dates, one periodic simple-return column per selected asset, one inflation column, and one base risk-free-rate column. The arrays must share one row count and row $t$ must refer to the same date in every column. The eventual binary artifact remains little-endian, column-major `Float32`; this runtime type describes data after loading and selection, where reading a typed-array value yields a JavaScript `number` for accounting. Keeping the transport representation outside this contract lets core tests use small deterministic fixtures without fetching files or depending on browser APIs.
    3. **Define the scenario and engine boundary.** `PeriodScenario` contains one complete sampled row: asset returns in selected-asset order, inflation, risk-free rate, and source row index. `SimulationEngine` only produces the next scenario; it does not receive holdings, contributions, taxes, or React state. This is the single extension boundary: bootstrap now and Student's $t$ later can feed identical scenarios into unchanged accounting, which prevents duplicated financial rules.
    4. **Define immutable run inputs and outputs.** Model portfolio weights, initial investment, path count, period count, seed, and a discriminated cash-flow configuration: lump sum has no later amount, DCA has a non-negative periodic amount, and value averaging has a non-negative target increase. Define result and failure types that preserve the full configuration, dataset identity, seed, and algorithm-version fields. Inputs are read-only and functions return new values, so one simulated path cannot mutate another path's configuration or historical data.
    5. **Implement two explicit validation stages.** First validate dataset structure: supported frequency/currency, unique asset identifiers, matching nonzero dimensions, strictly increasing valid dates, finite values in all retained columns, returns no lower than $-100\%$, at most six assets, and at least 60 monthly or 260 weekly common rows. Then validate a run configuration: finite non-negative amounts, weights summing to one within 0.01 percentage points, unsigned 32-bit integer seed, positive integer paths and periods, 30-year horizon, 50,000-path maximum, and $N\times T\le10{,}000{,}000$. Return structured validation errors for expected bad input instead of clipping values, silently dropping rows, or relying on exceptions; the later UI can display those same errors beside controls.
    6. **Prove the contracts before building the engine.** Add focused tests for valid datasets, each rejected invariant, exact boundary values such as 60/260 observations and a $-100\%$ return, all cash-flow union variants, and the work-budget boundary. Use direct one-period `PeriodScenario` fixtures for hand-calculated accounting tests; use generated 60- or 260-row fixtures when testing full-run eligibility. This proves that the test harness respects production history requirements without making small financial examples unreadable.
  - [x] **Phase 1.2 — Versioned deterministic randomness.** Add `core/math/random.ts` with a local `xoshiro128**` generator. Expand one 32-bit seed into four state words with one documented, versioned rule; reject the all-zero state; expose unsigned-32-bit, $[0,1)$ uniform, and unbiased bounded-integer draws; never call `Math.random()`. Test fixed reference vectors, same-seed reproducibility, different-seed divergence, output bounds, and row-index bounds. Keep this module independent of simulation and React code.
  - [x] **Phase 1.3 — Historical joint bootstrap engine.** Add `core/simulation/historicalBootstrap.ts` and `core/simulation/historicalBootstrap.test.ts`. Implement the existing `SimulationEngine` boundary only: construct an engine from one already validated `AlignedDataset` and a validated unsigned 32-bit seed, create one local `xoshiro128**` generator, and return one complete `PeriodScenario` on every `nextScenario()` call. This subphase introduces no portfolio state, cash-flow logic, results, dataset loader, binary parsing, worker, React code, or mutable global randomness.
    1. **Define the construction boundary.** Export one plainly named factory, such as `createHistoricalBootstrapEngine(dataset, seed)`, returning `SimulationEngine`. The caller is responsible for running `validateAlignedDataset` before construction, so the engine can rely on matching, finite columns and a nonzero row count. It must neither modify the dataset's typed arrays nor retain or expose a mutable selected-row buffer.
    2. **Draw complete rows with replacement.** Each `nextScenario()` call must call `createXoshiro128StarStar(seed).nextInt(dataset.dates.length)` exactly once through the engine's private generator. The resulting row index is eligible again on the next call, including an immediate repeat. Sampling must use the PRNG's rejection-sampled bounded integer rather than `Math.random()`, modulo arithmetic, shuffled cycles, or an independent generator per asset.
    3. **Preserve the joint observation.** Read every asset return at the single selected row in `dataset.assetReturns`, preserving `dataset.assetIds` order. Read `dataset.inflation[rowIndex]` and `dataset.riskFreeRates[rowIndex]` from that same row, then return `{ assetReturns, inflation, riskFreeRate, sourceRowIndex: rowIndex }`. The engine samples complete historical outcomes, so correlations and joint stress events remain intact; it intentionally does not preserve serial dependence, volatility clustering, or crisis duration across independently sampled periods.
    4. **Keep the scenario isolated from the dataset.** Return a new ordinary number array for `assetReturns` on each call rather than a typed-array view or a reused mutable array. Values are JavaScript `number`s for later accounting. Do not include dates, asset IDs, holdings, weights, contributions, debt, taxes, or any future engine-specific fields in `PeriodScenario`; row identity is represented solely by `sourceRowIndex`.
    5. **Define deterministic model identity.** Export a model-version constant, for example `HISTORICAL_BOOTSTRAP_MODEL_VERSION = 'historical-bootstrap-v1'`. Phase 1.5 will combine it with `XOSHIRO128_STAR_STAR_VERSION` and the later quantile version in result metadata. Changing the row-selection rule, return ordering, or scenario construction requires a version update and new fixed-seed reference expectations.
    6. **Prove behavior with focused fixtures.** Build small deterministic aligned-dataset fixtures locally in the test file; construction tests do not need to meet the 60/260-observation production-history rule because dataset validation is already covered in Phase 1.1. Test a fixed seed against an explicitly written source-row sequence, then verify every returned asset return, inflation value, and risk-free rate equals the corresponding source column at each returned `sourceRowIndex`. Use distinctive per-row values so independent-column sampling cannot accidentally pass.
    7. **Prove repeatability and distribution.** Create two engines with the same dataset and seed and assert that a fixed number of scenarios are identical, including row metadata; assert a different seed diverges over a sufficiently long fixed sequence. For a small known row count, collect a predeclared fixed number of draws and assert each row frequency remains inside a predeclared tolerance around the expected count. This is a regression guard for the bounded-draw path, not evidence that a finite sample is perfectly uniform.
    8. **Completion check.** Run the focused bootstrap test, then the complete Vitest suite, lint, formatting, and production build. The only new production dependency must be the existing `AlignedDataset`, `SimulationEngine`, `PeriodScenario`, and local xoshiro PRNG modules.
  - [x] **Phase 1.4 — Minimal unleveraged portfolio accounting.** Add `core/portfolio/cashFlows.ts` and its colocated test file. Implement the smallest pure accounting step needed by the future runner: turn one `PeriodScenario` plus the previous period's holdings into the next period's holdings. This subphase introduces no rebalancing, taxes, transaction costs, debt/leverage, benchmark handling, result aggregation, or React/worker code; those stay in later phases.
    1. **Define the per-period result shape.** Export a `PortfolioPeriodResult` type holding `holdings` (one number per asset, in `assetIds` order), `contribution` (the actual external cash added this period, always `0` for lump sum), `equity` (sum of holdings after the contribution), and `neutralReturn` (the portfolio return caused by asset returns alone, before the contribution is added). Every field is a plain `number`/`number[]`, matching the "convert to JavaScript `number` for accounting" rule; nothing here is a `Float32Array`.
    2. **Implement `allocateInitialInvestment(initialInvestment, weights)`.** Return `holdings[i] = initialInvestment * weights[i]`, the period-zero starting point before any scenario is applied. This is the only place the initial lump sum is split across assets; every later period only ever invests new contributions this same way.
    3. **Implement `applyPeriodReturn(holdings, assetReturns)`.** Return a new array with `holdings[i] * (1 + assetReturns[i])`. This is a pure per-asset simple-return compounding step with no cross-asset interaction, so it is the same function regardless of which engine produced the scenario.
    4. **Implement `computeScheduledContribution(cashFlow, periodIndex, initialInvestment, preContributionEquity)`.** Switch on the `CashFlowConfig` union: `lumpSum` always returns `0`; `dca` always returns `cashFlow.amount`; `valueAveraging` computes the target path value $A_t = \text{initialInvestment} + \text{periodIndex} \times \Delta$ and returns $C_t=\max(0, A_t - \text{preContributionEquity})$, so the function can never return a negative number and therefore never models a withdrawal. `preContributionEquity` is `sum(applyPeriodReturn(...))`, i.e. $E_t^-$ from the README's Portfolio Logic section, computed by the caller before this function runs.
    5. **Implement `investContribution(holdings, weights, contribution)`.** Return `holdings[i] + weights[i] * contribution`, spending the whole contribution at target weights and leaving every other unit of value exactly where the return step left it. Existing holdings are never resized to close weight drift; that is deliberate until a later rebalancing phase.
    6. **Implement `stepPortfolioPeriod(holdings, scenario, cashFlow, weights, periodIndex, initialInvestment)`.** Orchestrate steps 3–5 in the exact order required by the README's per-period operation list: (a) record `startEquity = sum(holdings)`; (b) call `applyPeriodReturn` to grow holdings with `scenario.assetReturns`; (c) compute `preContributionEquity = sum(grownHoldings)`; (d) call `computeScheduledContribution`; (e) call `investContribution` to get the final holdings; (f) compute `equity = sum(finalHoldings)` and `neutralReturn = preContributionEquity / startEquity - 1`. Return one `PortfolioPeriodResult`. This function never reads or writes taxes, debt, transaction costs, or rebalancing bands, so later phases can wrap it without changing its behavior.
    7. **Keep every function pure and dependency-free.** No function in this file may mutate its `holdings` or `weights` argument, read a `PeriodScenario` field the engine does not define, or depend on `paths`/`periods` from `SimulationConfig`. `core/simulation/runSimulation.ts` (Phase 1.5) is the only caller that will loop this function across periods and paths.
    8. **Prove behavior with hand-calculated tests.** Cover: one-asset lump-sum compounding against a manually computed value; a two-asset case where each asset gets a different return, checked against a hand-summed equity; that a DCA contribution is added after the period's return is applied (so it earns zero return in the period it arrives); that repeated unequal per-asset returns without rebalancing drift the weights away from target over several periods; that value averaging never contributes a negative amount once the path value already exceeds the target; and that, with no costs or taxes yet in the model, `equity` after each period exactly equals `startEquity * (1 + neutralReturn) + contribution` (value conservation).
  - [x] **Phase 1.5 — Headless runner and quantiles.** Add `core/math/quantiles.ts` and `core/simulation/runSimulation.ts`. This subphase is the first place that ties every earlier Phase 1 piece together: the validated dataset (1.1), the seeded PRNG (1.2), the bootstrap engine (1.3), and the per-period accounting step (1.4) are driven in a loop and reduced into the small, chart-ready summary a future UI will render. It still adds no dataset fetch, binary parsing, worker, chart, or React code — those are Phase 2.
    1. **Decide what the runner is allowed to know.** `runSimulation` must stay usable by every future engine, not just bootstrap, so it may only depend on the existing `SimulationEngine` interface, the already-validated `AlignedDataset`, and a `SimulationConfig`. It receives an **already-constructed** engine (for example, one built by `createHistoricalBootstrapEngine(dataset, seed)`) rather than building one itself. *Intuition:* the runner's job is "loop and account," not "know how to sample history." *Consequence:* Phase 3's Student's $t$ engine reuses this file completely unchanged — it only needs to be constructed and handed in. *Limitation:* the caller (a small helper today, the worker in Phase 2) is responsible for using the *same* seed and model to build both the engine and the version strings passed alongside it; nothing in the type system forces that pairing, so this is a documented convention, not a compiler-enforced guarantee.
    2. **Reuse the existing config validator instead of re-deriving limits.** Before running anything, call `validateSimulationConfig(config, dataset.assetIds.length, dataset.identity.frequency)` — the same function Phase 1.1 already tested for the 50,000-path maximum and the $N\times T\le10{,}000{,}000$ work budget. Take `assetCount` from `dataset.assetIds.length` rather than from `config.weights.length`: if those two numbers ever disagree (a caller built a five-weight config against a six-asset dataset), reading the count from the dataset is what lets the existing "weights count must match asset count" check actually catch the mistake, instead of comparing a number to itself. *Advantage:* zero new validation logic, and the 1.1 test suite already covers the boundary cases. *Consequence:* `runSimulation` returns the same `ValidationResult<T>` shape (`{ ok: true, value }` / `{ ok: false, errors }`) already used everywhere else, just with `T = SimulationResult` this time — the failure branch needs no new code because `ValidationResult`'s `ok: false` case never depended on `T` in the first place. This is the payoff of that Phase 1.1 design choice.
    3. **Store per-period equity in one flat typed array, not nested arrays.** Allocate a single `Float64Array` of length `(periods + 1) * paths` and write each path's equity into it at `period * paths + pathIndex`. *Intuition:* a plain JavaScript `number[][]` (array of arrays) stores every number as a separately-allocated boxed object with pointer overhead; a flat `Float64Array` stores raw 8-byte numbers contiguously, which is the same "typed arrays for large simulation data" principle the README's Main Goals section already commits to. *Consequence:* worst-case memory is bounded and predictable — the work budget already caps `paths * periods` at 10,000,000, so this buffer never exceeds roughly `10,000,000 * 8 bytes ≈ 80 MB` plus one extra row of `paths` values for period zero. *Limitation:* 80 MB is still a lot for a browser tab; Phase 2's worker will need to watch actual memory behavior at the real maximum, and a future phase could stream quantiles period-by-period instead of buffering everything if that turns out to matter. This phase deliberately does not solve that; it only keeps the current approach inside the already-agreed budget.
    4. **Run one path at a time, period by period, calling `stepPortfolioPeriod` unchanged.** For each path: start from `allocateInitialInvestment`, record that as period zero's equity, then for periods `1..periods` call `engine.nextScenario()` once and feed it straight into `stepPortfolioPeriod` from Phase 1.4 with no modification. *Intuition:* this is the "single extension boundary" promise made all the way back in Phase 1.1 — the accounting function does not know or care that its scenario came from a bootstrap draw. *Consequence:* the engine's internal PRNG stream advances once per `nextScenario()` call, in path-major then period-minor order (all of path 0's periods, then all of path 1's periods, and so on); this ordering is now part of the run's deterministic identity, alongside the seed. *Future problem to flag:* if a later change ever wants to run paths in parallel (for example, splitting work across several Web Workers in a future performance phase), the paths can no longer share one engine instance advancing a single stream — each worker would need its own independently-seeded engine, and the exact scenario sequence would change. That tradeoff is intentionally deferred; Phase 1.5 optimizes for one clear, provably reproducible sequence, not for parallelism.
    5. **Only treat non-finite equity as a path failure — not `neutralReturn`.** After each period, check `Number.isFinite(result.equity)`. If it fails, record one `SimulationFailure { pathIndex, periodIndex, code, message }`, stop simulating further periods for that path, and fill its remaining period slots in the flat buffer with `NaN` (never `0`). *Intuition:* under the validated dataset's rules (returns floored at $-100\%$) and Phase 1.4's long-only accounting, equity can reach exactly zero (a full wipeout) but cannot go negative or non-finite — so this check is a defensive contract for engines this phase does not control, not a condition expected to fire under bootstrap sampling of real data. *Why not guard `neutralReturn` too:* a fully wiped-out, lump-sum, single-asset path can legitimately produce a `0 / 0` `neutralReturn` in a later period even though its equity (a real, meaningful $0) is perfectly finite; `neutralReturn` belongs to a future volatility/Sharpe phase that will define its own handling for that case when it is built. Scoping the guard to just what Phase 1.5 actually consumes (equity) avoids solving a problem this phase does not have yet. *Consequence:* quantile computation (step 6) must explicitly skip `NaN` entries rather than let them silently count as zero-valued observations, which is what a naive flat-buffer default would otherwise produce. *Limitation:* this failure path is expected to be dormant in ordinary bootstrap runs against validated data; it is proven with a deliberately malformed hand-built fake engine in tests, not with real historical data, precisely because real data cannot trigger it today.
    6. **Compute one canonical quantile function and reuse it everywhere.** In `core/math/quantiles.ts`, implement `computeQuantile(sortedAscendingValues, q)` using linear interpolation between order statistics: $h=(n-1)q$, then interpolate between the values at $\lfloor h\rfloor$ and $\lceil h\rceil$. This is the same method spreadsheets call `PERCENTILE.INC` and NumPy calls its default `linear` method, chosen specifically so a hand-checked spreadsheet value and the app's own number agree exactly. *Intuition:* "percentile" has more than one textbook definition (there are at least nine named methods in common statistics references); the README requires picking exactly one and using it everywhere so that, for example, the p50 line on a future chart always matches the p50 number in the metrics table. *Consequence:* export a single `QUANTILE_VERSION` constant next to the function, so if this method is ever changed, every stored or exported result can say precisely which rule produced it — mirroring how `HISTORICAL_BOOTSTRAP_MODEL_VERSION` and `XOSHIRO128_STAR_STAR_VERSION` already work. *Limitation:* linear interpolation between order statistics is a smooth, well-behaved estimator for large samples, but with very few surviving (finite) observations at a period — for example, if almost every path has already failed by then — a "10th percentile" computed from 3 numbers is not a statistically meaningful percentile; this phase computes the number honestly rather than hiding the small sample, but does not add a separate small-sample warning. That is a reasonable future addition once real failure rates are observed.
    7. **Compute the five period bands by aggregating *across paths*, not *across time*.** `computeQuantileSeries` takes one cross-sectional sample per period — "every path's equity at period $t$" — sorts it ascending, and calls `computeQuantile` five times for $q\in\{0.10,0.25,0.50,0.75,0.90\}$ to fill `QuantileSeries.p10..p90`, one `Float64Array` of length `periods + 1` each. *Intuition:* this is the axis that is easy to mix up — the band chart's p50 line is "the median outcome among all simulated futures at that point in time," not "the median value of one path's history." *Consequence:* this directly implements the README's Visualization rule that percentile bands are aggregate statistics and must never be treated as a selectable individual path. *Advantage:* keeping `computeQuantile`/`computeQuantileSeries` as small pure functions over plain arrays (not the runner's flat buffer) makes them trivially hand-testable with 3–5 element examples, independent of any simulation machinery.
    8. **Select retained full-detail paths deterministically by index, not by percentile or randomly.** Define `RETAINED_PATH_COUNT = 50` and always retain paths `0` through `min(50, paths) - 1`. For each retained path, store its full `values: Float64Array` (equity at every period) and its `scenarios: readonly PeriodScenario[]` (one per period, so a future UI can show which historical rows were sampled). *Intuition:* every path is an equally valid, independent draw — there is nothing statistically special about "path 7" versus "path 12,003" — so picking a fixed prefix is not a biased sample, and it is trivially deterministic and easy to test. *Advantage over alternatives:* selecting "the path closest to p50" or a random subset would need extra computation or an extra PRNG draw, and would make the retained set depend on details (like tie-breaking) that are harder to pin down exactly in a test. *Limitation, explicitly flagged for a future decision:* the retained, clickable paths a user inspects will almost never include the exact paths whose terminal wealth happens to sit at p10/p25/p50/p75/p90 — a user clicking through the 50 retained lines cannot assume any of them represents "the median outcome." If that turns out to matter for the product, a later phase could deliberately retain, say, the paths nearest each quantile in addition to (or instead of) the first 50; this phase does not do that, to keep selection simple and independent of the quantile computation.
    9. **Assemble the full `SimulationResult`, deferring version identity to the caller where this file cannot know it.** Return `{ ok: true, value }` where `value.metadata.config` is the full, unmodified input configuration; `value.metadata.dataset` is `dataset.identity` (version, checksum, frequency, base currency); `value.metadata.algorithms` combines a `modelVersion` and `prngVersion` supplied by the caller (because only the caller knows which engine and PRNG built the scenarios) with this file's own `QUANTILE_VERSION`; `terminalWealth` is every path's final equity (or `NaN` for a failed path); `quantiles` comes from step 7; `retainedPaths` comes from step 8; and `failures` lists every recorded `SimulationFailure`. *Consequence:* a downstream export or bug report can always answer "exactly which data, seed, model, and quantile rule produced this number," which is the README's explicit requirement for every result and export.
    10. **Prove it with tests that isolate each moving part.** For `quantiles.ts`: hand-checked linear-interpolation examples (including exact order statistics when $h$ is an integer, and interpolated values when it is not), the single-value case, and a full period-by-period `computeQuantileSeries` example small enough to check by hand. For `runSimulation.ts`: a tiny fixed dataset and fixed seed run through by hand (comparing every period's holdings, contribution, and equity, not just the terminal value); the retained-path count and index selection at `paths` below, at, and above 50; the work-budget and path-count rejections reusing `validateSimulationConfig`'s existing boundaries; and a deliberately broken fake `SimulationEngine` (returning a non-finite asset return) that proves a path failure is recorded, its remaining periods are `NaN` rather than `0`, and quantiles computed over the same period correctly ignore that `NaN` instead of treating it as a zero-wealth outcome.
  - [x] **Phase 1.6 — Proof and completion gate.** Colocate Vitest tests with every `core/` module. Cover one-asset compounding, all three cash-flow modes, aligned-row bootstrap behavior, seeded reproducibility, quantile interpolation, invalid inputs, and accounting invariants. Validate one small seeded simulation period by period against an independent spreadsheet or Python calculation, including sampled row, holdings, contribution, neutral return, and equity rather than terminal wealth alone. Run formatting, linting, strict TypeScript checking, unit/statistical tests, and a production build; document PRNG/model/quantile versions and results in `LOG.MD`. Phase 1 is complete only when these checks pass without using React or visual chart inspection.
- [ ] **Dataset artifact gate — required before Phase 2.** Build one reproducible USD weekly release through the offline Python pipeline: a schema-validated `assets.json` catalogue, `manifest.json`, FX provenance, inflation and short-rate series, and the base-currency return matrix. Use each asset's hedge-aware `returnCurrency`/`fxTreatment` rule rather than listing venue, fail on unresolved proxy or FX routes, and validate checksums, dimensions, byte length, dates, units, finite selected rows, metadata references, and the 260-week common-history minimum. This proves that the worker will receive one complete, auditable data contract rather than an ad hoc fixture; EUR and monthly artifacts remain later work.
- [ ] **Phase 2 — Worker integration.** Move the bootstrap-only runner into the Web Worker: transferable buffers, run IDs, batching, progress, and cancellation. Connect its real output to uPlot on the Phase 0 shell. This proves the browser architecture end-to-end while only one engine depends on it, so integration problems surface early and cheaply.
- [ ] **Phase 3 — Parametric Student's $t$ engine.** Degrees-of-freedom estimation, covariance repair, Cholesky sampling — reusing the worker plumbing proven in Phase 2 unchanged.
- [ ] **Phase 4 — Real input/configuration UI.** Replace the minimal shell with the full Portfolio Construction, Simulation and Portfolio Inputs, Execution State, Results, and Validation/Accessibility behavior defined in "Frontend Layout and Interaction Specification."
- [ ] **Phase 5+ — Remaining scope.** Benchmark comparison, rebalancing, transaction costs, taxes, leverage/margin calls, CSV export, second base currency, and the Markov engine, in the order fixed by "Implementation Order" steps 6–8.