# Coding Standards — Data Pipeline (Python)

Applies to the offline `pipeline/` scripts that convert `data/*.csv` into the shipped binary dataset. See below for the TypeScript app (`src/`).

- **Simplicity:** Use linear, straightforward code. Avoid abstractions, OOP overhead, and unnecessary fallbacks.
- **Educational Focus:** Prioritize readability and explanatory power over performance. Code structure should be easy for a student to trace mentally.
- **Clean & Minimal:** Keep functions small, focused, and free of boilerplate. Avoid redundant logic or over-engineering.
- **Comments:** Short, English comments only to clarify major logic steps, algorithmic choices, or financial/mathematical concepts.
- **Efficiency:** Execution speed is not a priority; minimize cognitive complexity instead.
- **Compactness:** Use standard, idiomatic Python/Notebook structures.

# Coding Standards — App (TypeScript / React)

Applies to everything under `src/` (see `README.md` for the project structure). Same spirit as the pipeline rules, phrased for this stack:

- **Simplicity:** Plain functions over classes, services, or repository layers. Discriminated unions over inheritance for engine/variant selection (e.g. `engine: 'bootstrap' | 'studentT' | 'markov'`).
- **No unnecessary state:** No state-management library beyond React's built-ins (`useState`/`useReducer`/context). Keep input state and execution/run state separate, as in `README.md`'s Financial Rules.
- **Immutability where it clarifies intent:** Mark inputs `readonly`; avoid mutating shared typed-array buffers outside the worker's batching loop.
- **Clean & Minimal:** Keep functions small and focused; no boilerplate abstractions in `core/`.
- **Comments:** Short, English comments  to clarify non-obvious financial/mathematical steps (e.g. why a scale matrix isn't a covariance matrix) and make the code very readable (the project has alsoeducational purposes)
- **Efficiency:** Correctness and readability first; only optimize after measuring (see `APPENDIX.MD` §7).

# Communication & Teaching Constraints

- **Minimalism:** Be highly concise. Avoid conversational fillers, preambles, and post-summaries.
- **Directness:** Provide the code or answer immediately. Do not repeat the prompt or explain basic syntax.
- **Educational Tone:** Explain *why* a certain approach is used rather than just *what* the code does. Focus explanations on core financial/statistical intuition when behavior is non-obvious.
- **Compactness:** Keep text blocks short and structured for quick learning.