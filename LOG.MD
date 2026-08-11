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
- Added a Vitest test that drives the real `createHistoricalBootstrapEngine`, `stepPortfolioPeriod`, and `runSimulation` against those same seeds/dataset/configs and asserts a match (strict equality for the sampled row index, `toBeCloseTo(_, 6)` for contribution, neutral return, holdings, and equity) against the independently computed values at every period — not terminal wealth alone.
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

## 2026-08-10 - Code review 01

### Scope completed

Addressed four findings from an automated `/code-review` pass over the Phase 1.6 diff and CLAUDE.MD. No behavioral changes to the engine; all fixes are to tests, an offline validation script, documentation accuracy, and CLAUDE.MD scoping:

- `src/core/simulation/independentCheck.test.ts` was hand-deriving the initial two-asset holdings split (`INITIAL_INVESTMENT * WEIGHTS[i]`, with two redundant `as number` casts) instead of calling the already-exported `allocateInitialInvestment` helper that `runSimulation.ts` itself uses for the same computation. Replaced the literal with a call to `allocateInitialInvestment`, so the "independent cross-check" test can't silently drift from the real initial-allocation rule if that helper's behavior ever changes.
- This file's own Phase 1.6 entry (above) said the test "asserts an exact match" against the independent Python trace; the test in fact uses `toBeCloseTo(_, 6)` for contribution, neutral return, holdings, and equity, and only `sourceRowIndex` is checked with strict `toBe`. Reworded the entry to state the actual per-field assertion precision, so this completion-gate note can't be read as claiming bit-exact verification it doesn't do.
- `validation/phase_1_6_independent_check.py` defined the reimplemented PRNG as `class Xoshiro128StarStar` with `__init__`/`next_uint32`/`next_int` methods — the only class in the repo's Python code, directly contradicting the "linear, procedural code, avoid custom classes" rule this same CLAUDE.MD enforces for Python. Rewrote it as three plain functions (`init_state`, `next_uint32`, `next_int`) that thread an explicit `(s0, s1, s2, s3)` state tuple instead of mutating `self`, matching the free-function style already used by `allocate_initial_investment`/`step_portfolio_period` in the same file. Re-ran the script after the rewrite and confirmed every printed row draw and numeric trace is byte-identical to the version pasted into the TypeScript test.
- CLAUDE.MD's "Coding Standards" sections for Python and TypeScript had lost the sentences scoping each section to a directory, leaving it ambiguous whether the Python rules covered `validation/` (outside `pipeline/`) or the TypeScript rules covered test files. Restored an explicit scope line for each section: Python now states it applies to `pipeline/` and other standalone scripts such as `validation/`; TypeScript now states it applies to everything under `src/`, including tests.

### Incidental fix

Before editing `LOG.MD`, found the working tree already had 101 lines of uncommitted deletions relative to `HEAD` — the entire Phase 1.5 and Phase 1.6 sections above, including the exact "exact match" text one of the findings pointed at — despite the session's git status snapshot reporting a clean tree. This was unrelated to the review findings and not made by this work. Restored the deleted sections with `git checkout -- LOG.MD` before applying the wording fix, so no prior log history was lost.

### Validation completed

- Focused test run: `independentCheck.test.ts` and `cashFlows.test.ts`, 12 tests passed.
- Complete Vitest suite: 9 test files and 77 tests passed.
- `npm run lint`: passed.
- `npm run format` (checked on the touched non-Python files: `independentCheck.test.ts`, `CLAUDE.md`, `LOG.MD`): passed. Prettier has no parser for `.py` files, so `phase_1_6_independent_check.py`'s formatting was verified instead by re-running it and diffing its output against the trace already pasted into the TypeScript test.
- `npm run build`: passed; strict TypeScript checking and the Vite production build completed with no changes needed.

### Next step

Resume the dataset artifact gate described above — the code review findings did not change the plan for Phase 2.

## 2026-08-11 - Phase 2 Worker integration, and an offline ETF data helper

### Scope completed

Two independent pieces of work landed together in this session:

1. Implemented all of Phase 2 — Worker integration — exactly as newly detailed in `README.md`'s Work-in-Progress Plan (Phase 2.1 through 2.6): a temporary placeholder dataset, a framework-independent Worker message protocol, a batched/progress-reporting extension to `runSimulation`, the actual `simulation.worker.ts` entry point, a React `useSimulationWorker` lifecycle hook with run-ID-based stale-message filtering, and a uPlot quantile-band chart — replacing the Phase 0 raw-JSON dump on the Engine page with a real Run/Cancel/chart pipeline running end to end in a Web Worker.
2. Added `pipeline/fetch_etf_data.py`, an offline helper for downloading new tickers into `data/` and for auditing the currency/exchange/history of tickers already there, and used its `lookup` command to build the first `pipeline/etf_metadata.csv` covering every ticker currently in `data/`.

Neither piece touches the still-pending Dataset artifact gate: Phase 2 deliberately runs against a synthetic placeholder dataset, and the ETF helper only grows the raw `data/` CSV inputs that gate will eventually consume — it does not produce `assets.json`, `manifest.json`, or the versioned binary return matrix.

### Files added — Phase 2

- `src/features/simulator/placeholderDataset.ts` / `.test.ts`: `createPlaceholderDataset()`, a deterministic 312-row, two-asset synthetic `AlignedDataset` generated from the existing `xoshiro128**` PRNG (not hand-typed rows). Its `DatasetIdentity.version` contains the literal string `placeholder` so a Phase 2 result can never be mistaken for output of the real Dataset artifact gate loader.
- `src/workers/workerMessages.ts` / `.test.ts`: the Worker message protocol (`RunRequestMessage`, `ProgressMessage`, `ResultMessage`, `ErrorMessage`), plus two pure rules: `isCurrentRun(activeRunId, messageRunId)` and `buildTransferList(result)`.
- `src/workers/executeRun.ts` / `.test.ts`: `executeRun(request, emit)`, the entire executable logic of the Worker boundary — dataset validation, engine construction, calling `runSimulation` with a progress callback, emitting exactly one terminal message — with no dependency on `self` or `postMessage`, so it is unit-tested with a plain array collecting `emit()` calls instead of a real Worker thread.
- `src/workers/simulation.worker.ts`: the thin, few-line adapter wiring `self.onmessage`/`self.postMessage` around `executeRun`. This is the only file allowed to reference `self`.
- `tsconfig.worker.json` (new) plus a reference from `tsconfig.json` and an exclusion in `tsconfig.app.json`: TypeScript cannot mix the `DOM` and `WebWorker` lib sets in one program, so the Worker entry file gets its own `tsc -b` project, mirroring how `tsconfig.node.json` already isolates `vite.config.ts`.
- `src/features/simulator/executionState.ts` / `.test.ts`: `ExecutionState` (`idle` / `loading-data` / `running` / `completed` / `cancelled` / `failed`, matching the Frontend Layout specification exactly), `reduceExecutionState`, and `messageToAction` — the hook's entire state machine and stale-message filter, tested as plain functions with no Worker or React involved.
- `src/features/simulator/useSimulationWorker.ts`: the one place allowed to construct or `terminate()` a real `Worker`. A fresh `Worker` and a fresh `crypto.randomUUID()` run ID are minted on every `run()` call; `cancel()` is `terminate()` followed by a `cancel` action, never a cooperative flag.
- `src/charts/chartData.ts` / `.test.ts`: `toChartData(result)`, the pure mapping from one `SimulationResult` to a period-index axis plus the five quantile series. Kept in its own module with zero `uplot` import, because importing the `uplot` package at all runs a module-load side effect that calls `matchMedia` — fatal under Vitest's jsdom environment even if no chart is ever constructed.
- `src/charts/portfolioChart.ts`: `createPortfolioChart(container, result)`, using uPlot's native `bands` option to fill a p10–p90 band and a p25–p75 band, with a single visible p50 line. Verified only by manual browser inspection, per the Maintenance Policy's Playwright-smoke-suite carve-out.
- `src/features/simulator/PortfolioChart.tsx`: thin React lifecycle wrapper (`new uPlot` on mount, `.setData()` on a new result, `.destroy()` on unmount).
- `src/features/simulator/SimulatorPage.tsx`: rewritten to call `useSimulationWorker()`, render Run/Cancel against one fixed demo `SimulationConfig` (weekly, 2,000 paths, 520 periods, DCA $100/period, seed 42) and the placeholder dataset, show a live "Running… X / Y paths" indicator and explicit `cancelled`/`failed` states, and render `PortfolioChart` once `completed`.
- `src/test/setup.ts`: added a minimal `window.matchMedia` stub (jsdom has none) so any test importing a module tree that touches `uplot` doesn't crash — explicitly documented as a jsdom gap, unlike the deliberately unstubbed `Worker` global.
- `src/styles/global.css`: added `button:disabled`, `.phase-note`, and `.engine-controls` rules for the new controls.

### Files changed — Phase 2

- `src/core/simulation/runSimulation.ts`: added optional `batchSize`/`onBatchComplete` fields to `RunSimulationInput`. Defaulting `batchSize` to `paths` means every existing Phase 1 call site and test keeps its exact prior behavior; the callback fires from inside the same single-pass loop, so a batched Worker run and an unbatched direct call draw an identical scenario sequence for the same seed. Added one new test proving this (`reports batch progress without changing the computed result`) alongside every pre-existing `runSimulation.test.ts` case, unmodified and still passing.
- `src/app/App.test.tsx`: replaced the Phase 0 test that clicked Run and asserted a raw placeholder JSON value (no longer true) with a test asserting Run starts enabled and Cancel starts disabled. Clicking Run itself is not exercised here: jsdom has no `Worker` global (confirmed directly — `typeof Worker === 'undefined'` in this test environment), so real Worker construction is intentionally outside the unit-test boundary, per the same reasoning as `useSimulationWorker.ts` above.
- Deleted `src/features/simulator/placeholderRun.ts`, superseded by the real pipeline.
- `package.json` / `package-lock.json`: added the one new runtime dependency `uplot`.

### Operational behavior — Phase 2

- The engine's PRNG stream advances in the same path-major, period-minor order whether or not batching is enabled — `onBatchComplete` is a pure notification hook layered on the existing loop, never a second loop or a second engine.
- `executeRun` validates the dataset first, then tries to construct the bootstrap engine inside a `try`/`catch` (a malformed seed throws from `createXoshiro128StarStar`, before `runSimulation`'s own config validation ever runs), then calls `runSimulation`. Every failure path — bad dataset, bad seed, bad config — produces exactly one `ErrorMessage`, never a thrown exception crossing the Worker boundary.
- `reduceExecutionState` is the single place stale-message filtering happens: a `progress`/`result`/`error` action only changes state if the state is currently `running` _and_ its `runId` matches the message's `runId`; otherwise the old state is returned unchanged. This was verified directly: a `result` message for a run ID that was already cancelled, and a late `progress` message from a run ID that has since been superseded, are both dropped without changing displayed state.
- Manual browser verification (Playwright driving a real Chrome instance, since jsdom cannot render or execute a real Worker): clicking Run disables Run, shows "Running… 2000 / 2000 paths", then renders a uPlot chart with a filled outer band, a filled inner band, and a visible median line; starting a second run and clicking Cancel mid-flight shows "Run cancelled.", re-enables Run, and produces no console errors. Screenshots were inspected directly, not just asserted on programmatically.

### Design rationale — the placeholder dataset boundary

Phase 2's purpose, per the newly-written README subtasks, is to prove the _architecture_ — Worker plumbing, message protocol, buffer transfer, cancellation, charting — not to stand up the production dataset early. Building even a small "real-looking" dataset correctly (weekly resampling, common-history alignment, inflation/rate joins) is exactly the work the still-pending Dataset artifact gate exists to do once, correctly, with provenance and checksums; doing a smaller ad hoc version of it here would both duplicate that future work and risk a second, silently-diverging implementation of the same rules. The synthetic placeholder — generated arithmetically from the existing PRNG rather than sourced from any real ticker — makes that boundary impossible to blur: nothing about it can accidentally look like real historical data.

### Files added — ETF data helper

- `pipeline/fetch_etf_data.py`: a procedural (no classes, per `CLAUDE.MD`'s Python standard) offline script with two subcommands:
  - `add TICKER [TICKER ...]`: downloads full daily adjusted-close history for new tickers into `data/<TICKER>.csv` (refusing to overwrite an existing file unless `--overwrite` is passed) and appends a row to `pipeline/etf_metadata.csv` recording currency, exchange, instrument type, local date range/row count, an injection date (default: today), and the source.
  - `lookup TICKER [TICKER ...] [--tickers-file FILE]`: the same currency/exchange/instrument-type/history-length check without writing any price data, optionally appended to a metadata CSV via `--output-csv` (which requires an explicit `--as-of` so a pre-existing ticker's report row is never silently stamped with today's date).
  - Talks to Yahoo Finance's public chart endpoint (`query1.finance.yahoo.com/v8/finance/chart`) directly over `urllib`, not the `yfinance` package: `yfinance`'s separate crumb/session flow hit `YFRateLimitError` repeatedly in this environment, while the same underlying chart endpoint answered every direct request without issue.
  - One real bug was found and fixed while building this: requesting `range=max&interval=1d` makes Yahoo _silently downgrade_ to monthly granularity once a ticker's full history is "too long" for daily bars (confirmed directly — VTI's 25-year history came back as 303 monthly rows instead of the true 6,325 daily rows, with `meta.dataGranularity: '1mo'` in the response). The fix was requesting explicit `period1=0`/`period2=<now>` epoch bounds instead of the `range` shorthand, which keeps `interval=1d` honored across the full span; `extract_series` now also raises loudly if a response's `dataGranularity` is ever anything but `1d`, rather than writing a silently coarser series — the same "never silently clip invalid values into plausible results" rule the README already applies to numeric values applied here to a silently-downgraded date grid.
  - Cross-checked against the repository's own curated data: `add`-ing `IBIT` into a scratch directory produced a CSV byte-for-byte identical (same dates, same full-precision floats) to the existing curated `data/IBIT.csv` for every overlapping row, which is strong evidence the original dataset was itself sourced from this same Yahoo endpoint.
- `pipeline/etf_metadata.csv`: the first metadata table this script produced, from `lookup`-ing all 121 tickers in `data/` that are directly resolvable on Yahoo Finance (columns: `ticker, currency, exchange, instrument_type, first_date, last_date, row_count, injection_date, source`). `first_date`/`last_date`/`row_count` here reflect Yahoo's _live_ full history as of 2026-08-11, not this repository's locally-captured `data/` files — see the report below for the locally-captured figures.

### Operational behavior — ETF data helper

- Currency here is the live-quoted **listing currency** Yahoo reports (`meta.currency` in the chart API response), not yet the README's researched `exposureCurrency`/`fxTreatment` pair — the two can diverge, and did: `VWRA.L` and `IGLA.L` are both listed on the London Stock Exchange (`.L` suffix) but confirmed to trade in **USD**, not GBP. The Dataset artifact gate's `assets.csv` still needs to research each fund's actual economic exposure; this script's currency field is a fast, authoritative-for-listing-currency starting point, not a substitute for that research.
- `data/` is `.gitignore`d (`/data`), so there is no git history to derive an honest injection date from for the tickers already present. Every file in `data/` — all 145 `.csv` files, including `etf_universe.csv` and `reference_indices.csv` — shares the identical filesystem modification date `2026-07-25`, confirmed directly via `stat`; that is the injection date recorded for the whole pre-existing universe in the report below. Any ticker added later via `add` gets its own, distinct injection date going forward.

### Available ETFs — currency and injection date

Primary investable universe: 121 tickers directly resolved against Yahoo Finance's public chart API on 2026-08-11 (`pipeline/fetch_etf_data.py lookup`). Currency is the live-quoted listing currency reported by that API, not yet the README's researched `exposureCurrency` — the Dataset artifact gate still needs to verify each fund's actual economic exposure before this becomes `assets.json`. Local rows/history reflect this repository's `data/<ticker>.csv` as of the shared injection date below (Yahoo has since added a few more trading days for every ticker, since the API was queried after this data was captured).

| Ticker    | Currency | Exchange      | Type       | Local rows | Local history            | Injection date |
| --------- | -------- | ------------- | ---------- | ---------- | ------------------------ | -------------- |
| XTLT.TO   | CAD      | Toronto       | ETF        | 795        | 2023-02-13 to 2026-04-14 | 2026-07-25     |
| CSH.PA    | EUR      | Paris         | ETF        | 4673       | 2008-01-02 to 2026-04-14 | 2026-07-25     |
| CSNDX.MI  | EUR      | Milan         | ETF        | 4111       | 2010-01-26 to 2026-04-14 | 2026-07-25     |
| CSSPX.MI  | EUR      | Milan         | ETF        | 4038       | 2010-05-19 to 2026-04-14 | 2026-07-25     |
| CSSX5E.MI | EUR      | Milan         | ETF        | 4087       | 2010-03-09 to 2026-04-14 | 2026-07-25     |
| EIMI.MI   | EUR      | Milan         | ETF        | 2935       | 2014-07-24 to 2026-04-14 | 2026-07-25     |
| EMUL.MI   | EUR      | Milan         | ETF        | 2769       | 2014-07-25 to 2026-04-14 | 2026-07-25     |
| EXS1.MI   | EUR      | Milan         | ETF        | 4594       | 2008-02-26 to 2026-04-14 | 2026-07-25     |
| MEUD.MI   | EUR      | Milan         | ETF        | 539        | 2024-02-19 to 2026-04-14 | 2026-07-25     |
| SEGA.MI   | EUR      | Milan         | ETF        | 3812       | 2010-01-18 to 2026-04-14 | 2026-07-25     |
| SMEA.MI   | EUR      | Milan         | ETF        | 576        | 2024-01-02 to 2026-04-14 | 2026-07-25     |
| SWDA.MI   | EUR      | Milan         | ETF        | 4200       | 2009-09-25 to 2026-04-14 | 2026-07-25     |
| VAGF.DE   | EUR      | XETRA         | ETF        | 1734       | 2019-06-18 to 2026-04-14 | 2026-07-25     |
| VUTY.AS   | EUR      | Amsterdam     | ETF        | 2592       | 2016-02-24 to 2026-04-14 | 2026-07-25     |
| VWCE.MI   | EUR      | Milan         | ETF        | 1587       | 2020-01-14 to 2026-04-14 | 2026-07-25     |
| XD9U.MI   | EUR      | Milan         | ETF        | 2651       | 2014-09-22 to 2026-04-14 | 2026-07-25     |
| XG7S.DE   | EUR      | XETRA         | ETF        | 3209       | 2013-08-14 to 2026-04-14 | 2026-07-25     |
| XMME.MI   | EUR      | Milan         | ETF        | 2161       | 2017-10-03 to 2026-04-14 | 2026-07-25     |
| AAPL      | USD      | NasdaqGS      | EQUITY     | 4130       | 2010-02-01 to 2026-07-02 | 2026-07-25     |
| AGG       | USD      | NYSEArca      | ETF        | 5732       | 2003-09-29 to 2026-07-13 | 2026-07-25     |
| AVUV      | USD      | NYSEArca      | ETF        | 1706       | 2019-09-26 to 2026-07-13 | 2026-07-25     |
| BIL       | USD      | NYSEArca      | ETF        | 4813       | 2007-05-30 to 2026-07-16 | 2026-07-25     |
| BIV       | USD      | NYSEArca      | ETF        | 4845       | 2007-04-10 to 2026-07-13 | 2026-07-25     |
| BND       | USD      | NasdaqGM      | ETF        | 4845       | 2007-04-10 to 2026-07-13 | 2026-07-25     |
| BNDX      | USD      | NasdaqGM      | ETF        | 3296       | 2013-06-04 to 2026-07-13 | 2026-07-25     |
| BSV       | USD      | NYSEArca      | ETF        | 4845       | 2007-04-10 to 2026-07-13 | 2026-07-25     |
| BTC=F     | USD      | CME           | FUTURE     | 2150       | 2017-12-18 to 2026-07-05 | 2026-07-25     |
| CGDV      | USD      | NYSEArca      | ETF        | 1098       | 2022-02-24 to 2026-07-13 | 2026-07-25     |
| CL=F      | USD      | NY Mercantile | FUTURE     | 6437       | 2000-08-23 to 2026-04-14 | 2026-07-25     |
| CSRSX     | USD      | Nasdaq        | MUTUALFUND | 8820       | 1991-07-01 to 2026-07-13 | 2026-07-25     |
| CTA       | USD      | NYSEArca      | ETF        | 1090       | 2022-03-08 to 2026-07-13 | 2026-07-25     |
| DBC       | USD      | NYSEArca      | ETF        | 4036       | 2010-04-05 to 2026-04-20 | 2026-07-25     |
| DBMF      | USD      | NYSEArca      | ETF        | 1804       | 2019-05-08 to 2026-07-13 | 2026-07-25     |
| DIA       | USD      | NYSEArca      | ETF        | 7163       | 1998-01-20 to 2026-07-13 | 2026-07-25     |
| EFA       | USD      | NYSEArca      | ETF        | 6254       | 2001-08-27 to 2026-07-13 | 2026-07-25     |
| EMB       | USD      | NasdaqGM      | ETF        | 4668       | 2007-12-19 to 2026-07-13 | 2026-07-25     |
| EMLC      | USD      | NYSEArca      | ETF        | 4016       | 2010-07-23 to 2026-07-13 | 2026-07-25     |
| ETH       | USD      | NYSEArca      | ETF        | 494        | 2024-07-23 to 2026-07-13 | 2026-07-25     |
| EWL       | USD      | NYSEArca      | ETF        | 7628       | 1996-03-18 to 2026-07-13 | 2026-07-25     |
| EZU       | USD      | Cboe US       | ETF        | 6525       | 2000-07-31 to 2026-07-13 | 2026-07-25     |
| FTGC      | USD      | NasdaqGM      | ETF        | 3197       | 2013-10-23 to 2026-07-13 | 2026-07-25     |
| FTLS      | USD      | NYSEArca      | ETF        | 2977       | 2014-09-09 to 2026-07-13 | 2026-07-25     |
| GC=F      | USD      | COMEX         | FUTURE     | 6428       | 2000-08-30 to 2026-04-14 | 2026-07-25     |
| GLD       | USD      | NYSEArca      | ETF        | 5444       | 2004-11-18 to 2026-07-13 | 2026-07-25     |
| GOVT      | USD      | Cboe US       | ETF        | 3554       | 2012-02-24 to 2026-04-14 | 2026-07-25     |
| GSG       | USD      | NYSEArca      | ETF        | 5024       | 2006-07-21 to 2026-07-13 | 2026-07-25     |
| HGER      | USD      | NYSE          | ETF        | 1107       | 2022-02-10 to 2026-07-13 | 2026-07-25     |
| HYG       | USD      | NYSEArca      | ETF        | 4844       | 2007-04-11 to 2026-07-13 | 2026-07-25     |
| IBIT      | USD      | NasdaqGM      | ETF        | 626        | 2024-01-11 to 2026-07-13 | 2026-07-25     |
| ICVT      | USD      | Cboe US       | ETF        | 2792       | 2015-06-04 to 2026-07-13 | 2026-07-25     |
| IEF       | USD      | NasdaqGM      | ETF        | 6026       | 2002-07-30 to 2026-07-13 | 2026-07-25     |
| IEFA      | USD      | Cboe US       | ETF        | 3446       | 2012-10-24 to 2026-07-13 | 2026-07-25     |
| IEMG      | USD      | NYSEArca      | ETF        | 3446       | 2012-10-24 to 2026-07-13 | 2026-07-25     |
| IEUR      | USD      | NYSEArca      | ETF        | 3038       | 2014-06-12 to 2026-07-13 | 2026-07-25     |
| IGLA.L    | USD      | LSE           | ETF        | 2142       | 2017-10-19 to 2026-04-14 | 2026-07-25     |
| IJH       | USD      | NYSEArca      | ETF        | 6569       | 2000-05-26 to 2026-07-13 | 2026-07-25     |
| IJR       | USD      | NYSEArca      | ETF        | 6569       | 2000-05-26 to 2026-07-13 | 2026-07-25     |
| IJT       | USD      | NasdaqGM      | ETF        | 6526       | 2000-07-28 to 2026-07-13 | 2026-07-25     |
| IOO       | USD      | NYSEArca      | ETF        | 6433       | 2000-12-08 to 2026-07-13 | 2026-07-25     |
| IWM       | USD      | NYSEArca      | ETF        | 6569       | 2000-05-26 to 2026-07-13 | 2026-07-25     |
| IWR       | USD      | NYSEArca      | ETF        | 6254       | 2001-08-27 to 2026-07-13 | 2026-07-25     |
| LTPZ      | USD      | NYSEArca      | ETF        | 4175       | 2009-09-08 to 2026-04-14 | 2026-07-25     |
| MBB       | USD      | NasdaqGM      | ETF        | 4861       | 2007-03-16 to 2026-07-13 | 2026-07-25     |
| MGC       | USD      | NYSEArca      | ETF        | 4663       | 2007-12-27 to 2026-07-13 | 2026-07-25     |
| MGK       | USD      | NYSEArca      | ETF        | 4663       | 2007-12-27 to 2026-07-13 | 2026-07-25     |
| MGV       | USD      | NYSEArca      | ETF        | 4663       | 2007-12-27 to 2026-07-13 | 2026-07-25     |
| MTUM      | USD      | Cboe US       | ETF        | 3328       | 2013-04-18 to 2026-07-13 | 2026-07-25     |
| OEF       | USD      | NYSEArca      | ETF        | 6462       | 2000-10-27 to 2026-07-13 | 2026-07-25     |
| PBDC      | USD      | NYSEArca      | ETF        | 947        | 2022-09-30 to 2026-07-13 | 2026-07-25     |
| PDBC      | USD      | NasdaqGM      | ETF        | 2873       | 2014-11-07 to 2026-04-14 | 2026-07-25     |
| PFF       | USD      | NasdaqGM      | ETF        | 4851       | 2007-03-30 to 2026-07-13 | 2026-07-25     |
| PREFX     | USD      | Nasdaq        | MUTUALFUND | 6419       | 2000-12-29 to 2026-07-13 | 2026-07-25     |
| PREMX     | USD      | Nasdaq        | MUTUALFUND | 7933       | 1994-12-30 to 2026-07-10 | 2026-07-25     |
| QAI       | USD      | NYSEArca      | ETF        | 4354       | 2009-03-25 to 2026-07-16 | 2026-07-25     |
| QQQ       | USD      | NasdaqGM      | ETF        | 6877       | 1999-03-10 to 2026-07-13 | 2026-07-25     |
| SCHH      | USD      | NYSEArca      | ETF        | 3895       | 2011-01-13 to 2026-07-13 | 2026-07-25     |
| SGOV      | USD      | NYSE          | ETF        | 1536       | 2020-06-01 to 2026-07-13 | 2026-07-25     |
| SHY       | USD      | NasdaqGM      | ETF        | 6026       | 2002-07-30 to 2026-07-13 | 2026-07-25     |
| SI=F      | USD      | COMEX         | FUTURE     | 6430       | 2000-08-30 to 2026-04-14 | 2026-07-25     |
| SLV       | USD      | NYSEArca      | ETF        | 5082       | 2006-04-28 to 2026-07-13 | 2026-07-25     |
| SLYG      | USD      | NYSEArca      | ETF        | 6481       | 2000-10-02 to 2026-07-13 | 2026-07-25     |
| SPY       | USD      | NYSEArca      | ETF        | 5645       | 2004-02-02 to 2026-07-10 | 2026-07-25     |
| TIP       | USD      | NYSEArca      | ETF        | 5684       | 2003-12-05 to 2026-07-13 | 2026-07-25     |
| TLH       | USD      | NYSEArca      | ETF        | 4905       | 2007-01-11 to 2026-07-13 | 2026-07-25     |
| TLT       | USD      | NasdaqGM      | ETF        | 6026       | 2002-07-30 to 2026-07-13 | 2026-07-25     |
| TSLA      | USD      | NasdaqGS      | EQUITY     | 4027       | 2010-06-29 to 2026-07-02 | 2026-07-25     |
| USMV      | USD      | Cboe US       | ETF        | 3701       | 2011-10-20 to 2026-07-13 | 2026-07-25     |
| UTHY      | USD      | NasdaqGM      | ETF        | 764        | 2023-03-28 to 2026-04-14 | 2026-07-25     |
| VB        | USD      | NYSEArca      | ETF        | 5647       | 2004-01-30 to 2026-07-13 | 2026-07-25     |
| VBMFX     | USD      | Nasdaq        | MUTUALFUND | 9969       | 1986-12-11 to 2026-07-10 | 2026-07-25     |
| VBR       | USD      | NYSEArca      | ETF        | 5647       | 2004-01-30 to 2026-07-13 | 2026-07-25     |
| VCIT      | USD      | NasdaqGM      | ETF        | 4182       | 2009-11-23 to 2026-07-13 | 2026-07-25     |
| VEA       | USD      | NYSEArca      | ETF        | 4770       | 2007-07-26 to 2026-07-13 | 2026-07-25     |
| VEIEX     | USD      | Nasdaq        | MUTUALFUND | 8101       | 1994-05-04 to 2026-07-13 | 2026-07-25     |
| VEU       | USD      | NYSEArca      | ETF        | 4867       | 2007-03-08 to 2026-07-13 | 2026-07-25     |
| VFINX     | USD      | Nasdaq        | MUTUALFUND | 11725      | 1980-01-02 to 2026-07-10 | 2026-07-25     |
| VGIT      | USD      | NasdaqGM      | ETF        | 4182       | 2009-11-23 to 2026-07-13 | 2026-07-25     |
| VGK       | USD      | NYSEArca      | ETF        | 5368       | 2005-03-10 to 2026-07-13 | 2026-07-25     |
| VGLT      | USD      | NasdaqGM      | ETF        | 4155       | 2010-01-04 to 2026-07-13 | 2026-07-25     |
| VGSH      | USD      | NasdaqGM      | ETF        | 4182       | 2009-11-23 to 2026-07-13 | 2026-07-25     |
| VGSIX     | USD      | Nasdaq        | MUTUALFUND | 7588       | 1996-05-13 to 2026-07-10 | 2026-07-25     |
| VGT       | USD      | NYSEArca      | ETF        | 5647       | 2004-01-30 to 2026-07-13 | 2026-07-25     |
| VGTSX     | USD      | Nasdaq        | MUTUALFUND | 7599       | 1996-04-29 to 2026-07-13 | 2026-07-25     |
| VMBS      | USD      | NasdaqGM      | ETF        | 4182       | 2009-11-23 to 2026-07-13 | 2026-07-25     |
| VNQ       | USD      | NYSEArca      | ETF        | 5480       | 2004-09-29 to 2026-07-13 | 2026-07-25     |
| VNQI      | USD      | NasdaqGM      | ETF        | 3946       | 2010-11-01 to 2026-07-13 | 2026-07-25     |
| VOO       | USD      | NYSEArca      | ETF        | 3983       | 2010-09-09 to 2026-07-13 | 2026-07-25     |
| VPL       | USD      | NYSEArca      | ETF        | 5368       | 2005-03-10 to 2026-07-13 | 2026-07-25     |
| VT        | USD      | NYSEArca      | ETF        | 4538       | 2008-06-26 to 2026-07-13 | 2026-07-25     |
| VTI       | USD      | NYSEArca      | ETF        | 6304       | 2001-06-15 to 2026-07-13 | 2026-07-25     |
| VTSMX     | USD      | Nasdaq        | MUTUALFUND | 8612       | 1992-04-27 to 2026-07-13 | 2026-07-25     |
| VTV       | USD      | NYSEArca      | ETF        | 5647       | 2004-01-30 to 2026-07-13 | 2026-07-25     |
| VTWO      | USD      | NasdaqGM      | ETF        | 3974       | 2010-09-22 to 2026-07-13 | 2026-07-25     |
| VUG       | USD      | NYSEArca      | ETF        | 5647       | 2004-01-30 to 2026-07-13 | 2026-07-25     |
| VWEHX     | USD      | Nasdaq        | MUTUALFUND | 11725      | 1980-01-02 to 2026-07-10 | 2026-07-25     |
| VWO       | USD      | NYSEArca      | ETF        | 5362       | 2005-03-10 to 2026-07-02 | 2026-07-25     |
| VWOB      | USD      | NasdaqGM      | ETF        | 3296       | 2013-06-04 to 2026-07-13 | 2026-07-25     |
| VWRA.L    | USD      | LSE           | ETF        | 1698       | 2019-07-23 to 2026-04-14 | 2026-07-25     |
| VXUS      | USD      | NasdaqGM      | ETF        | 3885       | 2011-01-28 to 2026-07-13 | 2026-07-25     |
| XLRE      | USD      | NYSEArca      | ETF        | 2643       | 2015-10-08 to 2026-04-14 | 2026-07-25     |
| ^SPGSCI   | USD      | SNP           | INDEX      | 10713      | 1984-01-03 to 2026-07-13 | 2026-07-25     |

Supporting and derived series: 22 files that are not, by themselves, an independent investable asset — proxy-backfilled extensions, computed futures-equivalent series, macro rate/inflation inputs, and backfill-validation reference indices. Currency/exchange for the backfilled and computed rows is inherited from the primary ticker they extend.

| Ticker                       | Currency | Type             | Local rows | Local history            | Injection date | Note                                                    |
| ---------------------------- | -------- | ---------------- | ---------- | ------------------------ | -------------- | ------------------------------------------------------- |
| GLOBAL_BLEND                 | USD      | COMPOSITE        | 7599       | 1996-04-29 to 2026-07-13 | 2026-07-25     | constructed blend, not a single tradable ticker         |
| BTC_EQ_F                     | USD      | COMPUTED         | 2093       | 2017-12-18 to 2026-04-14 | 2026-07-25     | computed equivalent series alongside BTC=F              |
| CL_EQ_F                      | USD      | COMPUTED         | 6437       | 2000-08-23 to 2026-04-14 | 2026-07-25     | computed equivalent series alongside CL=F               |
| GC_EQ_F                      | USD      | COMPUTED         | 6428       | 2000-08-30 to 2026-04-14 | 2026-07-25     | computed equivalent series alongside GC=F               |
| SI_EQ_F                      | USD      | COMPUTED         | 6430       | 2000-08-30 to 2026-04-14 | 2026-07-25     | computed equivalent series alongside SI=F               |
| EMLC_spliced                 | USD      | PROXY-BACKFILLED | 7933       | 1994-12-30 to 2026-07-10 | 2026-07-25     | proxy-backfilled extension of EMLC                      |
| GLD_spliced                  | USD      | PROXY-BACKFILLED | 6495       | 2000-08-30 to 2026-07-10 | 2026-07-25     | proxy-backfilled extension of GLD                       |
| GSG_spliced                  | USD      | PROXY-BACKFILLED | 10712      | 1984-01-03 to 2026-07-10 | 2026-07-25     | proxy-backfilled extension of GSG                       |
| HYG_spliced                  | USD      | PROXY-BACKFILLED | 11725      | 1980-01-02 to 2026-07-10 | 2026-07-25     | proxy-backfilled extension of HYG                       |
| IEMG_spliced                 | USD      | PROXY-BACKFILLED | 8101       | 1994-05-04 to 2026-07-13 | 2026-07-25     | proxy-backfilled extension of IEMG                      |
| PFF_spliced                  | USD      | PROXY-BACKFILLED | 6419       | 2000-12-29 to 2026-07-13 | 2026-07-25     | proxy-backfilled extension of PFF                       |
| SGOV_spliced                 | USD      | PROXY-BACKFILLED | 6540       | 2000-07-03 to 2026-07-10 | 2026-07-25     | proxy-backfilled extension of SGOV                      |
| VNQI_spliced                 | USD      | PROXY-BACKFILLED | 8820       | 1991-07-01 to 2026-07-13 | 2026-07-25     | proxy-backfilled extension of VNQI                      |
| VNQ_spliced                  | USD      | PROXY-BACKFILLED | 7588       | 1996-05-13 to 2026-07-10 | 2026-07-25     | proxy-backfilled extension of VNQ                       |
| EFFR_CASH                    | n/a      | RATE/INFLATION   | 6478       | 2000-07-03 to 2026-04-22 | 2026-07-25     | macro series, not a tradable asset                      |
| FRED_CPIAUCSL                | n/a      | RATE/INFLATION   | 954        | 1947-01-01 to 2026-06-01 | 2026-07-25     | macro series, not a tradable asset                      |
| FRED_EFFR                    | n/a      | RATE/INFLATION   | 6478       | 2000-07-03 to 2026-04-22 | 2026-07-25     | macro series, not a tradable asset                      |
| FRED_SOFR                    | n/a      | RATE/INFLATION   | 1935       | 2018-04-03 to 2025-12-31 | 2026-07-25     | macro series, not a tradable asset                      |
| FRED_US_TREASURY_YIELD_CURVE | n/a      | RATE/INFLATION   | 16843      | 1962-01-02 to 2026-07-23 | 2026-07-25     | macro series, not a tradable asset                      |
| GSG_REFERENCE_INDEX          | USD      | REFERENCE INDEX  | 414        | 1992-01-01 to 2026-06-01 | 2026-07-25     | backfill-validation proxy only, not directly investable |
| VNQ_REFERENCE_INDEX          | USD      | REFERENCE INDEX  | 6431       | 2001-03-30 to 2026-07-15 | 2026-07-25     | backfill-validation proxy only, not directly investable |
| VOO_REFERENCE_INDEX          | USD      | REFERENCE INDEX  | 6431       | 2001-03-30 to 2026-07-15 | 2026-07-25     | backfill-validation proxy only, not directly investable |

### Validation completed

- Complete Vitest suite: 14 test files and 104 tests passed (up from 9 files / 77 tests at the last log entry).
- `npm run lint`: passed.
- `npm run format`: passed on every touched file (Prettier's `--write` also reformatted several of the new files to match project style; no logic changes).
- `npm run build`: passed; `tsc -b` now builds three referenced projects (`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.worker.json`) and the Vite production bundle correctly code-splits `simulation.worker.js` into its own chunk.
- Manual browser verification: described above, under Phase 2 Operational behavior.
- `pipeline/fetch_etf_data.py`: exercised live against Yahoo Finance for both subcommands (`lookup` against 121 real tickers plus one deliberately invalid ticker to confirm `--continue-on-error` behavior; `add` against `IBIT` into a scratch directory, cross-checked byte-for-byte against the curated `data/IBIT.csv`). Not part of the Vitest/lint/build gate — it is an offline pipeline script, validated the way `validation/phase_1_6_independent_check.py` was: by running it and inspecting output, per `CLAUDE.MD`'s Python standards.

### Next step

Resume the dataset artifact gate: build the reproducible USD weekly release (`assets.json`, `manifest.json`, FX provenance, inflation/short-rate series, the base-currency return matrix) from the `data/` inputs now inventoried above, including resolving each fund's actual `exposureCurrency`/`fxTreatment` rather than its listing currency. Phase 3 (parametric Student's $t$) remains next after that, reusing the Phase 2 Worker plumbing unchanged.
