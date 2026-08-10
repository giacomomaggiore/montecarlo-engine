# Implementation Log

## 2026-08-04 - Phase 0 frontend shell

### Scope completed

Implemented the Work-in-Progress Plan's Phase 0 only:

- Created a Vite, React, and TypeScript application in the repository root.
- Added the required routes: `/`, `/education`, and `/resources`.
- Added a persistent header with active navigation links.
- Added a single `Run` button to the Engine route.
- Added a deterministic placeholder result rendered as raw JSON after `Run` is selected.
- Did not add a dataset loader, portfolio inputs, simulation engine, worker, chart, financial calculations, or real execution state. Those belong to later phases.

### Files added and their responsibilities

#### Root configuration

- `package.json`: declares the application, Node 20 runtime family, npm 10.5.2 package-manager version, scripts, and frontend/test dependencies.
- `package-lock.json`: records the exact dependency tree installed by npm.
- `index.html`: Vite's HTML document and React mount point (`#root`).
- `tsconfig.json`: TypeScript project references.
- `tsconfig.app.json`: strict TypeScript settings for browser application source.
- `tsconfig.node.json`: TypeScript settings for Vite configuration.
- `vite.config.ts`: enables the React Vite plugin and configures Vitest to use jsdom plus the test setup file.
- `eslint.config.js`: configures JavaScript/TypeScript linting and React hook rules.
- `.prettierrc.json`: configures Prettier with single quotes, no semicolons, and trailing commas.
- `.prettierignore`: excludes the authored specification documents, source data, build output, and installed dependencies from formatter checks.
- `vercel.json`: rewrites all deployed routes to `index.html` so direct browser visits to `/education` and `/resources` load the React application.
- `.gitignore`: now also ignores `node_modules/`, `dist/`, coverage output, and TypeScript build metadata.

#### Application source

- `src/main.tsx`: creates the React root, enables React strict mode, mounts the browser router, and imports global CSS.
- `src/app/App.tsx`: renders the shared header/navigation and maps URLs to the three page components.
- `src/features/simulator/SimulatorPage.tsx`: renders the Phase 0 Engine page, owns the local result state, and exposes the single `Run` action.
- `src/features/simulator/placeholderRun.ts`: provides the deterministic temporary result `{ engine: 'phase-0-placeholder', terminalWealth: 100000 }`. Phase 1 can replace this call with the real headless simulation runner.
- `src/features/education/EducationPage.tsx`: minimal placeholder for the future educational content.
- `src/features/resources/ResourcesPage.tsx`: minimal placeholder for curated external references.
- `src/styles/global.css`: shared responsive styling, navigation state styling, focus indicators, and readable raw-result display.
- `src/test/setup.ts`: loads Testing Library DOM matchers for Vitest.
- `src/app/App.test.tsx`: verifies that Run reveals the placeholder result and that the Educational and External Resources routes render.

### Dependencies installed

- Runtime: `react`, `react-dom`, `react-router-dom`.
- Build and quality tooling: Vite, TypeScript, ESLint, Prettier, and their React/TypeScript integrations.
- Tests: Vitest, jsdom, Testing Library, and `@testing-library/user-event`.

### Implementation notes

- The first npm installation attempt could not use the user-level npm cache because it contains root-owned files. Installation succeeded using a writable temporary cache.
- npm emitted a non-blocking engine warning for transitive `eslint-visitor-keys@5.0.1`: it prefers Node 20.19.0 or newer, while the available Node version is 20.13.1. Lint, tests, and the production build still completed successfully.
- Vitest must run outside the VS Code terminal sandbox in this environment because its package resolver reads a parent package scope that the sandbox blocks.
- The initial test exposed one missing declared package, `@testing-library/user-event`; it was added to `devDependencies` and the test then passed.
- The initial TypeScript build exposed two configuration errors: the optional `end` navigation property needed an explicit value for every route, and `defineConfig` needed to come from `vitest/config` to type the `test` section. Both were corrected.
- React Router v7-compatible future flags are enabled in the browser and test routers to suppress upgrade warnings while retaining the React Router v6 API.
- The Vite server cannot bind to localhost within the terminal sandbox, so it was started with the required local-network permission.

### Validation completed

- `npm test`: passed, 1 test file and 3 tests.
- `npm run lint`: passed.
- `npm run format`: passed.
- `npm run build`: passed; TypeScript type-check and Vite production bundle both completed.
- Browser smoke test at `http://127.0.0.1:5173/`: confirmed the header, Engine route, Run JSON result, navigation to `/education`, and direct reload of `/education`.

### Current development server

The Vite development server is running at `http://127.0.0.1:5173/`.

### Deferred to later phases

- Phase 1: aligned historical joint bootstrap, portfolio accounting, deterministic PRNG, core unit/statistical tests, and real result types.
- Phase 2: Web Worker execution, batching, run IDs, progress, cancellation, and uPlot integration.
- Later phases: parametric Student's t engine, inputs, dataset loading, benchmark, costs, taxes, leverage, export, EUR support, and Markov extension.

## 2026-08-04 - Phase 1.1 core contracts and validation

### Scope completed

Implemented the framework-independent foundations required before the bootstrap engine:

- Defined the in-memory aligned dataset contract.
- Defined simulation settings, cash-flow modes, scenario, result, failure, and engine contracts.
- Added explicit dataset and simulation-configuration validation.
- Added focused unit tests for valid boundaries and invalid inputs.
- Did not add random sampling, bootstrap logic, portfolio accounting, file loading, binary parsing, worker code, chart code, or React changes.

### Files added

- `src/core/validation.ts`: shared discriminated `ValidationResult` and `ValidationError` types. Validators return `{ ok: false, errors }` for normal invalid input rather than clipping values or throwing user-facing exceptions.
- `src/core/data/datasetTypes.ts`: `Frequency`, `BaseCurrency`, dataset identity, aligned data columns, the 60-month/260-week minimum-observation rule, and `validateAlignedDataset`.
- `src/core/simulation/simulationTypes.ts`: immutable simulation configuration, lump-sum/DCA/value-averaging union, `PeriodScenario`, result metadata/result shapes, limits, and `validateSimulationConfig`.
- `src/core/simulation/simulationEngine.ts`: the minimal `SimulationEngine` interface. An engine can only return its next complete `PeriodScenario`; it cannot access portfolio state or React.
- `src/core/data/datasetTypes.test.ts`: 14 tests for aligned-dataset boundaries and error conditions.
- `src/core/simulation/simulationTypes.test.ts`: 15 tests for configuration, cash-flow, seed, horizon, path-count, and work-budget boundaries.

### Operational behavior

- An `AlignedDataset` contains one common date vector, selected asset identifiers, one `Float32Array` return series per asset, inflation, and risk-free-rate series. Every series must have the same row count, so a row always represents one historical observation across all required values.
- Dataset validation requires non-empty version/checksum, supported frequency and base currency, unique non-empty asset IDs, one to six assets, valid strictly increasing ISO dates, finite values, returns no lower than $-100\%$, and at least 260 weekly or 60 monthly observations.
- Simulation validation requires a weight per asset, long-only weights summing to 100% within 0.01 percentage points, finite non-negative investment and contribution values, a valid cash-flow variant, an unsigned 32-bit seed, a horizon no longer than 30 years, no more than 50,000 paths, and no more than 10,000,000 path-period operations.
- The contracts keep `listingCurrency`, ETF metadata, FX conversion, binary parsing, and browser fetching outside the core runner. The future pipeline converts data into validated base-currency aligned columns before simulation begins.

### Validation completed

- Focused Phase 1.1 test run: 29 tests passed.
- Complete Vitest suite: 3 test files and 32 tests passed.
- `npm run lint`: passed after removing two unused generic markers from test helpers.
- `npm run format`: passed after applying Prettier to four new files.
- `npm run build`: passed; strict TypeScript checking and the production Vite bundle completed.

### Next step

Implement Phase 1.2: the versioned deterministic `xoshiro128**` pseudo-random generator. The bootstrap engine in Phase 1.3 will use it to choose complete aligned historical rows reproducibly.

## 2026-08-05 - Phase 1.2 deterministic PRNG

### Scope completed

Implemented the framework-independent random source required by the historical bootstrap engine:

- Added a local, versioned `xoshiro128**` pseudo-random generator.
- Expanded every validated unsigned 32-bit seed into four state words with a fixed SplitMix32-style rule.
- Added unsigned integer, unit-interval uniform, and unbiased bounded-integer draws.
- Did not add dataset sampling, portfolio accounting, React, workers, or browser randomness.

### Files added

- `src/core/math/random.ts`: exports `XOSHIRO128_STAR_STAR_VERSION` (`xoshiro128**-v1`) and `createXoshiro128StarStar`. The generator uses the seed-expansion rule of adding `0x9e3779b9` before each word, then applying the two MurmurHash3-style mixing multipliers `0x85ebca6b` and `0xc2b2ae35`. It rejects an all-zero expanded state.
- `src/core/math/random.test.ts`: 16 focused tests for fixed seed vectors, version identity, reproducibility, seed divergence, unsigned and uniform output bounds, bounded row-index bounds, and invalid seed/bound rejection.

### Operational behavior

- `nextUint32()` returns an unsigned integer from 0 through $2^{32}-1$.
- `nextUniform()` returns `nextUint32() / 2^{32}`, so the result is in $[0,1)$.
- `nextInt(upperExclusive)` uses rejection sampling before taking a remainder. This avoids favoring historical rows when the row count does not divide evenly into $2^{32}$.
- The generator has no dependency on simulation state, datasets, React, or `Math.random()`. Phase 1.3 will use `nextInt(dataset.dates.length)` to select one complete aligned row per period.

### Validation completed

- Focused PRNG test run: 1 test file and 16 tests passed.
- Complete Vitest suite: 4 test files and 48 tests passed.
- `npm run lint`: passed.
- `npm run format`: passed.
- `npm run build`: passed; strict TypeScript checking and the production Vite bundle completed.

### Next step

Implement Phase 1.3: the historical joint bootstrap engine. It will draw exactly one source-row index per period and return every asset return, inflation, risk-free rate, and source-row metadata from that same aligned row.

## 2026-08-06 - Phase 1.3 historical joint bootstrap engine

### Scope completed

Implemented the framework-independent historical joint-bootstrap scenario engine:

- Added a deterministic bootstrap engine that samples one complete aligned historical row per scenario.
- Preserved asset-return ordering and joint inflation/risk-free observations from the same source row.
- Added a versioned bootstrap-model identifier and focused deterministic, identity, isolation, and distribution tests.
- Did not add portfolio accounting, cash flows, result aggregation, dataset loading, binary parsing, workers, React state, or browser randomness.

### Files added

- `src/core/simulation/historicalBootstrap.ts`: exports `HISTORICAL_BOOTSTRAP_MODEL_VERSION` (`historical-bootstrap-v1`) and `createHistoricalBootstrapEngine(dataset, seed)`. The factory creates one private local `xoshiro128**` generator and returns the existing `SimulationEngine` contract.
- `src/core/simulation/historicalBootstrap.test.ts`: five focused tests for model identity, fixed-seed row selection, complete-row projection, same-seed reproducibility, different-seed divergence, fresh scenario return arrays, and finite-sample row-frequency tolerance.

### Operational behavior

- The factory accepts an already validated `AlignedDataset` and an unsigned 32-bit seed. Seed validation remains centralized in `createXoshiro128StarStar`; production callers validate dataset structure before constructing the engine.
- Each `nextScenario()` call draws exactly one `sourceRowIndex` with `random.nextInt(dataset.dates.length)`. The index is sampled with replacement, so any historical row may repeat immediately.
- Asset returns are read from every `dataset.assetReturns` column at that same index; inflation and the base risk-free rate use the identical index. The resulting `PeriodScenario` therefore preserves contemporaneous cross-asset and macro-series dependence for each sampled period.
- A new ordinary `number[]` is returned for asset returns on every call. The engine never writes to the dataset's typed arrays, carries portfolio state, or samples columns independently.
- The engine intentionally does not preserve serial dependence, volatility clustering, or crisis duration between scenarios because each period is an independent row draw.

### Validation completed

- Focused engine test: 1 test file and 5 tests passed.
- Complete Vitest suite: 5 test files and 53 tests passed.
- `npm run lint`: passed.
- `npm run format`: passed after Prettier formatted the two new TypeScript files.
- `npm run build`: passed; strict TypeScript checking and the Vite production build completed.

### Next step

Implement Phase 1.4: minimal unleveraged portfolio accounting. It will apply each bootstrap scenario's simple returns to holdings, then process end-of-period DCA or contribution-only value-averaging contributions without rebalancing existing holdings.

## 2026-08-10 - Phase 1.4 minimal unleveraged portfolio accounting

### Scope completed

Implemented the smallest pure accounting step that turns one `PeriodScenario` plus the previous period's holdings into the next period's holdings:

- Added initial-investment allocation, per-asset return compounding, scheduled-contribution calculation for all three cash-flow modes, contribution investing, and a single orchestrating step function.
- Applied returns before contributions in every case, so a contribution never earns the return of the period in which it arrives.
- Never rebalanced existing holdings; only new contributions are invested at target weights, so weights can drift over time.
- Added hand-calculated tests for compounding, timing, drift, value averaging, and value conservation.
- Did not add taxes, transaction costs, debt/leverage, benchmark handling, rebalancing, result aggregation, dataset loading, workers, or React changes.

### Files added

- `src/core/portfolio/cashFlows.ts`: exports `PortfolioPeriodResult`, `allocateInitialInvestment`, `applyPeriodReturn`, `computeScheduledContribution`, `investContribution`, and `stepPortfolioPeriod`.
- `src/core/portfolio/cashFlows.test.ts`: 9 tests for one- and two-asset compounding, DCA timing, weight drift, value-averaging shortfall and no-withdrawal behavior, and value conservation.

### Operational behavior

- `allocateInitialInvestment(initialInvestment, weights)` splits the period-zero lump sum across assets; every later contribution reuses the same target-weight split.
- `applyPeriodReturn(holdings, assetReturns)` grows each asset independently with `holding * (1 + return)`. It has no notion of a portfolio total, so it stays correct regardless of which engine produced the scenario.
- `computeScheduledContribution(cashFlow, periodIndex, initialInvestment, preContributionEquity)` returns `0` for `lumpSum`, the fixed amount for `dca`, and `max(0, A_0 + periodIndex * targetIncrease - preContributionEquity)` for `valueAveraging`. The `max(0, ...)` clamp is the only thing that prevents value averaging from ever modeling a withdrawal.
- `investContribution(holdings, weights, contribution)` adds `weights[i] * contribution` to each holding and leaves every other unit of value exactly where the return step left it, so weights drift away from target between contributions.
- `stepPortfolioPeriod(...)` orders these steps as apply-return, then compute-contribution, then invest-contribution, matching the README's per-period operation list. It returns holdings, the actual external contribution, total equity, and `neutralReturn`, the pre-contribution equity growth rate that later volatility and Sharpe calculations will use.
- Every function takes and returns plain `number`/`number[]` values (never `Float32Array`) and never mutates its `holdings` or `weights` argument, so one simulated path cannot corrupt another path's state.

### Validation completed

- Focused portfolio test run: 1 test file and 9 tests passed.
- Complete Vitest suite: 6 test files and 62 tests passed.
- `npm run lint`: passed.
- `npm run format`: passed after Prettier formatted the two new files.
- `npm run build`: passed; strict TypeScript checking and the Vite production build completed. One intermediate build failure was found and fixed: a test's `let holdings` variable was inferred as mutable `number[]` from its first assignment and then rejected the `readonly number[]` returned by `stepPortfolioPeriod`; the fix was an explicit `readonly number[]` annotation on the `let` declaration.

### Next step

Implement Phase 1.5: the headless runner and quantiles. It will call the bootstrap engine and `stepPortfolioPeriod` once per period per path, enforce the path/period work budget, and compute p10/p25/p50/p75/p90 terminal-wealth bands with a versioned linear-interpolation rule.

## 2026-08-10 - Phase 1.5 headless runner and quantiles

### Scope completed

This is the phase where every earlier Phase 1 piece is driven together for the first time: the validated dataset (1.1), the seeded PRNG (1.2), the bootstrap engine (1.3), and the per-period accounting step (1.4) now run inside one loop that produces the small, chart-ready summary a future UI will render.

- Added the single canonical percentile function used everywhere in the app, plus a function that turns "every path's value at each period" into five p10–p90 band series.
- Added the runner that drives `paths × periods` calls to the engine and to `stepPortfolioPeriod`, enforces the existing path/work-budget validation, and assembles the full versioned result.
- Added explicit, non-silent handling for the one way this accounting can produce a broken number (non-finite equity), including how the quantile step must treat it.
- Added deterministic selection of which paths keep their full period-by-period detail.
- Did not add dataset loading, binary parsing, workers, charts, React state, or the parametric engine.

### Files added

- `src/core/math/quantiles.ts`: exports `QUANTILE_VERSION` (`quantile-linear-interpolation-v1`), `QUANTILE_LEVELS`, `computeQuantile`, and `computeQuantileSeries`.
- `src/core/math/quantiles.test.ts`: 7 tests — version identity, single-value input, an exact order statistic, a fractional interpolation, a hand-checked textbook p10/p90 pair, cross-sectional aggregation, and NaN-filtering.
- `src/core/simulation/runSimulation.ts`: exports `RETAINED_PATH_COUNT` (`50`), `RunSimulationInput`, and `runSimulation`.
- `src/core/simulation/runSimulation.test.ts`: 5 tests — a full hand-calculated three-period run, version/metadata propagation, config-rejection reuse, retained-path selection at 3 and 60 paths, and a deliberately broken fake engine proving explicit failure handling.

### Operational behavior

- `computeQuantile(sortedAscendingValues, q)` implements $h=(n-1)q$ and linearly interpolates between the values at $\lfloor h\rfloor$ and $\lceil h\rceil$. This is the same rule as Excel's `PERCENTILE.INC` and NumPy's default `linear` method, chosen so a hand-checked spreadsheet number and the app's own number always agree exactly. `computeQuantileSeries` calls it five times per period, once each for $q\in\{0.10,0.25,0.50,0.75,0.90\}$, over the cross-section of every path's value **at that period** — never over one path's own history.
- `runSimulation` first calls the existing `validateSimulationConfig`, reading `assetCount` from `dataset.assetIds.length` rather than from `config.weights.length`, so a mismatched config is actually caught rather than compared to itself. On failure it returns `{ ok: false, errors }` — the exact same `ValidationResult` shape Phase 1.1 already defined and tested, just instantiated with a different success payload type.
- On success, it loops `pathIndex` from `0` to `paths - 1`; for each path it starts from `allocateInitialInvestment`, then for periods `1..periods` draws one scenario from the already-constructed engine and feeds it into `stepPortfolioPeriod`, unmodified, exactly as Phase 1.4 defined it.
- Per-period equity for every path is written into one flat `Float64Array` of length `(periods + 1) * paths`, indexed as `period * paths + pathIndex`, instead of a nested `number[][]`.
- If `stepPortfolioPeriod` ever returns a non-finite `equity`, the path is marked failed at that period: one `SimulationFailure` is recorded, and every remaining period slot for that path — in both the flat buffer and, if the path is retained, its `RetainedPath.values` — is explicitly set to `NaN`, never left at the typed array's default `0`.
- The first `min(50, paths)` paths (by index, in order) are retained with their full `values` (equity at every period) and `scenarios` (one `PeriodScenario` per period). Every other path only contributes to `terminalWealth` and the quantile aggregation.
- The final `SimulationResult` combines the caller-supplied `modelVersion`/`prngVersion` (this file cannot know which engine produced the scenarios) with this file's own `QUANTILE_VERSION`, alongside the full `config`, the dataset's `identity`, `terminalWealth`, `quantiles`, `retainedPaths`, and `failures`.

### Design rationale — intuition, advantages, consequences, and limitations

This section exists so the choices above can be evaluated, not just read as a list of facts.

- **Reusing `ValidationResult<T>` for the whole run's outcome.**
  _Intuition:_ Phase 1.1 already defined a generic "ok, or a list of structured errors" shape and used it for dataset and config validation. _Advantage:_ `runSimulation` needed zero new failure-reporting code — the `ok: false` branch never depended on which success payload (`T`) it was paired with, so returning it straight from `validateSimulationConfig` just worked. _Consequence:_ the runner's contract stays symmetric with everything callers already know how to handle. _Limitation:_ this only protects against invalid **run-level** input (bad config); it says nothing about a single path failing mid-run, which is a separate, per-path concept handled by `failures` instead.

- **The runner receives an already-built `SimulationEngine`; it never constructs one.**
  _Intuition:_ the runner's job is "loop and account," not "know how to sample history." _Advantage:_ Phase 3's Student's $t$ engine will plug into this exact file with no changes — the single extension boundary promised since Phase 1.1 actually holds. _Consequence:_ the engine's private PRNG stream advances once per `nextScenario()` call in path-major, period-minor order (all of path 0, then all of path 1, ...); that ordering is now part of a run's reproducible identity, together with the seed. _Limitation, flagged for later:_ this design assumes one engine advances through the whole run sequentially. If a future performance phase wants to split paths across multiple Web Workers for speed, each worker would need its own independently-seeded engine, and the exact scenario sequence — and therefore the exact numbers for a given seed — would change. That tradeoff was not made now; it is explicitly deferred.

- **One flat `Float64Array` instead of a `number[][]` for per-period equity.**
  _Intuition:_ this is the same "typed arrays for large simulation data" idea the README's Main Goals section already commits to — a flat array of raw 8-byte numbers has no per-element object/pointer overhead. _Advantage:_ memory is bounded and predictable: the existing work budget already caps `paths × periods` at 10,000,000, so this buffer is at most about 80 MB, plus one extra row of `paths` values for period zero. _Consequence:_ the whole per-period equity history for the run is held in memory at once — this phase does not stream or discard it early. _Limitation:_ 80 MB is still substantial for a browser tab; nothing here proves that is comfortable at the real 50,000-path, 10,000,000-work maximum. Phase 2's worker integration is the point where this needs to be checked against a real browser, and a future phase could compute quantiles period-by-period instead of buffering everything if it turns out to matter. This phase intentionally stays inside the already-agreed budget rather than solving a problem that has not been observed yet.

- **Only `equity` is checked for non-finite values — not `neutralReturn`.**
  _Intuition:_ under the validated dataset's rules (returns floored at $-100\%$) and Phase 1.4's long-only accounting, equity can reach exactly zero (a total wipeout) but cannot go negative or become non-finite. A fully wiped-out, lump-sum, single-asset path can still legitimately compute a `0 / 0` `neutralReturn` in a later period, even though its equity — a real, meaningful $0 — is perfectly finite. *Advantage:* the guard is scoped to exactly what Phase 1.5 consumes (equity, for terminal wealth and quantile bands), so this phase does not have to invent a policy for a metric (`neutralReturn`) that belongs to a future volatility/Sharpe phase. *Consequence:* quantile computation must treat `NaN` entries as "no observation," not "worth $0" — `computeQuantileSeries` filters them out before sorting, rather than letting a naive default silently count them as zero-valued outcomes. _Limitation:_ this failure path is expected to be dormant for ordinary bootstrap runs against real, validated data; it was proven with a deliberately broken hand-built fake engine in tests (returning an `Infinity` return), not with real historical data, precisely because real data cannot trigger it today. It exists as a defensive contract for engines this phase does not control, including future ones.

- **Retained paths are the first `min(50, paths)` by index — not random, not percentile-matched.**
  _Intuition:_ every simulated path is an equally valid, independent draw; there is nothing statistically special about path 7 versus path 12,003, so a fixed prefix is not a biased sample. _Advantage:_ this is the simplest possible rule to implement and to test exactly — no extra PRNG draw, no tie-breaking logic, no dependency on the quantile computation. _Consequence:_ the retained, clickable paths a future UI shows a user will almost never include the exact paths whose terminal wealth sits at p10/p25/p50/p75/p90. A user should not assume any retained line "is the median outcome." _Limitation, explicitly left open:_ if that turns out to matter for the product, a later phase could deliberately retain paths nearest each quantile instead of (or in addition to) the first 50. That is a real, foreseeable product question this phase does not answer — it was deferred on purpose to keep path selection independent of, and simpler than, quantile computation.

### Validation completed

- Focused Phase 1.5 test run: 2 test files (`quantiles.test.ts`, `runSimulation.test.ts`) and 12 tests passed.
- Complete Vitest suite: 8 test files and 74 tests passed.
- `npm run lint`: passed.
- `npm run format`: passed after Prettier formatted the four new files.
- `npm run build`: passed; strict TypeScript checking and the Vite production build completed. Two intermediate type errors were found and fixed: (1) a `let holdings` variable needed an explicit `readonly number[]` annotation for the same reason as in Phase 1.4 — it was first assigned a mutable `number[]` and then rejected the `readonly number[]` returned by `stepPortfolioPeriod`; (2) a conditionally-created `retainedScenarios` array needed an explicit `PeriodScenario[] | null` annotation, because TypeScript inferred an empty array literal (`[]`) as type `never[]` and then rejected every `.push(scenario)` call.
- One test-authoring error was caught and fixed before this validation: the first hand-written `computeQuantileSeries` test used incorrect hand-calculated p10/p90 values (910/1090 instead of the correct 920/1080 for $h=0.4$ and $h=3.6$); the test comments now show the exact arithmetic so the numbers can be re-checked independently.

### Next step

Implement Phase 1.6: the proof and completion gate for all of Phase 1. This adds no new production code — it validates one small seeded simulation period-by-period against an independent spreadsheet or Python calculation (sampled row, holdings, contribution, neutral return, and equity, not just terminal wealth), confirms the full Vitest suite/lint/format/build all pass together, and documents the PRNG/model/quantile versions and results here before Phase 1 is considered complete.

## 2026-08-10 - Phase 1.6 proof and completion gate

### Scope completed

Closed out Phase 1 with no new production code:

- Added an independent, from-scratch Python reimplementation of `xoshiro128**` and the cash-flow accounting rules, derived from the README's prose rather than by reading the TypeScript source, and used it to produce period-by-period ground truth for one lump-sum, one DCA, and one value-averaging run.
- Added a Vitest test that drives the real `createHistoricalBootstrapEngine`, `stepPortfolioPeriod`, and `runSimulation` against those same seeds/dataset/configs and asserts an exact match against the independently computed sampled row, holdings, contribution, neutral return, and equity at every period — not terminal wealth alone.
- Confirmed the complete Vitest suite, lint, format, and production build all pass together.
- Expanded `README.md` with a "Core Engine Reference — Phase 1 (As Built)" section documenting every function written in `src/core/` so far, with purpose/intuition/code-intuition for each, and checked off the Phase 1.6 and Phase 1 items in the Work-in-Progress Plan.
- Did not add dataset loading, binary parsing, workers, charts, React state, or the parametric engine.

### Files added

- `validation/phase_1_6_independent_check.py`: a from-scratch `xoshiro128**` (SplitMix32-style seed expansion, MurmurHash3 finalizer mixes, rejection-sampled bounded draws) and a from-scratch reimplementation of `allocateInitialInvestment`/`applyPeriodReturn`/`computeScheduledContribution`/`investContribution`/`stepPortfolioPeriod`. Not part of the shipped pipeline or app and not run by CI — kept only as a reproducible audit trail. Every literal return is round-tripped through an actual 32-bit float (`struct.pack`/`unpack`) before use, so its output reflects the same Float32-transport rounding a `Float32Array` read produces in the browser, rather than comparing against unrounded decimal literals.
- `src/core/simulation/independentCheck.test.ts`: 3 tests (lump sum, DCA, value averaging), each replaying a fixed seed against a fixed six-row, two-asset dataset, asserting every period's sampled row, contribution, neutral return, and holdings against the Python script's printed output, and cross-checking that `runSimulation`'s retained-path equity agrees with the same manually driven loop.

### Operational behavior

- The Python script's row draws for the three chosen seeds against the six-row fixture: lump sum (seed 42) draws rows `[0, 1, 2, 0]`; DCA (seed 7) draws `[0, 5, 5, 2]`; value averaging (seed 123) draws `[1, 1, 1, 4]`. Matching these exactly in the TypeScript engine's `sourceRowIndex` output is what proves the seed-expansion rule and the rejection-sampled `nextInt` are portable, not just internally self-consistent.
- The first cross-check run failed by design: the Python script initially used unrounded `float64` literals (e.g. exactly `0.05`) while the TypeScript engine reads returns out of a `Float32Array`, whose nearest-float32 value of `0.05` is not exactly `0.05`. The ~6e-7 mismatch this produced is exactly the Dataset Format rule "`Float32` is a transport format, not the accounting precision" made visible; the fix was rounding the Python literals through the same 32-bit format before computing, not loosening the test's tolerance.
- Value averaging's contribution numbers are the most sensitive of the three modes to this rounding, because each period's contribution depends on the _previous_ period's compounded equity ($C_t=\max(0, A_0+t\Delta-E_t^-)$) — a small return-rounding difference compounds into the contribution, not just the terminal equity.

### Validation completed

- Focused Phase 1.6 test run: 1 test file (`independentCheck.test.ts`) and 3 tests passed.
- Complete Vitest suite: 9 test files and 77 tests passed.
- `npm run lint`: passed.
- `npm run format`: passed for every project file (`src/`, `validation/`, `README.md`, `LOG.MD`). Prettier's `--write` also normalized pre-existing `*em*`-style emphasis markers to `_em_` in the Phase 1.5 log entry above; that change is unrelated to Phase 1.6 and is not a content edit.
- `npm run build`: passed; strict TypeScript checking and the Vite production build completed with no changes needed.
- Algorithm/quantile versions carried by every result as of this gate: `prng: xoshiro128**-v1`, `model: historical-bootstrap-v1`, `quantile: quantile-linear-interpolation-v1`.

### Phase 1 completion

All of Phase 1 — core contracts and validation (1.1), the deterministic PRNG (1.2), the historical bootstrap engine (1.3), unleveraged portfolio accounting (1.4), the headless runner and quantiles (1.5), and this proof gate (1.6) — is now complete, cross-checked against an independent implementation, and documented. Phase 1 and Phase 1.6 are checked off in `README.md`'s Work-in-Progress Plan.

### Next step

Implement the dataset artifact gate: one reproducible USD weekly release through the offline Python `pipeline/` — schema-validated `assets.json`, `manifest.json`, FX provenance, inflation/short-rate series, and the base-currency return matrix — validated the same way the browser will validate it (checksum, dimensions, byte length, dates, units, finite selected rows, metadata references, 260-week common-history minimum). This is required before Phase 2 (Web Worker integration) can connect real data to the engine proven in Phase 1.
