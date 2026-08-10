# Project Overview & Architecture

Full-stack asset allocation and financial simulation suite.
* `pipeline/`: Offline Python data processing scripts (`data/*.csv` $\rightarrow$ binary datasets).
* `src/`: Client-side TypeScript/React Monte Carlo engine and Web Worker execution pipeline.

---

# Response & Teaching Constraints

* **Directness:** No preambles, conversational fluff, post-summaries, or prompt restatements. Output answers and code immediately.
* **Quant-Teacher Mindset:** Treat every code snippet, review, and explanation as a quantitative finance lesson. Focus explanations on the financial, statistical, and algorithmic intuition behind the code.
* **Minimalism:** Keep text explanations structured, concise, and focused on core concepts.

---

# Core Quant Finance & Monte Carlo Engine Standards

Apply these rules strictly to all simulation logic (`src/core/`, engine variants, and Web Workers):

1. **Mandatory Intuition Comments:**
   * Every mathematical equation, matrix transformation, or sampling step must be prefixed with an inline comment explaining the **financial/statistical intuition** (e.g., drift vs. diffusion terms, Cholesky decomposition for asset covariance, Student-$t$ heavy tails vs. Gaussian normality).
2. **Computational Complexity Annotations:**
   * Every non-trivial loop, path generator, or matrix operation must include a complexity comment noting **Time Complexity** $\mathcal{O}(\cdot)$ and **Space Complexity** $\mathcal{O}(\cdot)$ relative to parameters: $N$ (simulations/paths), $T$ (time steps/horizon), and $D$ (assets/dimensions).
3. **Performance Trade-offs & Memory Mechanics:**
   * Document memory layout choices explicitly (e.g., why $N \times T$ path matrices use contiguous `Float64Array` buffers to prevent cache misses and garbage collection pauses in Web Workers).

---

# Coding Standards — Data Pipeline (Python)

* **Simplicity:** Linear, procedural code. Avoid OOP abstractions, custom classes, or complex inheritance.
* **Pedagogical Clarity:** Prioritize readable vector operations (`numpy`/`pandas`) that students can trace mentally over hidden optimizations.
* **Compact & Minimal:** Small, single-purpose functions without boilerplate or unnecessary fallback paths.

---

# Coding Standards — App (TypeScript / React)

* **Functional & Explicit:** Plain functions over classes, services, or repository layers.
* **Type-Safe Variant Selection:** Use discriminated unions over inheritance for engine/variant execution (e.g., `engine: 'bootstrap' | 'studentT' | 'markov'`).
* **Minimal State:** Use only built-in React state (`useState`, `useReducer`, Context). Keep input configuration state and execution/run state strictly separated.
* **Immutability & Workers:** Mark function inputs `readonly`. Do not mutate shared typed-array buffers outside Web Worker batch processing loops.

---

# Code Review & Documentation Standards

* **Self-Documenting Code:** Use explicit variable names matching financial notation (e.g., `covarianceMatrix`, `driftTerm`, `dt`, `choleskyFactor`).
* **Annotate Edge Cases:** Document statistical edge cases directly in code (e.g., handling non-positive definite covariance matrices via pseudo-inverse or spectral adjustments).