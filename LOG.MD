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

## 2026-08-13 - Dataset artifact gate: USD weekly release

### Scope completed

Closed the Dataset artifact gate — the last item blocking real data from replacing Phase 2's synthetic placeholder. All work is offline Python under `pipeline/`, writing only to `pipeline/metadata/` and `public/data/`; nothing under `src/` changed, and nothing here is wired into the app yet.

- Added `pipeline/build_assets_catalogue.py`, which turns the existing `pipeline/etf_metadata.csv` inventory into the README's editable `assets.csv`/`fx_routes.csv` source-of-truth tables.
- Added `pipeline/build_release.py`, which reads that catalogue plus the raw CSVs in `data/` and writes the three release artifacts: the little-endian column-major `Float32` return matrix, `manifest.json`, and `assets.json`.
- Added `pipeline/validate_release.py`, which re-derives the checksum, dimensions, and byte length from the artifact files themselves (never trusting what the builder claimed) and cross-checks `assets.json` against `manifest.json`.
- Did not add a browser-side loader, binary parser, or any `src/` change — that is separate, future work this gate exists to unblock, not part of it.

### Files added

- `pipeline/build_assets_catalogue.py`: builds `pipeline/metadata/assets.csv` and `pipeline/metadata/fx_routes.csv`.
- `pipeline/build_release.py`: builds `public/data/returns-weekly-usd.f32`, `public/data/manifest.json`, `public/data/assets.json`.
- `pipeline/validate_release.py`: the artifact-side validation gate.
- `pipeline/metadata/assets.csv`, `pipeline/metadata/fx_routes.csv`, `pipeline/metadata/fund_names_cache.csv`: generated data, checked in so the release is reproducible without re-hitting Yahoo Finance.
- `public/data/returns-weekly-usd.f32`, `public/data/manifest.json`, `public/data/assets.json`: the release itself.

### Operational behavior

- **Universe: 98 assets, resolved by scoping rather than by researching every foreign listing.** `pipeline/etf_metadata.csv` already records each ticker's live Yahoo-reported **quote currency** (`meta.currency`) — the currency the observed adjusted-close price is actually denominated in, which is what the README's FX conversion formula needs as its source currency, regardless of listing venue. Rather than researching each of the 17 EUR-quoted and 1 CAD-quoted tickers' true underlying economic exposure (Milan/XETRA/Paris/Amsterdam/Toronto listings), v1 keeps only the 103 tickers already quoted in USD, then drops the 4 `FUTURE` contracts (roll/margin economics don't fit a simple total-return model) and the 1 `INDEX` (`^SPGSCI` is a benchmark, not something investable) — 98 remain (86 ETF, 10 mutual fund, 2 individual equity). For every included asset this makes `exposureCurrency = returnCurrency = USD` true by construction, so the FX formula is the identity and no per-fund exposure research was needed to get it right. The excluded EUR/CAD-quoted tickers — including the two already-confirmed USD-exposure-despite-foreign-listing cases (`VWRA.L`, `IGLA.L`, both already USD-quoted per Yahoo and therefore actually _included_) and the Milan-listed, USD-index-tracking `CSSPX.MI` example from the README itself (EUR-quoted, genuinely excluded) — are deferred to the EUR release, where an FX route actually needs to run.
- **Proxy backfills identified empirically, not assumed.** Nine tickers already have a precomputed `_spliced.csv` extending their history further back than the fund's own inception, but nothing in the repository documented which proxy series was used to build six of them. Correlating each spliced file's pre-inception segment against every other return series in `data/` found an exact match (correlation 1.0000) for every one: `EMLC`←`PREMX`, `GLD`←`GC=F`, `GSG`←`^SPGSCI`, `HYG`←`VWEHX`, `IEMG`←`VEIEX`, `PFF`←`PREFX`, `SGOV`←`BIL`, `VNQI`←`CSRSX`, `VNQ`←`VGSIX`. Each is recorded as a proxy record (`proxyAssetId`, splice date, method, rationale) on the backfilled asset's row in `assets.csv`, as the README's Educational-route backfill disclosure requires.
- **A live data-quality gap surfaced by that correlation check, not hidden by it.** `PFF`'s proxy, `PREFX`, currently resolves on Yahoo to the name "T. Rowe Price Tax-Efficient Equity" — not a preferred-securities strategy, even though its 2000–2007 prices moved in exact lockstep with `PFF`'s own later preferred-stock returns. Mutual fund tickers are sometimes reassigned after a merger or strategy change, so today's fetched name almost certainly does not describe the fund this correlation was measured against in 2000–2007. The proxy relationship is kept — it rests on the measured return correlation, which does not depend on any name — but `PREFX`'s own `name`/`assetClass` fields in the catalogue are flagged in code and here as unverified pending manual research, rather than quietly presented as fact.
- **The matrix's date axis is a union across all 98 assets, not an intersection down to the 260-week minimum.** The README's Dataset Format section requires 260 common weekly rows as a **selection-time** check ("at runtime, retain only rows that are finite for every selected asset") — it is not a requirement that the entire shipped universe share one common window. `ETH`'s 2024-07-23 inception would have collapsed an intersection-based matrix to a handful of weeks for every asset in the release, which would have been actively wrong. Instead every asset's own weekly return series is reindexed onto the union of all 98 assets' plus the risk-free series' weekly dates (2,429 weeks, 1980-01-06 to 2026-07-19), writing `NaN` for any week before that asset's own inception — the same "represent unavailable observations as NaN on disk, never forward-fill" rule the README already states. `validateAlignedDataset`'s existing 260-week check (Phase 1.1) is what will enforce the minimum later, against whichever 1–6 assets a user actually selects. Spot-checked directly: `SPY`+`AGG` share 1,150 common weekly rows; `VOO`+`BND`+`VNQ` share 806; `AAPL`+`TSLA` share 816 — all comfortably above 260.
- **Weekly resampling and returns.** Every price series (assets and the risk-free index) is resampled to one value per calendar week ending Sunday (`W-SUN`, chosen once and applied identically everywhere so two series' weekly dates only ever coincide when they fall in the same real week) using the last valid observation in that week, then turned into a simple return via `pct_change()`. A week with zero source observations resamples to `NaN` and stays `NaN` through the return step — never forward-filled.
- **Risk-free rate uses `EFFR_CASH`, not the raw annualized `FRED_EFFR` percentage.** `EFFR_CASH` is already a compounding index of the actual daily effective fed funds rate (it starts at 1.0 and grows daily); its own weekly `pct_change()` **is** the weekly risk-free return directly, with no separate annualized-to-periodic conversion step needed — simpler and less error-prone than converting `FRED_EFFR`'s raw annualized percentages by hand. Documented in `manifest.json`'s `units.riskFreeRate`.
- **Inflation: monthly CPI split evenly across each month's weekly rows.** `FRED_CPIAUCSL`'s monthly log growth for a given month is divided by however many rows of the already-built weekly date grid fall in that calendar month, and each of those rows gets that equal share as its `CPI_INFLATION` value. Summing a month's weekly increments exactly reproduces that month's original log growth — frequency changes, no new economic information is created, matching the README's Inflation and Risk-Free Rates rule word for word.
- **Binary layout.** `public/data/returns-weekly-usd.f32`: little-endian `Float32`, column-major, 2,429 rows × 100 columns (98 assets in alphabetical `assetId` order, then `CPI_INFLATION`, then `RISK_FREE_RATE`), 971,600 bytes total (`2429 × 100 × 4`). `manifest.json` records `schemaVersion: "dataset-manifest-v1"`, `datasetVersion: "usd-weekly-v1"`, checksum `sha256:f3e62b5fd0e8f6e048529212886417b0bf7e657366446dff138f2cbec0c632f3`, the full ordered date vector, the ordered column list, per-column byte offsets, `dtype`/`byteOrder`/`layout`, per-column-group units, and provenance notes (price/inflation/risk-free sources, week anchor, total-return interpretation).
- **Known, disclosed gaps in this pass.** `assets.csv`'s `isin`, `domicile`, `category`, `distributionPolicy`, `replicationMethod`, and `terAnnual`/`terAsOf`/`terSource` fields are all blank — this pass had no reliable per-fund source for them, and an invented value would violate the "never silently clip invalid values into plausible results" rule worse than an honest gap does. `assetClass` and `region` come from a small, transparent keyword classifier run against each fund's Yahoo-reported long name (see `ASSET_CLASS_KEYWORDS`/`REGION_KEYWORDS` in `build_assets_catalogue.py`) — a disclosed heuristic, not researched fact; one gap it caught and fixed during this pass was `MBB` ("iShares MBS ETF") initially falling through to `equity` because the classifier's bond keywords included "mortgage-backed" but not the "MBS" abbreviation actually used in the name.

### Validation completed

- `python pipeline/build_assets_catalogue.py`: ran clean, wrote 98 rows to `pipeline/metadata/assets.csv` (0 empty names) and an empty, header-only `pipeline/metadata/fx_routes.csv`.
- `python pipeline/build_release.py`: ran clean, wrote `public/data/returns-weekly-usd.f32` (971,600 bytes, 2,429 rows × 100 columns), `public/data/manifest.json`, `public/data/assets.json`.
- `python pipeline/validate_release.py`: all five checks passed — checksum matches the file's actual bytes; byte length matches `rowCount × columnCount × 4`; all 2,429 dates are valid ISO and strictly increasing; every value across all 100 columns is finite or the documented `NaN` sentinel (no `+/-Infinity` anywhere); `assets.json`'s 98 assets match `manifest.json`'s column list exactly, and every asset's reported `history.rowCount` matches the matrix's actual finite-value count for that column.
- Manual sanity pass on the matrix values: per-column weekly return ranges are all inside plausible bounds for their asset type (e.g. broad equity ETFs roughly ±15–20% in the worst weeks, `SGOV`/`BIL` T-bill-like funds inside ±0.5%, `CPI_INFLATION` inside ±0.36% per week, `RISK_FREE_RATE` inside 0–0.13% per week) — no sign of a units or alignment bug producing implausible outliers.
- Not part of this gate's Vitest/lint/build gate — these are offline pipeline scripts with no `src/` dependency, validated the way every other `pipeline/`/`validation/` script in this repo is: by running them and inspecting output, per `CLAUDE.MD`'s Python standards.

### Next step

Wire a real browser-side loader (`core/data/loadDataset.ts`, per the Recommended Project Structure) that fetches `manifest.json`/`assets.json`/`returns-weekly-usd.f32`, validates them with the same rules `pipeline/validate_release.py` already checks pipeline-side, and slices out the user's selected ≤6 assets into an `AlignedDataset` — replacing Phase 2's synthetic placeholder in `SimulatorPage`. After that, Phase 3 (parametric Student's $t$) is next, reusing the Phase 2 Worker plumbing unchanged; the EUR release and the deferred non-USD-quoted tickers remain separate, later work.

## 2026-08-13 - Architecture walkthrough: Run click to rendered chart

### Scope completed

No code changed. This entry documents the existing Phase 2 data flow end to end — every file the click on **Run** passes through before a chart appears — as a reference for future sessions, the same way the Phase 1 "Core Engine Reference" section in `README.md` documents `core/`. Written in response to a direct question about how the pieces connect; recorded here rather than left only in chat because it is exactly the kind of "why does this boundary exist" context that is expensive to reconstruct from the source files alone.

### The trace, file by file

1. **Click → main thread.** [`SimulatorPage.tsx`](src/features/simulator/SimulatorPage.tsx) `handleRun()` calls the `run()` function returned by `useSimulationWorker()`, passing the placeholder dataset, the fixed demo `SimulationConfig`, and the model/PRNG version strings.
2. **The hook mints a fresh Worker per run, never a reused one.** [`useSimulationWorker.ts`](src/features/simulator/useSimulationWorker.ts): terminates any previous Worker, mints a new `runId` (`crypto.randomUUID()`), dispatches `loading-data-started` then `run-started` (state becomes `{status:'running', runId, pathsCompleted:0, totalPaths}`), constructs `new Worker(...)`, wires `worker.onmessage`, then `postMessage`s one `RunRequestMessage`. _Why a new Worker every time, not a long-lived one reused across runs:_ it is what makes `cancel()` a true hard stop later — `runSimulation`'s loop is synchronous and has no cooperative point to check a "please stop" flag mid-batch, so the only reliable stop is killing the whole thread.
3. **`RunRequestMessage` crosses a real thread boundary.** The dataset and config are structured-cloned into the Worker's separate memory space — this is a genuine copy, not a reference, which is why the _return_ path in step 6 below bothers to avoid a second one.
4. **Thin adapter → framework-independent logic.** [`simulation.worker.ts`](src/workers/simulation.worker.ts) is the only file allowed to reference `self`/`postMessage`; it immediately hands the message to `executeRun`, which has no idea it is running inside a Worker.
5. **`executeRun` validates, builds an engine, runs, reports exactly once.** [`executeRun.ts`](src/workers/executeRun.ts): `validateAlignedDataset` → construct `createHistoricalBootstrapEngine(dataset, config.seed)` inside a `try`/`catch` (a malformed seed throws before `runSimulation`'s own config validation ever runs) → call `runSimulation` with `onBatchComplete` wired to `emit({type:'progress', ...})`. Every exit path calls `emit` with exactly one terminal message (`result` or `error`) — never a thrown exception crossing back out of the Worker.
6. **`runSimulation` is the actual `paths × periods` loop — no Worker or React dependency at all.** [`runSimulation.ts`](src/core/simulation/runSimulation.ts): for each path, each period, `engine.nextScenario()` draws one historical row index and reads every asset/inflation/risk-free value from that same row, then `stepPortfolioPeriod` applies the return and invests the contribution. Equity is written into one flat `Float64Array`. Every `batchSize` paths it calls `onBatchComplete`, which is what fires the progress `emit` from step 5 back out through the Worker.
7. **The terminal message transfers its buffers instead of cloning them.** [`workerMessages.ts`](src/workers/workerMessages.ts) `buildTransferList` collects every `ArrayBuffer` backing `terminalWealth`, the five quantile series, and each retained path's values; `simulation.worker.ts` passes that list as `postMessage`'s second argument. This _moves ownership_ of that memory to the main thread (zero-copy) instead of duplicating it — the difference between an `O(N×T)` copy plus a matching GC pause, and neither, once the buffer approaches the ~80&nbsp;MB the work budget allows. `progress`/`error` messages carry no transfer list; they are a handful of numbers, cheap enough to structured-clone.
8. **Back on the main thread, one reducer is the single gatekeeper for every message.** [`executionState.ts`](src/features/simulator/executionState.ts) `applyMessage` first checks `isCurrentRun(state.runId, message.runId)`. If the state is not currently `running`, or the message's `runId` does not match, the message is dropped unmodified — this is the entire "ignore stale messages" rule, and it is what stops an old, superseded Worker's late-arriving message from corrupting a newer run's displayed state (the concrete race: user edits inputs and clicks Run again while the first Worker's `result` is still in flight). Only a message that passes moves the state machine: `progress` updates `pathsCompleted`/`totalPaths`, `result` moves to `completed`, `error` moves to `failed`.
9. **React re-renders off that state alone.** [`SimulatorPage.tsx`](src/features/simulator/SimulatorPage.tsx): `running` renders the live "Running… X / Y paths" counter; `cancelled`/`failed` render explicit status text; `completed` renders `<PortfolioChart result={state.result} />`.
10. **The chart component is a lifecycle wrapper, not chart logic.** [`PortfolioChart.tsx`](src/features/simulator/PortfolioChart.tsx): on mount, and again whenever the `result` prop changes, calls `createPortfolioChart(container, result)` and keeps the returned instance in a ref; on unmount (or before the next result), calls `.destroy()` on it first.
11. **Pure mapping, kept `uplot`-import-free on purpose.** [`chartData.ts`](src/charts/chartData.ts) `toChartData` turns `result.quantiles` into a period-index axis plus five series, with zero dependency on the `uplot` package — importing `uplot` at all touches `matchMedia` as a module-load side effect, which crashes under Vitest's jsdom environment, so the pure mapping has to live somewhere a test can exercise it without ever loading the chart library.
12. **The actual draw.** [`portfolioChart.ts`](src/charts/portfolioChart.ts) feeds `toChartData`'s output into `new uPlot(...)`, using uPlot's native `bands` option to fill p10–p90 and p25–p75 as transparent-stroke band edges, with the p50 series drawn as the one visible line on top.

### Cancellation and the second-run race, traced the same way

Clicking **Cancel** calls `worker.terminate()` directly — a hard kill of the whole thread, not a message asking the loop to stop, for the reason given in step 2. Starting a **second** run while one is still in flight repeats step 2 from the top: the old Worker is terminated and a new `runId`/`Worker` pair is created before the old Worker's last in-flight message could land. Even in the narrow window where one slips through anyway, step 8's `runId` comparison drops it — the two safety nets (terminate-before-replace, and runId-checked-on-receipt) are deliberately redundant, since either one failing alone should still leave the newer run's state correct.

### Next step

Unchanged from the entry above: wire the real `core/data/loadDataset.ts` browser-side loader, replacing `createPlaceholderDataset()` in `SimulatorPage.tsx` with a fetch of the artifacts the Dataset artifact gate produced. That loader will sit at exactly step 1 of this trace, ahead of everything else described here.

## 2026-08-13 - Fixed invalid JSON in the released `assets.json`

### Scope completed

While scoping the upcoming browser-side loader, found that `public/data/assets.json` — produced by the Dataset artifact gate two entries above — is not valid JSON by a strict parser's standard, which would make `response.json()` throw immediately in the browser the first time the loader fetches it. Fixed the root cause in `pipeline/build_release.py` and closed the matching gap in `pipeline/validate_release.py` that let it through undetected. No `src/` change; this is entirely inside the already-existing Dataset artifact gate.

- **Root cause:** `pipeline/metadata/assets.csv` has blank cells for `isin`, `domicile`, `category`, `distributionPolicy`, and `replicationMethod` for most of the 98 assets (an already-disclosed gap from the original gate entry). `pandas.read_csv(..., na_values=[""])` turns each blank cell into a float `NaN`. `build_assets_json` then wrote `row["isin"] or None` intending "fall back to `None` when blank" — but `NaN` is truthy in Python (`bool(float('nan'))` is `True`), so `nan or None` evaluates to `nan`, not `None`. `json.dump` serializes a Python float `NaN` as the bare token `NaN`, which is a Python/JavaScript-`JSON.stringify` extension, not standard JSON — confirmed directly: Python's `json.load` parses the shipped file without complaint, while Node's `JSON.parse` (and therefore a browser's `response.json()`) rejects it with `Unexpected token 'N'`.
- **Why `pipeline/validate_release.py` didn't catch it:** its `check_assets_json_consistency` step already opens `assets.json` with `json.load`, which is exactly as permissive as the code that produced the bug — the gate's own docstring promises to "validate the release the same way the browser eventually will," but Python's default JSON parser is strictly more lenient than a browser's, so this specific defect could pass every existing check.
- **Fix:** added `none_if_blank(value)` in `build_release.py`, using `pd.isna(value)` (the correct blank-cell test, independent of truthiness) in place of every `row[field] or None`. Added `allow_nan=False` to both `json.dump` calls as a second, independent guard — any future NaN leak now crashes the build immediately instead of silently shipping. Added `load_strict_json(path)` in `validate_release.py`, which passes `parse_constant` to `json.load` to reject the `NaN`/`Infinity`/`-Infinity` tokens Python would otherwise accept, and switched both `manifest.json` and `assets.json` reads to it — closing the exact leniency gap that let this ship.

### Validation completed

- Re-ran `python pipeline/build_release.py`: identical checksum (`sha256:f3e62b5fd0e8f6e048529212886417b0bf7e657366446dff138f2cbec0c632f3`) and byte length for `returns-weekly-usd.f32` — this fix only touches `assets.json`'s text, never the matrix.
- Re-ran `python pipeline/validate_release.py`: all five checks still pass, now against the corrected file and the stricter parser.
- Confirmed directly with Node (`JSON.parse` on the raw file contents, the same call a browser's `response.json()` makes internally): both `assets.json` and `manifest.json` now parse without error.

### Next step

Unchanged: implement the browser-side dataset loader described in the Work-in-Progress Plan's new "Dataset loader" phase in `README.md`, replacing `createPlaceholderDataset()` in `SimulatorPage.tsx`.

## 2026-08-13 - Dataset loader: real browser-side data, replacing the Phase 2 placeholder

### Scope completed

Implemented the "Dataset loader" phase added to `README.md`'s Work-in-Progress Plan earlier today: `SimulatorPage.tsx` now fetches, validates, and simulates against the real released `usd-weekly-v1` dataset instead of the synthetic Phase 2 placeholder. While implementing and verifying this against the actual `public/data/` files (not just hand-built fixtures), found and fixed a real design flaw in the loader's own row-selection rule before it shipped — documented in detail below, since it directly contradicts what the just-written README steps originally described.

- Added `src/core/data/loadDataset.ts` and `src/core/data/loadDataset.test.ts`, implementing all ten numbered steps of the README phase: manifest/catalogue schema validation, checksum/byte-length verification via `crypto.subtle.digest`, zero-copy `Float32Array` column views via `manifest.byteOffsets`, per-selection row filtering, reuse of the existing `validateAlignedDataset`, and an in-memory per-session artifact cache.
- Extended `src/features/simulator/executionState.ts` and `src/features/simulator/useSimulationWorker.ts` with the one small state-machine addition the async loader actually requires: a `load-failed` action/transition, and a `latestRunIdRef` guard against the loader's async gap. Both are described in detail below.
- Rewired `src/features/simulator/SimulatorPage.tsx` to a fixed demo portfolio (60% `SPY` / 40% `AGG`) loaded from the real release, replacing `createPlaceholderDataset()`.
- Left `src/features/simulator/placeholderDataset.ts` in place, repurposed: it is no longer reachable from the app's runtime path, but `src/workers/executeRun.test.ts` still legitimately uses it as a small, deterministic `AlignedDataset` fixture for testing the Worker boundary independent of any real data source. Updated its file comment to say so.

### Files added

- `src/core/data/loadDataset.ts`: `parseManifest`, `parseAssetsCatalogue`, `fetchDatasetArtifacts`, `fetchDatasetArtifactsCached`, `sliceAlignedDataset`, `loadAlignedDataset`.
- `src/core/data/loadDataset.test.ts`: 14 tests — 3 direct `parseManifest` schema-rejection tests, 2 direct `parseAssetsCatalogue` tests, and 9 integration tests against hand-built manifest/matrix fixtures with `fetch`/`crypto.subtle.digest` stubbed.

### Files changed

- `src/features/simulator/executionState.ts`: added the `load-failed` action and its reducer case.
- `src/features/simulator/useSimulationWorker.ts`: `run()` now takes a `loadDataset: () => Promise<ValidationResult<AlignedDataset>>` thunk instead of an already-resolved `AlignedDataset`, dispatches `loading-data-started` before awaiting it, and only then proceeds to construct the Worker and dispatch `run-started`.
- `src/features/simulator/SimulatorPage.tsx`: calls `loadAlignedDataset(['SPY', 'AGG'], 'weekly', 'USD')` instead of `createPlaceholderDataset()`; updated the on-page `phase-note` text accordingly.
- `src/features/simulator/placeholderDataset.ts`: file comment updated to describe its new, narrower role as a Worker-test fixture only.
- `src/features/simulator/executionState.test.ts`: added 2 tests for the new `load-failed` transition (a matching failure, and a stale one dropped by the existing run-ID guard).

### Operational behavior

- **Manifest/catalogue validation mirrors the pipeline's own gate.** `parseManifest` checks every field `fetchDatasetArtifacts` later depends on — `schemaVersion`/`datasetVersion`/`checksum` non-empty, `frequency`/`baseCurrency` in the supported literal sets, `dtype`/`byteOrder`/`layout` exactly matching what the pipeline writes, `rowCount`/`byteLength` positive integers, and every `assetColumns`/`specialColumns` entry actually present in both `columns` and `byteOffsets` — before any byte offset is trusted for slicing. `response.json()` already enforces standard JSON syntax; this step enforces _shape_, which a syntactically valid file can still get wrong.
- **Checksum/byte-length verification happens before a single value is read, exactly as the README specifies.** `verifyMatrixIntegrity` computes `expectedByteLength = rowCount * columns.length * 4`, compares it against both the fetched buffer's actual length and the manifest's own claimed `byteLength`, then hashes the buffer with `crypto.subtle.digest('SHA-256', ...)` and compares against `manifest.checksum`. A byte-length mismatch returns immediately without attempting to hash a wrong-sized buffer.
- **An unreleased frequency/currency combination fails before any `fetch` call, not as a 404.** `RELEASED_DATASETS` is a small hardcoded set (`{'weekly:USD'}`) checked first; requesting `monthly`/`EUR` today returns a structured `dataset.release.unavailable` error with zero network activity, proven directly in a test that makes `fetch` throw if called at all.
- **Every fetch exception is caught and converted, never left as an unhandled rejection.** A `try`/`catch` around the whole fetch/parse/verify sequence in `fetchDatasetArtifacts` turns a real network failure (e.g. offline) into the same structured `ValidationResult` failure every other error path already returns.
- **Session-scoped caching keeps a failed fetch from becoming permanent.** `fetchDatasetArtifactsCached` caches the in-flight/resolved promise per `frequency:baseCurrency` key so a second asset selection reslices already-downloaded bytes instead of refetching them, but deliberately deletes the cache entry again on failure — a transient network blip should not block every later attempt for the rest of the session.
- **Row selection filters non-finite rows out; it does not trim to a single contiguous window.** This is the one place the implementation ended up different from what the README phase originally described, covered in its own section below.
- **The async loading-data phase needed one small, deliberate state-machine addition.** `useSimulationWorker`'s `run()` now dispatches `loading-data-started`, awaits `request.loadDataset()`, and only on success dispatches `run-started` and constructs the Worker; on failure it dispatches the new `load-failed` action, which `reduceExecutionState` accepts only when the state is still `loading-data` with a matching `runId` — the same stale-run guard pattern `run-started` and every Worker message already use. A separate `latestRunIdRef` (distinct from the reducer's own state) additionally stops the `.then()` callback itself from constructing a Worker or dispatching anything if a newer `run()`/`cancel()` call has superseded it while the dataset was still loading — the reducer's guard alone only protects the _displayed_ state, not this side effect.

### Design rationale — a real bug found by testing against real data, not fixed by more fixtures

The README phase written earlier today specified: "find the first and last row index where every selected asset column, `CPI_INFLATION`, and `RISK_FREE_RATE` are simultaneously finite, verify every row strictly inside that range is finite too... and must fail rather than be silently skipped." The first implementation did exactly that. Every hand-built Vitest fixture passed.

Verifying the real implementation against the actual `public/data/` files (fetched from a local static file server, with a real `crypto.subtle.digest` call — jsdom's own `SubtleCrypto.digest` rejects `ArrayBuffer`s from outside its own realm, confirmed directly, which is exactly why the Vitest suite stubs it) surfaced the flaw immediately: **`CPI_INFLATION` is `NaN` for nine weeks, 2025-10-05 through 2025-11-30**, because `data/FRED_CPIAUCSL.csv` has one genuinely blank monthly observation (`2025-10-01`). This is not a pipeline bug — the README's own rule is "never forward-fill... mark unavailable," and a blank source row correctly propagating as `NaN` through `pct_change()` for two months is exactly that rule working as intended.

The bug was in the loader's reaction to it. `CPI_INFLATION` is a required column for **every** possible portfolio selection, so the "reject the whole selection on any internal gap" rule meant no selection whose history reached into late 2025 could ever succeed — not a plausible product behavior for one nine-week hole inside an otherwise 1,150-row-plus shared history for a selection like `SPY`+`AGG`. The fix: replace the contiguous first/last-row window with a straight filter — collect every row index where the selected columns are simultaneously finite, in date order, and gather the dataset at exactly those indices. This is both correct and sufficient because `createHistoricalBootstrapEngine` samples one independent joint row per period with no notion of calendar adjacency (Phase 1.3); nothing downstream needs the retained dates to be contiguous, only strictly increasing, which filtering preserves automatically. `validateAlignedDataset`'s existing 260-observation minimum still applies to the filtered result exactly as before.

Re-running the corrected logic against the real matrix reproduced the Dataset artifact gate's own original spot-check numbers exactly: `SPY`+`AGG` → 1,150 common rows (matching the "1,150" figure already recorded in that gate's `LOG.MD` entry), `AAPL`+`TSLA` → 816 rows (matching that entry's figure too). This is strong independent confirmation that the corrected filtering rule is not just theoretically better but numerically consistent with the number the pipeline side already validated — the original, too-strict window rule would have produced a completely different (and wrong: zero, for any selection reaching into 2025) result had it shipped.

`README.md`'s step 5 and step 9 text were rewritten to describe the corrected, filtering-based rule, including this specific discovered gap, rather than the stricter rule that was tried and found wrong. `loadDataset.test.ts`'s gap-handling test was rewritten to match: it now asserts an isolated internal gap is filtered out (dataset still succeeds, with one fewer row and the gap's date absent), not that it causes a hard failure.

### Validation completed

- Focused test run: `src/core/data/loadDataset.test.ts` (14 tests) and `src/features/simulator/executionState.test.ts` (12 tests) passed.
- Complete Vitest suite: 15 test files and 121 tests passed (up from 14 files / 104 tests at the last log entry).
- `npm run lint`: passed.
- `npm run format` / `prettier --check` on every touched file: passed.
- `npm run build`: passed; strict TypeScript checking and the Vite production build completed with no changes needed.
- Independent verification against the real, actual `public/data/` release (not fixtures): a throwaway Node script fetched `manifest.json`/`assets.json`/`returns-weekly-usd.f32` from a local static file server, recomputed the SHA-256 checksum with Node's real `crypto.subtle.digest` (confirmed identical to `manifest.checksum`), and re-derived the row-filtering logic independently — reproducing the Dataset artifact gate's original `SPY`+`AGG` (1,150 rows) and `AAPL`+`TSLA` (816 rows) spot-check figures exactly, and surfacing the `CPI_INFLATION` gap described above. This is the same "second implementation catches what a symmetric mistake in the first one would hide" logic as Phase 1.6's independent Python check, applied here to real data instead of a hand-built fixture.
- Manual verification, partial: confirmed via a real (non-jsdom) Vite dev server, fetched with Node's `fetch`, that `/`, `/data/manifest.json`, `/data/assets.json`, and `/data/returns-weekly-usd.f32` are all served with `200` status and correct content types from the built app. Did **not** perform a full interactive click-through (Run → chart) in an actual browser this session — no browser-automation tool was available, unlike the Playwright verification recorded in Phase 2's log entry. This is a disclosed gap, not a claimed pass: the next session should do that click-through before trusting this phase's UI behavior beyond what the unit tests already cover.

### Next step

Phase 3 (parametric Student's $t$ engine) is next, reusing the Phase 2 Worker plumbing and this loader unchanged. Before that, it would be worth performing the still-missing real-browser click-through for this phase (Run → "Preparing dataset…" → chart, against `SPY`/`AGG`) the next time an interactive browser is available in-session.

## 2026-08-14 - Chart redesign: seven real representative paths, replacing the cross-sectional quantile bands

### Scope completed

Prompted by a direct question about what the chart's median line actually represents, confirmed that the Phase 2.5 band chart's p10–p90 lines were never real simulated paths — each was a synthetic curve built by independently sorting all paths' equity at every single period and taking that period's cross-sectional percentile, so a band's value at period 100 and its value at period 101 could come from two entirely different underlying paths. After walking through that distinction and its tradeoffs, replaced the band chart with seven real, actually-simulated paths (p1, p10, p25, p50, p75, p90, p99), each selected by which path's own terminal wealth lands nearest that quantile of the terminal-wealth distribution — a real trajectory a user could point to and say "this is one of the 2,000 simulated futures," not an aggregate recombined from many. The p1/p99 tail levels were added afterward, at direct request, following the same selection rule.

- Added `RepresentativePath` to `simulationTypes.ts` and a `representativePaths` field to `SimulationResult`, replacing the `quantiles: QuantileSeries` field. `QuantileSeries` the type and `computeQuantileSeries` the function are both kept in `core/math/quantiles.ts` — still correct, still colocated-tested, and still a plausible building block for a future metrics table — but `runSimulation.ts` no longer calls `computeQuantileSeries`.
- Added `runSimulation.ts`'s `selectRepresentativePaths`, which sorts finite terminal wealth once, computes each target quantile value with the existing canonical `computeQuantile`, and picks the nearest actual path per level — cheaper than the replaced per-period cross-sectional sort, not just conceptually different.
- Added `REPRESENTATIVE_PATH_QUANTILE_LEVELS = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]` to `quantiles.ts`, deliberately kept separate from the existing five-level `QUANTILE_LEVELS` (which remains the set the README's still-unbuilt Key Metrics Panel will report terminal wealth at) so the chart's tail markers don't silently redefine that future table's scope.
- Rewrote `src/charts/chartData.ts` and `src/charts/portfolioChart.ts`: the chart now draws seven stroked lines (no fills/bands — each is a real, independent trajectory, and shading "between" two arbitrary real paths would visually imply a distributional spread they do not represent), with p50 the most visually prominent and p1/p99 the thinnest and most muted.
- Updated `workerMessages.ts`'s `buildTransferList` to transfer each representative path's buffer instead of the five retired `QuantileSeries` buffers.
- Updated every test that touched the old `quantiles` field or hardcoded a 5-level list: `runSimulation.test.ts` (new hand-calculated 7-level selection test, replacing the old cross-sectional-band assertions), `chartData.test.ts` (rewritten around `representativePaths`, including a test that two paths are allowed to cross), `workerMessages.test.ts` and `executionState.test.ts` (fixtures now import the real `REPRESENTATIVE_PATH_QUANTILE_LEVELS` instead of a hand-duplicated local list, so they cannot silently drift from it).
- Updated `README.md`: the Visualization and Metrics section, the `core/math/quantiles.ts` and `core/simulation/runSimulation.ts` Core Engine Reference entries, and an amendment note on the Phase 2.5 checklist item (its original numbered steps are left intact as a historical record of what that phase originally built, not of current behavior).

### Operational behavior

- **Why the replacement, precisely:** a cross-sectional statistic ("the median outcome among all simulated futures as of week $t$") and a single simulated path's own history are different objects. The old chart answered the first question at every period independently; nothing about it corresponded to "what happened to one investor." The new chart answers "trace five-to-seven specific, real simulated futures, chosen because of where they ended up."
- **Consequence, verified against real data, not just asserted:** because each representative path is chosen only by its terminal value, two of them can sit on the "wrong" side of each other for long stretches of the run. Reproducing the real demo portfolio (`SPY`/`AGG`, 60/40, seed 42, 2,000 paths, 520 periods) directly against the production dataset: the path selected for p10 sits _above_ the path selected for p90 in 234 of 520 periods — 45% of the run's weekly points. This is not a bug; it is the direct, now-measured cost of the design tradeoff made here, and it is documented inline in `runSimulation.ts` and in the README's Interactive Highlights bullet so a future reader does not mistake visible line-crossing for broken code.
- **Small-sample collapsing is real too, not just theoretical.** With only 5 candidate paths (the hand-calculated test in `runSimulation.test.ts`), p1 and p10 resolve to the identical nearest path, and so do p90 and p99 — there simply aren't enough distinct candidates to give every level its own representative. At the real demo's 2,000 paths, all seven levels resolved to seven distinct paths (verified directly).
- **Terminal values barely moved from the old aggregate's numbers, as expected.** The old cross-sectional interpolated quantile values for the demo portfolio were (from the previous log entry) p10/p25/p50/p75/p90 = 73,549 / 84,516 / 101,650 / 123,607 / 149,405. The new representative paths' own terminal wealths, verified directly against the same real dataset/seed: p1=58,847 (path 1277), p10=73,560 (path 1886), p25=84,533 (path 1015), p50=101,671 (path 973), p75=123,588 (path 1256), p90=149,396 (path 70), p99=220,554 (path 739). The five shared levels differ from the old interpolated statistic by only a few dollars — exactly the expected gap between "the interpolated value" and "the nearest real path's actual value" — which is strong evidence the new selection logic is doing the right thing, not silently picking unrelated paths. The p99 value's much larger jump over p90 (220,554 vs 149,396) is the expected right-skew of compounding equity returns showing up in the tail, not a bug.

### Design rationale — why representative paths were replaceable but the retained-paths mechanism was not

`RetainedPath` (the existing first-`min(50,paths)`-by-index mechanism from Phase 1.5) was left completely untouched. It answers a different question — "give a future click-through UI a broad, unbiased, arbitrary sample of full paths to let a user inspect" — and already does that correctly and simply. `RepresentativePath` answers "which few paths does the _chart_ draw, and why those specific ones." Conflating the two would have made the first-by-index retention biased toward whatever multi-purpose selection the chart needed, or made the chart depend on whether a path happened to be in the arbitrary first-50 prefix. Keeping them as two independent lists, computed from the same underlying `equityByPeriod` buffer, was the cheaper and more honest option.

### Validation completed

- Focused test run: `runSimulation.test.ts` (7 tests, including the new hand-calculated 7-level selection test), `chartData.test.ts` (4 tests), `workerMessages.test.ts` (5 tests), `executionState.test.ts` (12 tests) all passed.
- Complete Vitest suite: 15 test files and 124 tests passed (up from 121 at the last log entry — 3 net new: one `runSimulation.test.ts` selection test, plus 2 new `chartData.test.ts` tests for the axis-independent-of-path-count edge case and the crossing-paths case).
- `npm run lint`: passed.
- `npx tsc --noEmit -p tsconfig.app.json` and `npm run build`: passed with zero errors after every call site of the retired `quantiles`/`QuantileSeries` field was updated.
- `npm run format` / `prettier --check` on every touched file: passed.
- Independent verification against the real, actual `public/data/` release (not fixtures), reusing the same offline-reproduction technique as the Dataset loader entry above (real `sliceAlignedDataset`, `createHistoricalBootstrapEngine`, and `runSimulation`, called directly against the real files via Node's `fs`, bypassing `fetch`): confirmed the 45%-of-periods p10/p90 crossing figure, the 5-path small-sample collapsing behavior, and the seven terminal-wealth figures quoted above, all reported in this entry.

### Next step

Phase 3 (parametric Student's $t$ engine) remains next, unaffected by this chart-only change — it reuses `runSimulation.ts`'s unchanged `paths × periods` loop and will get representative-path selection for free once it is wired in the same way the bootstrap engine is today. The still-missing real-browser click-through noted in the entry above (Run → chart) should now also visually confirm the new seven-line chart, including the expected p10/p90 crossing, the next time an interactive browser is available in-session.

## 2026-08-15 - Phase 3: parametric Student's t engine

### Scope completed

Implemented all of Phase 3 exactly as newly detailed in `README.md`'s Work-in-Progress Plan (Phase 3.1 through 3.6, written first, this session, in the same test-before-UI style as every earlier phase): the second live scenario engine, a multivariate Student's $t$ fitted to the aligned dataset's periodic log returns, behind the exact `SimulationEngine` boundary defined in Phase 1.1. `runSimulation`, `stepPortfolioPeriod`, the Worker protocol's progress/cancel/transfer machinery, and the chart are reused unchanged — the single-extension-boundary promise made in Phase 1.1 was collected in full: not one line of the accounting loop or the runner changed.

- Added the estimation statistics (3.1), matrix routines (3.2), and distribution samplers (3.3) as three new pure `core/math/` modules with colocated tests.
- Added the fit + engine factory (3.4) in `core/simulation/parametricStudentT.ts`, versioned `parametric-student-t-v1`.
- Rewired the Worker request protocol around an `EngineSelection` discriminated union (3.5) and gave the shell a minimal three-button engine selector (Bootstrap / Parametric enabled, Markov Chain disabled and labelled "future").
- Closed the phase with an independent Python cross-check of the whole chain (3.6), the same two-implementations discipline as Phase 1.6.
- Did not add the real parametric input UI (per-holding return overrides, manual $\nu$, editable inflation/risk-free — Phase 4), benchmark, rebalancing, costs, taxes, leverage, EUR, or Markov.

### Files added

Reading order matters here: the first three files are self-contained math tools, the fourth combines them into the actual engine, and the last two check the whole thing against a second implementation.

- **`src/core/math/statistics.ts`** (+ 13 tests) — **the measuring tools.** Before anything can be simulated, the model has to answer four questions about the historical data: what did each asset return on average, how much did returns fluctuate, how strongly did assets move together, and how extreme were the extremes. One function per question: `toLogReturns` first converts each simple return into a log return ($\ell=\ln(1+r)$ — the form that adds cleanly across weeks and can be modeled by a symmetric distribution); `sampleMean` and `sampleCovarianceMatrix` answer the average and the co-movement questions; `computePooledExcessKurtosis` measures how much fatter the tails are than a normal bell curve would predict (positive = crashes and spikes happen more often than a Gaussian says); and `estimateDegreesOfFreedom` converts that tail measurement into the Student's $t$ parameter $\nu$ via $\nu=4+6/\gamma_2$ — small $\nu$ means fat tails, large $\nu$ means "basically Gaussian", clamped to $[5,100]$.
- **`src/core/math/matrix.ts`** (+ 13 tests) — **the correlation-matrix safety tools.** A correlation matrix estimated from real data can come out subtly broken: mathematically it can imply a portfolio combination with _negative_ variance, which no real distribution can produce, and sampling from it would generate garbage. This file can detect that (`jacobiEigenDecomposition` — implemented by hand because the project bans dependencies for short deterministic algorithms, and at most 6 assets the textbook method is fast and reviewable), fix it by moving to the _nearest_ legitimate correlation matrix (`nearestCorrelationMatrix`, Higham's algorithm), and take the matrix "square root" (`choleskyDecompose`) — the one precomputed object the sampler later multiplies plain random noise by to make it correctly correlated. Anything unfixable comes back as a structured error, never as silent NaNs. Tests check against a textbook repair example verified with NumPy and hand-worked factorizations.
- **`src/core/math/distributions.ts`** (+ 9 tests) — **the random-shape converters.** The project's seeded PRNG only produces uniform random numbers (every value equally likely); the $t$ model needs two other shapes. `nextStandardNormal` bends uniforms into bell-curve draws (Box–Muller); `nextGamma`/`nextChiSquare` produce the "how wild is this week?" variable that the $t$ distribution divides by to create occasional extreme periods. Both are written to consume uniforms in the simplest possible fixed order — two shortcuts that would have been slightly faster were deliberately skipped because they'd make the draw sequence harder to reproduce in an independent implementation, and the sequence itself is part of what a seed promises.
- **`src/core/simulation/parametricStudentT.ts`** (+ 13 tests) — **the engine itself, in two halves.** `fitParametricStudentT` reads the historical data _once_ and distills it into a small frozen model: each asset's average drift, the correlated-noise factor from `matrix.ts`, the tail parameter $\nu$, and the user's inflation/risk-free constants converted to per-week values. `createParametricStudentTEngine` then takes that model plus a seed and invents one plausible joint week of returns per call. It plugs into the same `SimulationEngine` interface as the bootstrap, so the runner, accounting, Worker, and chart cannot tell the two engines apart — which is exactly the point.
- **`src/core/simulation/studentTIndependentCheck.test.ts`** (3 tests) — **the referee.** Replays two small seeded simulations end to end and checks every week's returns and portfolio value against numbers produced by the Python script below (details under Independent verification).
- **`validation/phase_3_independent_check.py`** — **the second opinion.** A from-scratch Python version of the whole chain, written from the README's prose rather than from the TypeScript source. Not shipped, not run by CI — it exists so the TypeScript tests can assert against independently derived numbers instead of the code's own output.

### Files changed

- **`src/core/simulation/simulationTypes.ts`** — a bootstrap scenario knows which historical week it was copied from; a parametric scenario is invented, so it has no source week. `sourceRowIndex` can now be `null` to say so honestly (an explicit `null` instead of a `-1` code, so a missing row can never be accidentally used as an array index). Bootstrap behavior unchanged.
- **`src/workers/workerMessages.ts`** — the "run" message the page sends to the Worker now says _which engine to build_ (`bootstrap`, or `studentT` plus its options) instead of carrying version-label strings. The Worker is the one who actually constructs the engine, so it now labels results itself — removing the possibility that the page's label and the real engine ever disagree (a gap Phase 1.5 had flagged).
- **`src/workers/executeRun.ts`** — the Worker-side dispatcher: builds whichever engine was requested. For the parametric engine it runs the fit first, so a bad option or an unusable correlation matrix comes back as an ordinary on-screen error message before any simulation work starts. Written so that adding a future engine without handling it here is a compile error, not a silent fall-through.
- **`src/workers/executeRun.test.ts`** — two new tests: a parametric run must match the same simulation run directly (and carry the parametric version label), and a failed fit must produce exactly one error message. The existing bootstrap test now doubles as proof that the message-format change didn't alter bootstrap results by a single bit.
- **`src/features/simulator/useSimulationWorker.ts`** — passes the engine choice through to the Worker. The run/progress/cancel state machine is untouched — it never needs to know which engine is running — and every existing state test passes unmodified.
- **`src/features/simulator/SimulatorPage.tsx`** — the visible change: a three-button engine selector (Bootstrap, Parametric, and a disabled "Markov Chain (future)" placeholder). Parametric runs with fixed demo settings for now (historical averages, automatic $\nu$, 2% inflation, 3% risk-free); real editable inputs are Phase 4's job. The selection lives in ordinary input state, kept separate from execution state per the Maintenance Policy.
- **`src/styles/global.css`** — styling for the new selector.

### Operational behavior

- **Fit/sample separation.** `fitParametricStudentT` is a pure function from an already-validated `AlignedDataset` plus options to a frozen model — per-period log-return location vector, Cholesky factor of the repaired scale matrix, $\nu$, per-period inflation/risk-free constants, and diagnostics ($\gamma_2$, whether Higham repair actually changed anything). The factory only samples. Every numerical failure is a structured `ValidationResult`, testable without drawing a single sample.
- **The model, in the stated README order.** Fit on log returns (unbounded, additive — the shape a symmetric elliptical $t$ can defensibly model; simple returns are floored at $-100\%$ and cannot be symmetric). $\mu_i$ = historical mean log return (whose annualization _is_ the historical geometric return) or a user-entered annual geometric return as $\ln(1+g_i)/p$; $\Sigma$ always from the data (no editable matrix, per the frontend spec). One shared $\nu$ from pooled standardized residuals. Scale $S=\Sigma(\nu-2)/\nu$ so the simulated covariance matches the measured $\Sigma$ rather than overstating it by the tail factor $\nu/(\nu-2)$. Repair in correlation space preserving per-asset scale, then Cholesky.
- **The draw-order contract.** Each `nextScenario()`: $z_1..z_D$ standard normals in asset order, then one $\chi^2_\nu$; $\ell=\mu+Lz\sqrt{\nu/\chi^2_\nu}$; returns as `expm1(l)`. The shared $\sqrt{\nu/\chi^2_\nu}$ multiplier stretches all assets _together_ in a fat-tailed period — the joint-crash behavior independent per-asset $t$ draws would miss. $e^\ell-1>-1$ always, so the dataset's $-100\%$ floor holds by construction. `sourceRowIndex` is `null`.
- **Unit-matched constants.** Per the Financial Rules, parametric inflation and risk-free rate are user-entered annual constants, converted per-period to match the dataset columns they stand in for: inflation as the log increment $\ln(1+\pi)/p$ (the CPI column ships log increments), the risk-free rate geometrically de-annualized to $(1+r_f)^{1/p}-1$ (the risk-free column ships simple returns).
- **Statistical behavior, measured rather than asserted.** Fixed-seed sample tests verify: generated sample correlation within 0.03 of the fitted target and sample mean near $\mu$ at $n=20{,}000$; and the fat-tail claim directly — measured excess kurtosis of generated returns at $\nu=5$ clearly exceeds the near-zero value at $\nu=100$ on the same seed.
- **Honest failure modes proven in tests.** A constant return series → `parametric.fit.zeroVariance`; two identical assets → correlation exactly 1, which is PSD (Higham correctly returns it unchanged) but singular, so the second Cholesky pivot is exactly zero → structured `matrix.cholesky.notPositiveDefinite`, never NaN samples. This is a real, documented limitation: Higham's nearest correlation matrix can sit exactly ON the PSD boundary, and such a repaired matrix is legitimately unfactorable — an explicit run failure per the Financial Rules, not a silently regularized matrix.

### Independent verification (Phase 3.6)

- `validation/phase_3_independent_check.py` reimplements the full chain from the README's prose — xoshiro128** (the free-function port proven in Phase 1.6), Box–Muller, Marsaglia–Tsang, the estimation pipeline (log returns, mean, ddof=1 covariance, pooled moment-ratio kurtosis, $\nu$ clamp, scale conversion, Higham repair via NumPy's own `eigh`, Cholesky), the scenario rule, and the Phase 1 accounting — and prints fixed-seed reference traces. Unlike Phase 1.6 (integers and $+-\times\div$ only), this chain exercises `exp`/`log`/`cos`/`sqrt`: agreement additionally proves the transcendental-function results match at float64 precision on this platform (they did, to 12 decimal places, without any tolerance loosening).
- `studentTIndependentCheck.test.ts` replays two full seeded runs (DCA seed 42, lump-sum seed 7; 4 periods, 60/40 weights) through the real `fitParametricStudentT` → `createParametricStudentTEngine` → `runSimulation` chain and asserts every period's joint returns and equity against the Python trace — fit values at `toBeCloseTo(_, 12–14)`, equity at `toBeCloseTo(_, 8)`.
- The distributions/fit unit tests' expected values were likewise generated from the Python side first (never by pasting the TypeScript's own output back), including the NumPy-checked Higham example and PSD projection in `matrix.test.ts`.
- **Offline verification against the real released `usd-weekly-v1` dataset** (same fs-based technique as the Dataset loader entry, via a throwaway test since deleted): fitting the demo `SPY`+`AGG` selection (1,150 common rows) gives pooled excess kurtosis **32.82** — real weekly returns are extremely heavy-tailed, so $\nu=4+6/32.82=4.18$ clamps to the **floor $\nu=5$**; Higham repair correctly dormant (the real 2-asset correlation is PD); annualized geometric drift 10.5% (SPY) / 3.0% (AGG) and scale correlation 0.184, all plausible. The full demo run (2,000 paths × 520 weeks, seed 42, DCA) completed with **0 failures**; representative terminal wealth p1/p10/p25/p50/p75/p90/p99 = 58,327 / 71,703 / 83,057 / 100,014 / 120,427 / 149,234 / 223,984 — closely bracketing the bootstrap's previously logged values (58,847…220,554) for the same portfolio, as expected for a model fitted to the same history.

### Validation completed

- Focused Phase 3 test runs: `statistics.test.ts` (13), `matrix.test.ts` (13), `distributions.test.ts` (9), `parametricStudentT.test.ts` (13), `studentTIndependentCheck.test.ts` (3), `executeRun.test.ts` (8) — all passed.
- Complete Vitest suite: 20 test files and 177 tests passed (up from 15 files / 124 tests at the last log entry).
- `npm run lint`: passed.
- `npm run format` / `prettier --check`: passed after Prettier reformatted five of the new/changed files (line wrapping only).
- `npm run build`: passed; strict TypeScript checking surfaced exactly one ripple from the `sourceRowIndex: number | null` widening (two bootstrap-test index expressions needed explicit null guards) and the Vite production bundle completed, with the parametric engine code-split into the existing `simulation.worker.js` chunk (16.25 kB, up from ~11 kB).
- `python3 validation/phase_3_independent_check.py`: runs clean; its printed traces are the pasted expectations described above.
- Algorithm versions carried by results as of this phase: `prng: xoshiro128**-v1`, `model: historical-bootstrap-v1` **or** `parametric-student-t-v1` (now supplied by the Worker side itself, per engine), `quantile: quantile-linear-interpolation-v1`.
- Not verified this session: the real-browser click-through (Run → chart for both engines, and the still-outstanding items from the Dataset loader and chart redesign entries) — no browser-automation tool was available in-session, same disclosed gap as those two entries. The Worker/UI wiring is covered by the `executeRun` and reducer unit tests; the visual confirmation should happen next time an interactive browser is available.

### Next step

Phase 4: the real input/configuration UI (Portfolio Construction, Simulation and Portfolio Inputs — including the parametric per-holding return overrides, manual $\nu$, and editable inflation/risk-free inputs this phase deliberately hardcoded as demo constants — Execution State, Results, and Validation/Accessibility, per the Frontend Layout and Interaction Specification). Before or at the start of that work: the accumulated real-browser click-through, now covering both engines.

## 2026-08-16 - Phase 4: real input/configuration UI

### Scope completed

Implemented and closed all Phase 4 subphases. The minimal fixed-demo shell is now a real input workspace backed by the released `usd-weekly-v1` catalogue, with input state explicitly separate from the pre-existing Worker execution state. The Worker protocol and accounting semantics remain unchanged: the UI exposes only parameters the two live engines and current unleveraged accounting actually honor.

- Added runtime validation and session caching for untrusted `assets.json`, plus an advisory common-history estimate. The loader's finite-row alignment remains the binding history check because a span preview cannot observe interior data gaps.
- Added versioned `metrics-v1` and computed every metric inside the existing path loop: terminal-wealth distribution, CAGR or money-weighted IRR, annualized volatility, Sharpe ratio, maximum drawdown, loss probability, and ruin probability. Contributions are excluded from return, volatility, and drawdown calculation through `neutralReturn`, preventing savings behavior from being misreported as investment performance.
- Replaced hardcoded simulator constants with a headless input reducer and field-addressable validation. The UI now supports holdings and allocations, engine selection, seed, paths, horizon, investment, cash-flow mode, and the parametric model controls (manual/historical return mode, automatic/manual $\nu$, inflation, and risk-free rate).
- Added results metadata and disclosure: the completed run remains labelled by its own engine, seed, horizon, and dataset while the user edits the next run; representative-path chart data has a nominal/real display toggle; metrics show their cross-sectional distribution with the median as headline; retained paths expose period equity, contributions, price levels, and bootstrap source dates.
- Added a Playwright browser smoke suite for routes, a real released-data Bootstrap run, result rendering, and cancellation. The suite uses a short one-asset run for transport validation; numerical correctness remains in the core test suite.

### Files added

- **`src/core/portfolio/metrics.ts`** and **`metrics.test.ts`** — pure, versioned per-path metrics, deterministic bisection IRR, and cross-sectional summaries.
- **`src/core/data/assetCatalogue.ts`** and **`assetCatalogue.test.ts`** — validated assets catalogue, common-history preview, and retryable session cache.
- **`src/features/simulator/simulatorState.ts`** and **`simulatorState.test.ts`** — reducer plus raw-form-string to validated Worker-run-plan derivation.
- **`src/features/simulator/PortfolioConstruction.tsx`**, **`SimulationInputs.tsx`**, **`PortfolioSettings.tsx`**, and **`FieldErrors.tsx`** — accessible configuration workspace controls.
- **`src/features/simulator/ResultsPanel.tsx`** and its test — metrics, completed-run label, chart table alternative, and retained-path inspection.
- **`src/features/simulator/SimulatorPage.test.tsx`** — page-level search → select → weight → run and validation coverage.
- **`e2e/simulator.spec.ts`** and **`playwright.config.ts`** — local real-browser smoke tests; `npm run test:e2e` uses the project-local Chromium cache.

### Files changed

- **`src/core/simulation/runSimulation.ts`** — streaming metric accumulation, retained contribution/price-level data, dataset dates, and `metrics-v1` result metadata. Price levels are transiently held in a Float32 path matrix while terminal-based representative paths are selected, then only selected and retained Float64 copies cross the Worker boundary.
- **`src/core/simulation/simulationTypes.ts`** — result contracts for metrics, algorithm version, data dates, contributions, and price levels.
- **`src/charts/chartData.ts`**, **`portfolioChart.ts`**, and **`PortfolioChart.tsx`** — nominal/real display transformation stays outside nominal accounting and redraws uPlot with each path's own price level.
- **`src/core/data/loadDataset.ts`** — delegates catalogue parsing to the new catalogue module while retaining its compatibility re-export.
- **`src/workers/workerMessages.ts`** — transfers the additional representative/retained path buffers with results.
- **`src/styles/global.css`** — responsive two-column workspace, tables, validation messages, and narrow-screen stack layout.
- **`package.json`** and **`package-lock.json`** — add `@playwright/test` and `npm run test:e2e`; **`.prettierignore`** excludes tool-installed `.agents/` assets that are not project code.

### Browser verification

- Manual browser pass against `http://127.0.0.1:4173/`: Bootstrap and Parametric each completed a released-data SPY run, rendered the chart, terminal-path table, and metrics panel. Bootstrap p10/p50/p90 terminal representative paths were $13,722 / $27,311 / $55,682; Parametric produced $13,560 / $27,238 / $57,238 for the same one-asset, seed-42 setup. These are mode-specific outcomes, not a cross-engine equality target.
- Automated Playwright pass: direct `/`, `/education`, and `/resources` routes; one released-data Bootstrap run through catalogue → loader → Worker → Results; one cancellation of a 19,000-path run. All three passed.

### Validation completed

- Complete Vitest suite: **26 files, 232 tests passed**.
- Playwright: **3 browser smoke tests passed**.
- `npm run lint`: passed with no warnings.
- `npm run format`: passed after `.agents/` was excluded as tool-installed non-project content.
- `npm run build`: passed (`tsc -b` plus Vite production build).
- `npm install --save-dev @playwright/test` reported three pre-existing audit findings (two moderate, one high) and an engine warning from a transitive ESLint dependency; neither changed application code or blocked the Phase 4 checks.

### Next step

Phase 5: benchmark comparison. It should be implemented as a separate one-ETF buy-and-hold accumulator receiving the portfolio's actual per-path cash flows, including value-averaging flows, before Phase 6 rebalancing introduces trades.
