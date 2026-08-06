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
