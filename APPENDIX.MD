# Appendix: Guide for the Project

Lecture notes for designing, validating, and explaining the simulator.

- **Accounting identities** — must hold exactly, given the stated conventions.
- **Statistical assumptions** — estimated, uncertain, and potentially wrong.

Educational material only — not investment, tax, or legal advice.

### Notation and Conventions

- Time: $t=0,1,\ldots,T$
- Assets: $i=1,\ldots,A$
- Paths: $j=1,\ldots,N$
- Returns are periodic. All values are nominal, base-currency. Vectors are columns.

**Per-period order:** apply returns and debt interest → add end-of-period contribution → forced margin action → rebalance → record the period.

A model is valid only relative to these explicit conventions.

## Financial Foundations

### Simple and Log Returns

$$
r_t = \frac{P_t}{P_{t-1}} - 1
$$

- $P_t$ must be a total-return price or adjusted close (dividends and splits already included).

Portfolio value evolves as:

$$
V_t = V_{t-1}(1 + r_t)
$$

Log return:

$$
\ell_t = \log(1 + r_t)
$$

- Log returns **add** over time. Simple returns **compound** value directly.
- The Student's $t$ engine models log returns, then converts back: $r_t = e^{\ell_t} - 1$.
- This conversion guarantees $r_t > -100\%$ — a long-only asset cannot lose more than its full value.

Over $T$ periods:

$$
\log(V_T/V_0)=\sum_{t=1}^{T}\ell_t \qquad\text{vs.}\qquad \prod_{t=1}^{T}(1+r_t)-1
$$

- Not interchangeable averages: the geometric mean is generally below the arithmetic mean, because volatility creates a compounding drag.

### Unleveraged Portfolio

$$
r_{p,t} = \sum_{i=1}^{n} w_{i,t-1} r_{i,t}
$$

- Weights drift after returns apply. Rebalancing needs the value and quantity of each position tracked directly — it cannot be reduced to one weighted-return formula.
- Pre-trade dollar value: $x_{i,t}^{-}=x_{i,t-1}(1+r_{i,t})$, and $V_t^{-}=\sum_i x_{i,t}^{-}$.
- Realised pre-trade weight: $x_{i,t}^{-}/V_t^{-}$.
- This state-based (value-and-quantity) view is the correct starting point for rebalancing, proportional trading costs, average cost basis, and leverage.

### Leveraged Portfolio

Definitions, used consistently throughout:

$$
\text{equity} = \text{gross asset value} - \text{debt}
$$

$$
\text{gross exposure} = \frac{\text{gross asset value}}{\text{equity}}
$$

$$
\text{maintenance margin} = \frac{\text{equity}}{\text{gross asset value}}
$$

- Target leverage $L$ → initial maintenance ratio $1/L$.
- With maintenance requirement $m$: valid range is $1\le L\le\min(4,1/m)$.
- At $L=1/m$ exactly: **no buffer**. A small loss, interest charge, or transaction cost can trigger a margin call.

One-period behaviour: gross assets $G$, debt $D$, asset return $r$ before interest, borrowing rate $i_d$:

$$
E=G-D \quad\longrightarrow\quad E' \approx G(1+r) - D(1+i_d)
$$

- Leverage magnifies both gains and losses, because the debt claim is fixed over the period.
- This approximation becomes an exact accounting identity once interest timing, trades, taxes, and costs are specified in the engine.

### Contributions and Cash Flows

- Recurring contributions are added at the **end** of each period. They do **not** earn that period's return.
- This convention must be identical in tests, the engine, and the charts.

A high terminal value with recurring contributions does **not** imply a high investment return:

- Use **CAGR** only for an initial investment with no later cash flows.
- Use **IRR / money-weighted return** when contributions occur.
- Use a **cash-flow-neutral** portfolio return series for volatility, Sharpe ratio, and drawdown.

Money-weighted return $q$, for dated cash flows $C_t$ (positive when paid by the investor) and terminal value $W_T$, solves:

$$
0=-C_0-\sum_{t=1}^{T} \frac{C_t}{(1+q)^t}+\frac{W_T}{(1+q)^T}
$$

- This is an IRR equation — not guaranteed to have one unique solution. Non-conventional cash-flow signs can create multiple roots, or none economically meaningful.
- The app must **report** this limitation rather than silently pick an arbitrary root.

### Taxation, Cost Basis, and Costs

Educational simplification, not tax advice:

- Each asset has an **average cost basis**.
- A sale realizes $\text{proceeds} - \text{basis sold}$.
- Realized losses offset later realized gains **in the same path**, with no tax refunds.
- Purchase costs increase basis; sale costs reduce proceeds.
- Final liquidation sells everything and settles remaining taxes and costs.

Related topics: realized vs. unrealized gains, FIFO vs. average cost, tax-loss harvesting, and this model's limitations.

### Inflation and Base Currency

- Accounting is done in **nominal** base-currency units.
- For a real result, deflate by an inflation index consistent with the base currency:

$$
V_t^{\text{real}} = \frac{V_t^{\text{nominal}}}{I_t / I_0}
$$

- USD portfolio → USD-converted returns, US CPI, USD short rate.
- EUR portfolio → EUR-converted returns, HICP, EUR short rate.
- Mixing local-currency returns without FX conversion is financially inconsistent.

- Inflation adjustment changes *purchasing-power interpretation*, not the nominal cash ledger.
- Exact real simple return: $(1+r_t)/(1+\pi_t)-1$ — **not** $r_t-\pi_t$, which is only a first-order approximation.

### Foreign-Exchange Conversion and Currency Hedging Theory

Unhedged asset, local return $r_t^C$, spot rate $X_t$ (units of base $B$ per unit of local $C$):

$$
1+r_t^B = (1+r_t^C)\frac{X_t}{X_{t-1}}
$$

FX return $f_t = X_t/X_{t-1}-1$ expands this to:

$$
r_t^B = r_t^C + f_t + r_t^C f_t
$$

- First two terms: the usual textbook approximation $r^B\approx r^C+f$.
- Third term $r_t^C f_t$: a real cross term (product of two random variables), small but not zero — the source of "hedge slippage" below.

**Variance decomposition — when does hedging actually help?**

$$
\operatorname{Var}(r^B)\approx\operatorname{Var}(r^C)+\operatorname{Var}(f)+2\operatorname{Cov}(r^C,f)
$$

- Whether hedging reduces volatility depends on the **sign** of $\operatorname{Cov}(r^C,f)$, not just $\operatorname{Var}(f)$.
- Example: if equity selloffs coincide with USD strengthening ("flight to safety"), $f$ tends to be negative exactly when $r^C$ is very negative → $\operatorname{Cov}(r^C,f)>0$ for a USD investor → unhedged exposure *amplifies* the drawdown.
- The opposite sign relationship would make currency exposure a diversifier — hedging it away would *increase* volatility.
- Conclusion: "always hedge" / "never hedge" are not universal rules. The answer is empirical, asset- and currency-pair-specific.

**Covered interest rate parity (CIRP) — the theoretical cost of hedging.**

$$
\frac{F_{t,t+1}}{X_t} = \frac{1+i_B}{1+i_C}
$$

- $i_B, i_C$: base- and local-currency risk-free rates over the contract tenor.
- Forward points ≈ interest-rate differential $i_B-i_C$.
- A hedged share class, rolling forwards continuously, earns or pays roughly $i_C-i_B$ per period:
  - hedging into a *higher*-rate currency ($i_B>i_C$) → costs money (negative carry);
  - hedging into a *lower*-rate currency → positive carry.
- This is a real, priced cost or benefit of hedging — **not** a fund fee.
- Consequence for this project: a hedged share class's realized return already reflects this cost. Do not apply a separate FX adjustment on top (beyond converting hedge-currency → base currency, if they differ).

**Why hedges are imperfect — "hedge slippage."**

- A hedge is typically sized on **beginning-of-period** NAV, held fixed through the period.
- True end-of-period exposure is $\text{NAV}_0(1+r_t^C)$, not $\text{NAV}_0$ — a mismatch of $\text{NAV}_0\cdot r_t^C$.
- This mismatch is exactly the cross term $r_t^C f_t$ above: bigger local move → bigger residual currency exposure leaking through.
- A structural property of periodic hedging, not a modeling error. Even a "fully hedged" fund is never continuously, perfectly hedged.

**Uncovered interest rate parity (UIP) — and its empirical failure.**

- UIP claim: $E[f_t] \approx i_B - i_C$ (expected FX move offsets the rate differential; currency risk isn't separately compensated).
- Empirically fails, persistently: high-rate currencies depreciate *less* than predicted, or even appreciate — the "forward premium puzzle," basis of the currency carry trade.
- Implication: unhedged currency exposure is not a free, zero-expected-return coin flip. It carries its own historical risk-premium structure.

**Triangulation.** Via pivot currency $K$ (commonly USD):

$$
X^{B/C}_t = X^{B/K}_t \times X^{K/C}_t
$$

- Watch quote orientation — invert where needed: $X^{C/B}_t = 1/X^{B/C}_t$.
- An unnoticed orientation flip silently inverts a return series (depreciation ↔ appreciation) — exactly what the FX-provenance record (route, orientation, provider, source symbol) is built to catch.

### Risk-Free and Borrowing Rate Frequency Conversion

- Short rates (EFFR for USD, a prepared EUR short-rate series for EUR) are published **annualized**.
- Two uses in this project need a *periodic* rate: Sharpe-ratio discounting, and leverage debt interest.

**Effective (compounding-consistent) conversion.** Annual rate $i_{\text{ann}}$, period fraction $\Delta t$ ($1/52$ weekly, $1/12$ monthly):

$$
i_{\text{period}} = (1+i_{\text{ann}})^{\Delta t} - 1
$$

**Naive linear approximation:** $i_{\text{period}}\approx i_{\text{ann}}\times\Delta t$.

- Understates the true rate whenever $i_{\text{ann}}>0$ (it ignores the convexity of $(1+x)^{\Delta t}$).
- Example: $i_{\text{ann}}=5\%$ → weekly effective $(1.05)^{1/52}-1\approx0.0940\%$ vs. linear $5\%/52\approx0.0962\%$.
- Small per week, but compounds over thousands of periods across many paths — pick one convention and document it.

**Day-count convention.** EFFR uses Actual/360; many bond-linked rates use Actual/365 or 30/360.

- Same nominal annual rate → a different periodic rate depending on the convention (ratio $365/360\approx1.0139$, ≈1.4% relative difference).
- The pipeline must pick and document exactly one.

**Why matching periodicity matters for Sharpe:** $r_p - r_f$ needs $r_f$ measured over the *same* period as $r_p$, before annualizing either. Mixing a periodic $r_p$ with an annualized $r_f$ introduces a spurious bias of roughly $(\text{periods per year}-1)\times i_f$.

### Interpolating Monthly Price Indices to Weekly Inflation Increments

- CPI (US) / HICP (EU) are monthly. The simulator's default frequency is weekly.
- No real weekly price-level data exists — any conversion is an *assumption about timing*, not new information. Total monthly inflation must be preserved exactly.

**Deterministic log-linear interpolation.** $I_m$ = index at month-end $m$; $\lambda_m=\log I_m$; $k$ weeks in the month:

$$
\delta_j = \frac{\lambda_{m+1}-\lambda_m}{k}\quad\text{for every week }j\in\{1,\ldots,k\}
$$

- Equivalent to assuming a constant continuous compounding rate through the month.
- Interpolated path: $I_{m,j} = \exp(\lambda_m + j\cdot\delta_j)$; by construction $I_{m,k}=I_{m+1}$ exactly — no drift.

**Why not piecewise-constant?** Assigning the whole month's change to one week creates an artificial weekly "spike" with no real cause — a sawtooth artifact. Equal log-spreading avoids this, at the honest cost of not knowing the true within-month timing.

**Why this needs a version note:** two different interpolation rules give two different weekly series from the *same* monthly data. Neither is "wrong" (both reproduce the monthly figure), but results under different rules aren't directly comparable.

## 2. Probability, Statistics, and Estimation

### Random Variables and Sampling

- Monte Carlo produces many random observations from the same model. It is not a forecast — it estimates a *distribution* of outcomes.

Sample mean:

$$
\bar{X} = \frac{1}{N}\sum_{j=1}^{N}X_j
$$

- Monte Carlo error of the mean shrinks ≈ $1/\sqrt{N}$. Halving the error needs about 4× the paths. This sets the feasible path count in a browser.
- More precisely: $\operatorname{SE}(\bar X)\approx s_X/\sqrt N$. Approximate 95% CI: $\bar X\pm1.96\operatorname{SE}(\bar X)$.
- This CI quantifies error from a *finite number of simulated paths*, **conditional on the fitted model** — it says nothing about whether the model predicts real markets well.

**Law of Large Numbers and Central Limit Theorem.**

- LLN: $\bar X\to E[X]$ almost surely as $N\to\infty$ — this is *why* Monte Carlo is a valid method at all.
- CLT: for i.i.d. draws with finite variance $\sigma_X^2$, $\sqrt N(\bar X-E[X])$ converges in distribution to $N(0,\sigma_X^2)$ — the formal basis for the 95% CI above.
- Both theorems need independent draws (or a weaker mixing condition) — one more reason the bootstrap's per-period independence matters beyond its economic interpretation.

**Standard error ≠ standard deviation.**

- $s_X$ = spread of individual outcomes. Does not shrink with $N$.
- $\operatorname{SE}(\bar X)=s_X/\sqrt N$ = precision of the *estimated average*. Shrinks with $N$.
- Confusing the two overstates confidence in point estimates, and understates how spread out any single simulated future can be.

**Quantile bands don't share the mean's $1/\sqrt N$ error behavior.**

- Sample quantile at level $q$: standard error ≈ $\sqrt{q(1-q)/N}\,/\,f(F^{-1}(q))$, where $f$ is the outcome density at that quantile.
- Thin-density regions (far tails, e.g. a hypothetical p1/p99) are estimated *less* precisely than central quantiles like the median, for the same $N$.
- Part of why this project limits displayed bands to p10–p90.

**Variance-reduction techniques (context only — not implemented here):**

- *Antithetic variates* — pair each draw $z$ with $-z$; errors partially cancel on average.
- *Control variates* — adjust using a related quantity with a known expectation.
- *Stratified sampling* — sample each stratum of the space separately.
- *Importance sampling* — over-sample the region that matters (e.g. tails, for Expected Shortfall), then reweight.
- None change *what* is estimated, only *how precisely*, for the same compute budget. Candidates for a future performance phase.

### Mean, Variance, and Standard Deviation

$$
s^2 = \frac{1}{T-1}\sum_{t=1}^{T}(r_t - \bar{r})^2
$$

- Annualized volatility: $s\sqrt{12}$ monthly, $s\sqrt{52}$ weekly.
- Annualization assumes comparable observations — it does not remove non-normality risk.
- Historical estimation adds parameter uncertainty. Means are noisier than volatilities or correlations. Sample covariance is conditional on date range, frequency, proxies, missing-data rule.
- The interface should disclose the common sample's date range and observation count.

### Percentiles and Quantiles

- The $q$-th percentile: the value below which a fraction $q$ of outcomes falls.
- The chart shows p10, p25, p50, p75, p90 at each period.
- A percentile **band is not a path**: the p10 value in one month may belong to a different simulated path than the p10 value the next month. Only *retained individual paths* are selectable.

### Correlation and Covariance

$$
\rho_{ij} = \frac{\operatorname{Cov}(r_i, r_j)}{\sigma_i\sigma_j}
$$

**Geometric view.** For centered series, $\rho_{ij}=\cos\theta_{ij}$ — the cosine of the angle between two return vectors in $\mathbb{R}^T$.

- $\rho=1$: same direction. $\rho=0$: orthogonal. $\rho=-1$: opposite directions.
- If $T<A$ (fewer periods than assets), the $A$ vectors can't all be linearly independent in $T$-dimensional space — a *structural*, not just numerical, cause of a non-positive-definite correlation matrix.

**Eigenvalues = variance along uncorrelated directions.**

- $\Sigma = Q\Lambda Q^\top$; eigenvalues $\lambda_1\ge\cdots\ge\lambda_A\ge0$ for a valid PSD $\Sigma$.
- Each eigenvector = a portfolio direction; its eigenvalue = that portfolio's variance.
- $\Sigma$ PSD means $a^\top\Sigma a\ge0$ for every $a$ — no portfolio can have negative variance.
- A negative eigenvalue literally implies some portfolio has negative variance — nonsensical, and the formal reason Cholesky can't run on it directly.

**Why sample correlation matrices go non-PSD:**

- (a) pairwise-incomplete estimation — different date subsets per pair (not an issue here, since alignment removes any row missing *any* selected series, but a common real-world cause elsewhere);
- (b) rounding or precision loss when correlations are stored or reassembled;
- (c) near-collinearity — two almost-identical assets (e.g. two S&P 500 ETFs) push the smallest eigenvalue toward, or past, zero.
- (c) is a real risk here given the six-asset cap — exactly why Higham repair (below) is required, not optional.

Historical correlation is **not stable**, especially in crises. It is an estimated input, not a market law.

### Positive Semidefinite Matrices

- A covariance matrix used to generate joint shocks must be PSD.
- Numerical error, insufficient data, or near-duplicate assets → negative eigenvalues → Cholesky fails.
- Higham's algorithm finds a valid correlation matrix close to the estimated one.

Related topics: eigenvalues/eigenvectors, Cholesky decomposition, covariance vs. correlation, variance preservation during repair.

- $\Sigma=DRD$, where $D=\operatorname{diag}(s_1,\ldots,s_A)$ and $R$ is a correlation matrix.
- Valid correlation matrix: symmetric, unit diagonal, PSD ($a^\top R a\ge0$ for every $a$).
- If $R=LL^\top$ (positive definite), correlated normal shocks: $Lz$, $z\sim N(0,I)$.
- Log any Higham repair — it changes the fitted dependence structure. A small diagonal jitter may still be needed for a strict Cholesky factorization.

### Higham's Nearest-Correlation-Matrix Algorithm, in Detail

Optimization problem: given a near-valid symmetric matrix $A$, find

$$
X^\star = \arg\min_{X}\ \|A-X\|_F \quad\text{subject to } X\succeq0,\ \operatorname{diag}(X)=\mathbf{1}
$$

- $\|M\|_F=\sqrt{\sum_{i,j}M_{ij}^2}$; $X\succeq0$ means PSD.
- This is a projection onto the intersection of two convex sets: PSD matrices $\mathcal{S}$, unit-diagonal matrices $\mathcal{U}$. The intersection is not simply "project onto one, then the other, once."

**Step 1 — project onto the PSD cone.** Eigendecompose $M=Q\Lambda Q^\top$; clip negative eigenvalues to zero: $M^+ = Q\Lambda^+Q^\top$, $\Lambda^+=\operatorname{diag}(\max(\lambda_i,0))$.

- Idea: a non-PSD matrix is "PSD except along a few bad directions" — zero out just those.

**Step 2 — project onto the unit-diagonal set.** Reset the diagonal to 1; trivial, but it re-breaks PSD-ness.

**Step 3 — alternate, with Dykstra's correction.** Plain alternation converges slowly, to *some* point in the intersection — not necessarily the nearest one. Dykstra's correction tracks an auxiliary term, subtracted and re-added around each PSD projection, and provably converges to the true Frobenius-nearest matrix. Iterate to a documented tolerance.

**Restoring variances.** Repair runs on the *correlation* matrix (unit diagonal makes the projection trivial). Set aside $s_1,\ldots,s_A$ beforehand; reapply via $\Sigma_{\text{repaired}} = D R_{\text{repaired}} D$. Guarantees only the correlation structure changes — each asset's fitted variance is untouched.

**Cost.** One eigendecomposition per iteration, $O(A^3)$. For $A\le6$: negligible against the $O(N\times T\times A^2)$ scenario cost. A one-time setup cost, not a per-scenario one.

**A cheaper, cruder alternative.** Eigenvalue-clipping without Dykstra's correction: one pass, cheap, but not the exact Frobenius-nearest solution. Gives a visibly different result when the input is far from PSD — log which method is used.

### Cholesky Decomposition, in Detail

For a symmetric positive-definite matrix $S$, find lower-triangular $L$ with

$$
S = LL^\top.
$$

**Recursive formulas**, column by column, $j=1,\ldots,A$:

$$
L_{jj} = \sqrt{S_{jj}-\sum_{k=1}^{j-1}L_{jk}^2}, \qquad L_{ij} = \frac{1}{L_{jj}}\left(S_{ij}-\sum_{k=1}^{j-1}L_{ik}L_{jk}\right)\ \text{for } i>j.
$$

- The diagonal step is a Schur complement — non-negative **if and only if** $S$ is PSD up to that point.
- A negative value under the square root (producing `NaN`) is the precise symptom of a non-PSD input, not a random bug. This is why Higham repair must run *before* Cholesky, never after.

**Cost.** ≈$A^3/3$ multiply-adds (about half of a general $LU$ factorization, thanks to symmetry). For $A\le6$: about 72 operations — computationally free. A one-time setup cost, like Higham repair.

**Generating correlated shocks.** For $z\sim N(0,I)$: $Y=\mu+Lz$ has covariance $\operatorname{Cov}(Lz)=L\operatorname{Cov}(z)L^\top=LL^\top=S$. A one-line proof; the same mechanism (plus a chi-square scale factor) builds the multivariate Student's $t$ draws.

**Numerical stability.** No pivoting is needed for genuinely positive-definite matrices — but near-duplicate assets shrink $L_{jj}$ for later columns, amplifying rounding error downstream. Treat any $L_{jj}$ below a documented threshold as an explicit factorization failure, not a silently degraded result.

### Dependence Beyond Correlation

- Correlation is linear co-movement only — not joint crashes, tail dependence, causality, or stability over time.
- Multivariate Student's $t$: common scale shocks → real tail dependence.
- Independent bootstrap rows: preserve only the *realised* one-period dependence in the sample.
- Neither approach proves a structural economic relationship.

## 3. Monte Carlo Models in the Project

### Simulation Path

A path is a sequence of period scenarios. Each scenario contains:

- joint asset returns;
- inflation;
- the risk-free rate or base borrowing cost;
- optional metadata (a historical row, a Markov regime).

- The **engine** generates scenarios. The **portfolio loop** applies accounting (returns, interest, contributions, margin calls, rebalancing, taxation, recording). These stay separate.

### Historical Joint Bootstrap

**Procedure:**

1. Build an aligned historical matrix for all selected assets, inflation, and rates.
2. Remove rows with missing data.
3. Sample one row with replacement for each simulated period.
4. Pass all values from the sampled row to the portfolio together.

- Simple, transparent. Preserves observed shocks and contemporaneous correlations.
- An IID empirical bootstrap: each row equally likely, simulated periods independent.
- Does **not** preserve market order, volatility persistence, or crisis duration.
- Preserves only dependence observed *within* the same historical period.
- The sampling universe must be built once, jointly — never separately per asset. Otherwise a portfolio could combine an equity crash from one month with an unrelated bond shock and inflation observation, creating an outcome that never actually occurred.

**The bootstrap as a plug-in estimator (Efron, 1979).**

- Treats the empirical distribution $\hat F_T$ (each of the $T$ observed rows, probability $1/T$) as a plug-in estimate of the true, unknown $F$.
- Resampling with replacement ≡ drawing fresh i.i.d. observations from $\hat F_T$.
- No assumption on the *shape* of the joint distribution — it inherits whatever shape the sample actually has (fat tails, skew, co-crashes) without needing to name or estimate any of it.

**Two different independence claims — don't conflate them:**

1. *Time* is exchangeable — each simulated period draws a fresh row, independent of the previous one. No autocorrelation, no clustering, no crisis persistence.
2. Assets are **not** assumed independent *within* one drawn row — cross-sectional dependence is preserved exactly, since the whole row is one atomic draw.

"Joint" refers specifically to preserving (2) while accepting (1).

**Bootstrap consistency and its limits.**

- As $T\to\infty$: $\hat F_T\to F$, and the bootstrap sampling distribution converges to the true sampling distribution (Glivenko–Cantelli and related results).
- In practice: a few hundred to roughly 1,500 weekly rows — at most a handful of market cycles.
- Correctly quantifies *sampling uncertainty within this historical window* — but cannot invent history the window never contained. A 15-year sample with no stagflation episode will never simulate one, however many paths are drawn.
- This is the concrete mechanism behind the three-layer validation split below (verification / statistical validation / external validation).

**Why sampling *with* replacement:** sampling without replacement can only reorder the same fixed rows. With replacement, history is treated as an effectively infinite population of "equally plausible weeks" — the same week can recur, even consecutively.

**Uniform resampling = an implicit stationarity assumption:** every historical week is equally likely to recur, regardless of when it happened (a 2008 week is as likely as a calm 2019 week). Strong, but transparent — visible just from reading the algorithm.

### Block Bootstrap (Future Extension)

- Fixes the plain bootstrap's core gap: independent periods can't reproduce volatility clustering or multi-period crisis duration.
- Resamples **contiguous blocks** of rows instead of single rows.

**Variants:**

- *Moving block bootstrap* (Künsch, 1989) — fixed block length $\ell$; overlapping candidate blocks drawn with replacement, concatenated to length $T_{\text{sim}}$.
- *Circular block bootstrap* — wraps history into a circle, so rows near the end aren't disadvantaged.
- *Stationary bootstrap* (Politis & Romano, 1994) — block length itself random (geometric, mean $1/p$); genuinely stationary, at the cost of tuning $p$.

**Risks, specific to this project:**

1. **Block-length is itself an unsolved estimation problem.** Too short → collapses toward the plain i.i.d. bootstrap. Too long → too few distinct blocks (a 10-year weekly history with 52-week blocks has only ~10 non-overlapping blocks) → simulated paths repeat the same handful of episodes.
2. **Boundary artifacts.** A splice between two unrelated historical dates has no economic meaning, and can distort statistics computed at the seam.
3. **Higher estimator variance.** Overlapping blocks are correlated with each other → less new information per draw → larger standard errors than the i.i.d. bootstrap for the same draw count.
4. **Must stay block-joint, not block-per-asset.** One block, applied to all assets/inflation/rates together — otherwise the manufactured-diversification problem returns, smeared across a block instead of one row.
5. **No objectively correct block length.** Short → understates persistence; long → understates diversity. Whatever length (or $p$) is chosen must be a documented, versioned rule.
6. **Status: not implemented.** The README explicitly defers this. Documented here for future design work only.

### Parametric Student's $t$ Engine

- A multivariate normal underestimates extreme events.
- Student's $t$: heavier tails, controlled by degrees-of-freedom $\nu$; converges to Gaussian as $\nu\to\infty$.

**Key theoretical properties**

*Tails and moments.* Finite mean only for $\nu>1$; finite variance only for $\nu>2$.

$$
\text{excess kurtosis} = \begin{cases} \dfrac{6}{\nu - 4}, & \nu>4, \\ \text{undefined (infinite)}, & \nu\le 4. \end{cases}
$$

*Meaning of excess kurtosis.* Standardized fourth central moment:

$$
\operatorname{Kurt}(X)=E\left[\left(\frac{X-E[X]}{\sqrt{\operatorname{Var}(X)}}\right)^4\right]
$$

- Normal distribution: kurtosis $3$. **Excess kurtosis** = kurtosis $- 3$.
- Measures extra tail probability vs. a normal with the same mean and variance — not a "taller center."
- Example: $t_{10}$ → excess kurtosis $6/(10-4)=1$; normal limit → $0$.
- Near $\nu=4$: the fourth moment blows up. At $\nu\le4$: kurtosis has no finite value.
- Sample excess kurtosis is very sensitive to a few extreme returns → the project's $\nu$ estimate is a transparent approximation, not a stable market fact.

*Relation to the normal.* Large $\nu$ → converges to normal. Small/moderate $\nu$ → much heavier tails, higher probability of extreme returns.

*Multivariate Student's $t$.* $S$ is the **scale** matrix (not covariance). $Z\sim N(0,S)$, $U\sim\chi^2_{\nu}$ independent:

$$
Y = \mu + \frac{Z}{\sqrt{U/\nu}} \sim t_{\nu}(\mu, S)
$$

- Equivalently, $Z=Lz$, $LL^\top=S$, $z\sim N(0,I)$.
- The shared random divisor produces simultaneous large moves across assets.

**Formulas**

Univariate pdf (location-scale), degrees of freedom $\nu>0$, location $\mu$, scale $\sigma>0$:

$$
f(x;\nu,\mu,\sigma)=\frac{\Gamma\left(\frac{\nu+1}{2}\right)}{\sqrt{\nu\pi}\,\Gamma\left(\frac{\nu}{2}\right)\sigma}\left[1+\frac{1}{\nu}\left(\frac{x-\mu}{\sigma}\right)^2\right]^{-\frac{\nu+1}{2}}
$$

- $\mu$: mean (if $\nu>1$), median, and mode. $\sigma$: stretches deviations from $\mu$ — doubling $\sigma$ doubles every quantile distance from the center.
- **Scale ≠ standard deviation**, generally. For $\nu>2$:

$$
\operatorname{Var}(X)=\sigma^2\frac{\nu}{\nu-2}
$$

- Standard deviation $=\sigma\sqrt{\nu/(\nu-2)}$, not $\sigma$. They only coincide as $\nu\to\infty$.
- **A fitted historical volatility cannot be plugged in directly as $\sigma$** — it needs the degrees-of-freedom adjustment.

- Standard $t$ ($\mu=0,\sigma=1$), CDF $T_{\nu}(x)=\Pr(t_{\nu}\le x)$: closed form only for special $\nu$; use numerical libraries otherwise.
- Variance of the standard $t_\nu$, $\nu>2$: $\operatorname{Var}(t_{\nu})=\nu/(\nu-2)$ (multiply by $\sigma^2$ for the location-scale form).
- Construction: $Z\sim N(0,1)$, $V\sim\chi^2_{\nu}$ independent → $T=Z/\sqrt{V/\nu}\sim t_{\nu}$.

Multivariate density, $x\in\mathbb{R}^p$:

$$
f(x)=\frac{\Gamma\left(\frac{\nu+p}{2}\right)}{\Gamma\left(\frac{\nu}{2}\right)(\nu\pi)^{p/2}|S|^{1/2}}\left[1+\frac{1}{\nu}(x-\mu)^\top S^{-1}(x-\mu)\right]^{-\frac{\nu+p}{2}}
$$

**Scale vs. covariance.**

$$
\Sigma = S\frac{\nu}{\nu - 2}\quad(\nu>2) \qquad\Longrightarrow\qquad S=\widehat\Sigma(\nu-2)/\nu
$$

- Do not confuse $S$ and $\Sigma$. Applying the Cholesky factor of $\widehat\Sigma$ directly inflates simulated covariance by $\nu/(\nu-2)$.
- Correlations are unchanged by this factor; every variance and covariance is enlarged by it.
- Worked example: $\nu=6$, $\widehat\Sigma=0.04$. Factor $=6/(6-2)=1.5$. $S=0.04/1.5\approx0.02667$. Check: $0.02667\times1.5=0.04$ ✓. If $S$ were set to $0.04$ directly: simulated variance $=0.06$ — **50% too high**. The same scalar conversion applies to every element of the full covariance matrix.

**Estimation and practical notes**

- **Estimating $\nu$:** (a) method-of-moments from sample excess kurtosis $\hat\gamma_2$: $\hat\nu=4+6/\hat\gamma_2$ (only if $\hat\gamma_2>0$); (b) MLE on standardized residuals; (c) profile likelihood over a grid. The project uses (a), clamped to $[5,100]$ — transparent, not a full multivariate MLE.
- **Correlation/positive-definiteness:** estimate from standardized residuals, repair with Higham before Cholesky.
- **Sampling:** draw a multivariate normal plus an independent chi-square (or Gamma) variate, rescale, and apply the Cholesky factor.
- **Risk metrics:** heavy tails materially increase VaR and ES vs. Gaussian assumptions. Variance is undefined for $\nu\le2$ — avoid variance-based standardization there.

**Recommended procedure:**

1. Estimate location and covariance from aligned log returns; report the calibration sample.
2. Estimate $\nu$, check its stability, and clamp per the project's rule.
3. Repair the correlation matrix if needed, restore marginal scales, and build $S=\widehat\Sigma(\nu-2)/\nu$.
4. Per draw: $z\sim N(0,I)$, $U\sim\chi^2_{\nu}$ independent → $\ell=\mu+Lz/\sqrt{U/\nu}$, with $LL^\top=S$.
5. Convert log returns to simple returns, then run the portfolio accounting loop.

Document the parameterization clearly — do not confuse scale and covariance when reporting or matching historical volatility.

### Pseudo-Randomness, Seed, and Reproducibility

- Deterministic for a given initial state. This project uses `xoshiro128**` with a 32-bit seed.
- Same seed + data + model version → same result, always.
- Never `Math.random()` — it breaks reproducible tests.
- Not cryptographic — never use it for security.
- Record the seed, dataset version, and model version in every export.

Related topics: uniform-to-normal transforms (Box-Muller), and building a Student's $t$ variable from normal and chi-square variables.

### The `xoshiro128**` Algorithm, in Detail

- Family: "xor/shift/rotate" (Blackman & Vigna). State: four 32-bit words $(s_0,s_1,s_2,s_3)$.
- **State update:** XOR/shift/rotate mixing all four words. Fast (a few integer ops). Linear over $\mathrm{GF}(2)$ → guarantees a period of $2^{128}-1$ nonzero states — but a linear update leaves detectable structure in the raw output.
- **The "\*\*" scrambler:** multiply by a fixed odd constant → rotate → multiply by a second odd constant. Odd-constant multiplication is a bijection (no information lost), but it destroys the linear structure in the *output*.
- Net design: a fast linear core to *advance*, a nonlinear scrambler to *observe* — the defining idea of the xoshiro/xoroshiro family.

**Why raw statistical quality matters here.** Output selects which historical row to sample per period. Any residual structure — even slight correlation between consecutive draws — could silently violate the bootstrap's i.i.d.-across-periods assumption, manufacturing fake dependence that's a PRNG artifact, not real history. Passing standard test batteries (e.g. TestU01's BigCrush) is what makes "draws behave like independent uniforms" a defensible assumption.

**SplitMix32 seed expansion.** One 32-bit seed → four state words, by repeating:

1. Add $\mathrm{0x9e3779b9}$ ($=\lfloor2^{32}/\varphi\rfloor$, golden ratio, from Fibonacci hashing) — spreads low-order bits evenly, avoiding short cycles.
2. Two rounds of the MurmurHash3 finalizer mix: $x \mathbin{\oplus}= x\!\gg\!16;\ x \mathrel{*}= \mathrm{0x85ebca6b};\ x \mathbin{\oplus}= x\!\gg\!13;\ x \mathrel{*}= \mathrm{0xc2b2ae35};\ x \mathbin{\oplus}= x\!\gg\!16$ — a strong *avalanche*: one flipped input bit flips roughly half the output bits, unpredictably.

- Repeat four times → four mutually-unrelated-looking state words from one small seed.
- Needed because xoshiro's own update is weak at scrambling *one differing input bit* quickly — without this step, seeds `1` and `2` would start with barely-different, correlated states.

**All-zero state = a fixed point, not an edge case.** A linear update maps $(0,0,0,0)\to(0,0,0,0)$ forever — a silent, infinite stream of zeros, with no error. Must be explicitly detected and rejected.

**Unsigned 32-bit masking.** JavaScript's bitwise operators are *signed*; the algorithm needs *unsigned* wraparound. Apply `>>> 0` after each intermediate operation, or a set top bit silently corrupts subsequent arithmetic.

### Unbiased Sampling of a Bounded Integer, in Detail

- Goal: draw a uniform integer in $\{0,\ldots,n-1\}$ from `nextUint32()` ∈ $\{0,\ldots,2^{32}-1\}$.

**Why naive `% n` is biased.** Write $2^{32}=qn+r$. Outcomes $0,\ldots,r-1$ get $q+1$ raw values each; outcomes $r,\ldots,n-1$ get only $q$.

- Tiny example: raw range $\{0,\ldots,9\}$, $n=3$. $10=3\times3+1$. Outcome $0$ ← $\{0,3,6,9\}$ (4 values, probability $4/10$). Outcomes $1,2$ ← 3 values each (probability $3/10$). A real, exact bias.

**The fix: rejection sampling before the modulo.** $\mathrm{limit}=n\left\lfloor2^{32}/n\right\rfloor$. Draw `x = nextUint32()`; if $x\ge\mathrm{limit}$, discard it and draw again; otherwise return $x\bmod n$. Every accepted value now maps to exactly $\mathrm{limit}/n$ outcomes each — provably exact uniformity.

**Cost.** Acceptance probability $p=\mathrm{limit}/2^{32}\ge1/2$ always → expected draws per sample $\le2$. Cheap; the loop isn't formally bounded, but is practically never long.

**Why this matters here.** The work budget allows up to $N\times T=10{,}000{,}000$ row draws against only a few hundred to ~1,500 rows. Even a fractional-percent bias, compounded ten million times, would measurably skew the simulated distribution toward early row indices — silently, with no error.

## 4. Markov Chains and Market Regimes

### Basic Concept

Discrete Markov chain, states $S_t \in \{1, \ldots, K\}$:

$$
P(S_{t+1}=j \mid S_t=i) = P_{ij}
$$

- $P$: transition matrix — every entry $\ge0$, every row sums to 1.
- $\pi$: initial state probabilities.

### Rationale

- An independent bootstrap can sample a crisis month directly followed by a quiet one.
- A Markov model assigns higher probability to "difficult after difficult," when that persistence is real in the data.

Illustrative three-state model:

| Regime | Interpretation | Emission |
| --- | --- | --- |
| 0 | Calm market | Low-volatility historical rows |
| 1 | Normal market | Intermediate historical rows |
| 2 | Stress | Rows with drawdowns or high volatility |

- A state is a **statistical classification**, not an economic forecast.

### Initial Implementation

Don't fit a new distribution per regime. Instead:

1. Build the aligned historical matrix already used by the other engines.
2. Assign each row to a small number of regimes, with a documented rule.
3. Count observed transitions between consecutive states to estimate $P$.
4. Estimate $\pi$ from initial historical frequencies or the stationary distribution.
5. Sample the next state from the appropriate row of $P$.
6. Sample a historical row assigned to that regime.
7. Pass the complete row to the portfolio loop.

- Preserves cross-asset correlation, because it emits complete historical rows. Easier to inspect than a model with many parametric distributions.

### Design Choices Before Implementation

- Number of regimes: begin with 2 or 3.
- Regime definition: volatility/return thresholds, deterministic clustering, or a hidden Markov model.
- Classification features: equity-index return, rolling volatility, drawdown, credit spreads, or a combination.
- Sparse-regime policy: merge regimes, reject the model, or apply smoothing.
- Frequency: weekly and monthly states are not directly interchangeable.

### Limitations and Advanced Topics

- First-order Markov chains assume only the current state matters. They can create excessively abrupt regime changes, and depend strongly on the classification method.

**Core theoretical properties:**

- **Stationary distribution:** $\pi=\pi P$. For an irreducible, positive-recurrent chain, $\pi_i$ is the long-run fraction of time spent in state $i$.
- **Mean recurrence time:** for an ergodic chain, $1/\pi_i$.
- **Sojourn time:** expected consecutive time in state $i$ ≈ $1/(1-P_{ii})$, when self-transitions dominate.
- **Irreducibility and aperiodicity:** required for a unique stationary distribution and for mixing to occur.
- **Mixing and convergence:** controls how fast the chain forgets its initial state. Slow mixing → long regime persistence, less simulated path diversity.
- **Absorbing states:** the fundamental matrix $N=(I-Q)^{-1}$ gives expected visits before absorption.

### Mixing Time and Ergodicity, in More Depth

**Mixing time, formally.** $d_i(n) = \tfrac12\sum_j\left|P^n(i,j)-\pi_j\right|$; mixing time $\tau(\epsilon)=\min\{n:\max_i d_i(n)\le\epsilon\}$.

- Practical meaning: how many periods must elapse before the chain "forgets" any starting regime, to within $\epsilon$.
- If every path starts in the "current" regime, a slow-mixing chain keeps a start-condition bias for a large fraction of the horizon — the result depends on which regime happened to be "current" when the user ran it.

**Spectral gap.** $\tau(\epsilon)\approx O\!\left(\dfrac{1}{1-\lambda_2}\log\dfrac{1}{\epsilon}\right)$, where $\lambda_2$ is the second-largest eigenvalue of $P$ in magnitude.

- $\lambda_2$ near $1$ → slow mixing, persistent regimes (long bull or bear markets).
- $\lambda_2$ well below $1$ → fast forgetting, flickering regimes.

**Perron–Frobenius.** An irreducible, aperiodic $P$ has a unique $\lambda_1=1$ (eigenvector proportional to $\pi$), and every other eigenvalue strictly $<1$ in magnitude.

- The formal reason "the chain forgets its start": non-stationary components decay geometrically at a rate set by $|\lambda_2|,|\lambda_3|,\ldots$
- Irreducibility and aperiodicity are exactly what's needed for this uniqueness to hold at all.

**Ergodic theorem.** The time-average over one sufficiently long path converges (almost surely) to the ensemble-average stationary probability $\pi_i$, for an irreducible, positive-recurrent chain.

- Practical question: is a 520-period simulated path *long enough* relative to the mixing time? For slow mixing, a 10-year path might sit in one or two regimes the entire time — a real feature of finite horizons, not a bug, even if within-path frequencies look nothing like $\pi$.

**Estimation and regularization**

**MLE from counts, derived.** Counts $N_{ij}$; likelihood $L_i(P_{i,\cdot})\propto\prod_j P_{ij}^{N_{ij}}$. Maximizing $\sum_j N_{ij}\log P_{ij}$ subject to $\sum_j P_{ij}=1$ (via a Lagrange multiplier) gives $\hat P_{ij}=N_{ij}/N_{i\cdot}$: the MLE is simply the observed frequency.

**Sampling uncertainty.** For large $N_{i\cdot}$: $\hat P_{ij}$ is approximately normal, with variance $P_{ij}(1-P_{ij})/N_{i\cdot}$. With a few hundred to ~1,500 rows split across 2–3 regimes, a rare "stress" regime's row count can be just tens of observations — a large relative error on its estimated $P$.

**Laplace/Dirichlet smoothing = Bayesian shrinkage, not a patch.** $\hat P_{ij}=(N_{ij}+\alpha)/(N_{i\cdot}+K\alpha)$ is the posterior mean under a symmetric Dirichlet$(\alpha,\ldots,\alpha)$ prior (conjugate to the multinomial).

- Shrinks toward $1/K$ (uniform) — less shrinkage as $N_{i\cdot}$ grows.
- A sparse regime is pulled toward "no pattern." A well-observed regime is barely adjusted.

### Hidden Markov Models, in Detail

- This project's deterministic-classification approach is a special case of an HMM where each emission distribution is a point mass under a hard threshold.
- A true HMM: the regime sequence $S_t$ is **unobserved**; only an emission $Y_t\mid S_t=k\sim f_k(\cdot)$ is seen (e.g., a regime-specific Gaussian or Student's $t$).
- Lets the model infer ambiguous cases probabilistically, instead of by a fixed rule.

**Four canonical algorithms:**

1. **Forward algorithm** (likelihood). $\alpha_1(k)=\pi_k f_k(Y_1)$; $\alpha_t(k) = \left[\sum_i \alpha_{t-1}(i)\,P_{ik}\right] f_k(Y_t)$. Total likelihood $P(Y_{1:T})=\sum_k\alpha_T(k)$. Cost $O(TK^2)$ — versus $K^T$ naively.
2. **Backward algorithm + posterior responsibilities** (smoothing). $\beta_t(k)=P(Y_{t+1:T}\mid S_t=k)$. Smoothed posterior: $\gamma_t(k)=\dfrac{\alpha_t(k)\beta_t(k)}{P(Y_{1:T})}$ — a full probability distribution over regimes per row, not a hard label.
3. **Baum–Welch = EM.** E-step: compute $\gamma_t(k)$ and $\xi_t(i,j)=P(S_t=i,S_{t+1}=j\mid Y_{1:T})$. M-step: $\hat P_{ij}=\dfrac{\sum_t\xi_t(i,j)}{\sum_t\gamma_t(i)}$; re-estimate emissions as $\gamma_t(k)$-weighted MLE. Iterate to convergence. Guaranteed non-decreasing likelihood, but only a *local* optimum — use multiple restarts.
4. **Viterbi** (most likely single path). $\delta_t(k)=\max_i\left[\delta_{t-1}(i)P_{ik}\right]f_k(Y_t)$, with back-pointers to reconstruct the path.

**Trade-offs vs. the simpler deterministic approach.**

- Pros: handles ambiguous periods gracefully; estimates transitions and emissions jointly.
- Costs: needs convergence monitoring and multiple restarts (local optima); a row's classification becomes a probability, not an easily-explained rule; choosing $K$ needs AIC/BIC and out-of-sample validation, to avoid absorbing noise as a spurious regime.
- The README's ordering — deterministic version first, HMM as a later extension — reflects exactly this interpretability-vs-flexibility trade-off.

- **Model selection:** out-of-sample tests, AIC/BIC, and qualitative checks (persistence, regime durations) against overfitting.

### Practical Design Guidance

- **Simple initial approach:** 2–3 regimes, transparent deterministic classification, empirical $P$ — interpretable, easy to debug.
- **Emission choice:** complete historical rows when cross-asset correlation matters most; parametric per-regime emissions only when smoothed synthetic rows are needed and data supports it.
- **Sparse regimes:** merge or smooth rather than rely on zero-probability transitions.
- **Diagnostics:** report $P$, $\pi$, mean durations, and mixing diagnostics; visualize regime sequences against history.

### Additional Formulas and Practical Calculations

- **$n$-step transitions:** the $(i,j)$ entry of $P^n$. Distribution after $n$ steps: $p_n=p_0P^n$.
- **Stationary distribution (linear system):** $\pi=\pi P$, $\sum_i\pi_i=1$ ⇒ solve $(P^\top-I)\pi^\top=0$ with a normalization constraint.
- **Two-state closed form:**

$$
P=\begin{pmatrix}p & 1-p\\1-q & q\end{pmatrix}\quad\Longrightarrow\quad \pi=\left(\frac{1-q}{2-p-q},\,\frac{1-p}{2-p-q}\right)
$$

- **Sampling the chain:** from state $i$, draw the next state from row $P_{i,\cdot}$. Initialize from $\pi$ or a chosen start distribution.
- **Laplace smoothing:** $\hat P_{ij}=\dfrac{N_{ij}+\alpha}{N_{i\cdot}+K\alpha}$, with $\alpha=1$ (add-one) or smaller for milder regularization.
- **Spectral gap:** $1-\lambda_2$ controls mixing speed; a small gap implies slow mixing and long persistence of initial conditions.
- **Expected visits:** partition $P$ into transient $Q$ and absorbing blocks; $N=(I-Q)^{-1}$ gives expected visits before absorption.

### Practical Diagnostics and Checks

- Report empirical transition counts $N_{ij}$, $P$ and smoothed $\hat P$, and eigenvalues (especially $\lambda_2$).
- Compare empirical and simulated regime-length distributions and mean durations $1/(1-P_{ii})$.
- For HMMs: show posterior state probabilities per historical row, and inspect ambiguous classifications.

## 5. Metrics and Result Interpretation

### Drawdown

$$
DD_t = \frac{V_t}{\max_{u \le t} V_u} - 1
$$

- Must use a **unitized index**, not a raw value series — otherwise a contribution can look like a market recovery.
- $u_0=1$, $u_t=u_{t-1}(1+r_{p,t}^{\mathrm{neutral}})$ (the neutral return excludes external cash flows). Maximum drawdown $=\min_t DD_t$ — measures **depth**, not duration or recovery time.

### Sharpe Ratio

$$
\text{Sharpe} = \frac{\overline{r_p-r_f}}{s(r_p-r_f)}\sqrt{m}, \qquad m\in\{12,52\}
$$

- Doesn't measure tail risk. Can mislead under asymmetric distributions, leverage, or dependent returns.
- Undefined when the excess-return standard deviation is zero. Serial correlation can inflate the usual annualization. Report it as descriptive and model-dependent — not a utility measure.

### Tail Metrics and Decision Limits

Future scope:

- **VaR** — loss threshold at a specified percentile.
- **Conditional VaR / Expected Shortfall** — average loss beyond VaR.
- **Probability of ruin** — fraction of insolvent paths (a target shortfall is reported separately).
- **Sequence-of-returns risk** — the effect of return order on portfolios with cash flows.

For loss variable $L=-R$:

$$
\operatorname{VaR}_{\alpha}(L)=\inf\{x:\Pr(L\le x)\ge\alpha\}, \qquad \operatorname{ES}_{\alpha}(L)=E[L\mid L\ge\operatorname{VaR}_{\alpha}(L)]
$$

- Both inherit every assumption in the data, calibration, and simulation engine — model-dependent estimates, not objective probabilities.
- A percentile fan chart shows a cross-sectional distribution *per horizon*, not any one investor's actual trajectory.

## 6. Browser Software Engineering

### Separation of Responsibilities

Four layers:

- `features/` — React components, inputs, results.
- `core/data/` — loading and validating static data.
- `core/simulation/` — `PeriodScenario` generators.
- `core/portfolio/` — pure accounting, independent of the simulation method.

- The Web Worker coordinates computation and batching. React holds **no** financial formulas.
- This separation lets engines be compared using identical scenarios, and accounting tested without a browser.

### Essential TypeScript

- Discriminated types: `engine: 'bootstrap' | 'studentT' | 'markov'`.
- `readonly` for immutable inputs.
- `Float32Array` and `Float64Array`.
- Unions, type guards, and runtime validation of JSON data.
- JS `number` values vs. typed-array values.

- `.f32` files are compact for transfer.
- Accounting must use JS `number` (IEEE-754 double precision), never `Float32` directly.

### React and Simulation State

Keep separate:

- valid configuration **or** validation errors;
- current run ID;
- status: `idle` / `running` / `completed` / `cancelled` / `failed`;
- progress, and the most recent completed result.

- Input change mid-run → terminate the worker, ignore stale-run-ID messages.
- Update charts once per batch, not once per path.

### Web Workers and Buffer Transfer

A worker prevents main-thread blocking — it doesn't make computation free:

- Can't update React or the DOM directly.
- `postMessage` without a transfer list **copies** buffers (can be memory-heavy).
- With a transfer list, ownership moves — the sender loses access.
- A long synchronous loop can't receive cancellation messages.
- Process bounded batches; publish progress between batches.

### Static Data and Caching

- `fetch`, `ArrayBuffer`, `DataView`, `Cache-Control`, Brotli/gzip compression, browser caching.
- Manifest: small, loaded immediately. Return matrix: loaded only after frequency and currency are chosen.
- No Parquet parser in v1 — a `Float32` binary file's simple, known schema doesn't justify the added complexity.

### Charts with uPlot

- Percentiles plus at most 50 individual paths only.
- One chart, not one per simulation.
- Stable container dimensions.
- Update per batch, not per point.
- Leverage ratio shown only when leverage is active.

### In Plain Language: How the Pieces Fit Together (No Programming Background Required)

**Why a separate "Web Worker" exists.**

- A browser tab normally does everything — drawing the page, handling clicks, running calculations — one thing at a time.
- A heavy calculation run there freezes the whole page: no scroll, no click, no feedback.
- A Web Worker is like hiring a second assistant in a separate room. The simulation runs there; the front-of-house (page rendering, clicks) stays free.
- The two rooms only communicate by passing notes (`postMessage`). The back room can't touch the screen directly — only report results or progress back.

**Handing over data vs. copying it.**

- Passing a huge stack of numbers normally means photocopying it — slow, and briefly doubles memory use.
- A "transfer list" hands over the *original* stack instead — instant, regardless of size — but the sender genuinely loses its own copy afterward.
- This project hands over the large per-path result buffers rather than copying them, because copying every run would be needlessly slow.

**Changing a setting mid-calculation.**

- A long, uninterruptible calculation can't be tapped on the shoulder mid-way.
- Instead: fire the old assistant, hire a new one, and tag every request with a unique ticket number.
- If the fired assistant's result arrives late anyway, the front desk checks the ticket, sees it's stale, and throws it away — like ignoring a callback for an order you already changed.

**Why some settings are a fixed "menu," not a free-form form.**

- Three contribution styles (lump sum / DCA / value averaging) each need different extra information.
- Instead of one form with a grab-bag of optional boxes (which could be filled in contradictory combinations), the code defines three separate, labeled, mutually exclusive "shapes" — you must say which one before its details can even be read.
- Enforced by the language itself: a whole category of contradictory configurations becomes *impossible to construct*, everywhere, automatically — not just "checked and rejected later."

**Why answers come back in one of two labeled "envelopes."**

- Every check — data file valid? inputs valid? simulation succeeded? — answers with a "green envelope" (a confirmed, safe value) or a "red envelope" (an itemized list of what's wrong).
- Critical rule: never silently guess a plausible-looking substitute when something's actually wrong. A wrong-but-plausible number is more dangerous than a visible error, because someone might act on the wrong number.
- Same two-envelope shape everywhere — learn it once, use it everywhere.

**Where the historical price data comes from.**

- Think of it as a cookbook of past weekly results, prepared once, offline, before the "storefront" (the live site) opens — in a separate Python `pipeline/` folder, never in the browser.
- Raw prices start as ordinary spreadsheets (CSVs). What ships to the browser is a small, tightly packed binary file — a plain list of numbers, no labels or formatting — far smaller to download.
- A small "manifest" file alongside it describes how to read the numbers back correctly: which asset, which date, and a checksum (a numeric fingerprint) that catches a corrupted or partial download before it's used.
- Locked and versioned once published → every visitor simulates against the *exact same* checked dataset.
- This is why every result records its exact dataset version alongside the random seed: reproducing a result later needs both the calculation *and* the exact data version it ran on — like a recipe depends on the exact batch of ingredients used.

**How the project checks its own numbers are correct.**

- **Layer 1 — hand-calculated tests.** Work out a tiny example by hand, check the program matches exactly — like checking a calculator against pencil-and-paper on an easy case.
- **Layer 2 — statistical tests.** For the random (Monte Carlo) parts, you can't demand one exact number every run — instead, check that *averages over many runs* land close to theory, within pre-agreed wiggle room (never loosened after a failure). Not getting exactly 50/100 coin flips isn't "wrong"; getting 95/100 would be.
- **Layer 3 — independent cross-check (the strongest).** Build a *second*, separate version of the core logic, in a different language, from the plain-English rules only — not by reading the original code. Run both from the same numbers; results must match exactly.
  - One subtlety: because the historical numbers are stored in a less-precise format to save space, *both* versions must round to that same precision first, or they'd "disagree" for a fake reason.
  - Why this matters: "the code agrees with itself" is weaker evidence than "two independently-built systems, from the same spec, agree with each other." The second proves the *written rules* were actually clear and correctly understood.

## 7. Computational Cost and Memory

Definitions:

- $N$: number of paths;
- $T$: periods per path;
- $A$: number of assets, where $A \le 6$.

### Main Complexity

$$
O(N \times T \times A)
$$

- Student's $t$: Cholesky $O(A^3)$ once per run; correlated shocks ≈ $O(N \times T \times A^2)$. Fine for six assets, grows fast with more.
- Markov: a small extra per-period cost (sample a state and a compatible row). Regime classification and $P$ estimation happen once per data configuration.

### Setup, Per-Scenario, and Per-Period Costs — Distinguished

- **Fixed setup cost, once per run:** Higham repair plus Cholesky, $O(A^3)$. For $A\le6$: a few hundred floating-point operations — negligible.
- **Per-scenario cost, paid $N\times T$ times:** bootstrap $O(A)$ (read a row); Student's $t$ $O(A^2)$ (one $Lz$ product).
- **Per-period accounting cost, also paid $N\times T$ times, mostly independent of the engine:** returns/interest, margin checks, rebalancing, tax lots — each $O(A)$ alone; more features active means a bigger constant, but the same asymptotic shape.

Since $A$ is capped small by design, $O(N\times T)$ always dominates real running time — why one inequality ($N\times T\le10{,}000{,}000$) is enough as the whole guardrail.

### Memory Complexity Is Not the Same Axis as Time Complexity

Total work is $O(N\times T)$. Retained memory is deliberately much smaller:

- Terminal metrics: $O(N)$.
- Five quantile series: $O(T)$ — doesn't grow with $N$ (computed and discarded per period).
- Full detail for 50 retained paths: $O(T)$ (a fixed multiplier).

Total realized memory: $O(N+T)$, not $O(N\times T)$ — a deliberate, load-bearing design choice.

- The flat `Float64Array` of per-path equity (up to ~80 MB) is a transient scratchpad during computation, not what's kept.
- If holdings, debt, and cost basis were *also* retained per path, memory would multiply per quantity, per path — exactly why the 50-path cap is a hard rule.

### Batching Changes Responsiveness, Not the Complexity Class

- Splitting $O(N\times T)$ work into batches doesn't change the total work — it changes *when* progress updates and cancellation become possible.
- "How much total compute" (algorithmic) and "how responsive does it feel" (UX/scheduling) are different questions. Optimizing one doesn't automatically fix the other.

### Project Budget

$$
N \times T \le 10{,}000{,}000
$$

| Frequency and Horizon | Periods $T$ | Maximum Paths Within Budget |
| --- | ---: | ---: |
| 30 monthly years | 360 | 27,777 |
| 10 monthly years | 120 | 50,000, limited by the absolute maximum |
| 30 weekly years | 1,560 | 6,410 |
| 10 weekly years | 520 | 19,230 |

- 10 million `Float32` values ≈ 40 MB. Retaining all positions, debt, and basis per path would multiply that. Hence: batching, terminal metrics for all paths, and full detail for only 50.

### Measurements

Measure, using browser tools:

- total run time, time per batch;
- worker and main-thread memory;
- data load/decompress time;
- dropped frames during chart updates;
- the monthly vs. weekly difference;
- the effect of leverage, taxation, and rebalancing on time per period.

**Measure before optimizing** — the bottleneck may be rendering or buffer transfer, not the Monte Carlo math itself.

## 8. Testing, Validation, and Numerical Safety

### Essential Unit Tests

Small inputs, fixed seed, hand-calculable results:

- one asset, no costs or taxes;
- end-of-period contribution;
- purchase and sale with average cost;
- a loss offsetting a later gain;
- time-based and band-based rebalancing;
- fixed and percentage costs;
- debt interest;
- margin call, deleveraging, insolvency;
- aligned bootstrap rows;
- reproducibility with the same seed;
- a Higham-repaired matrix and valid Cholesky decomposition.

### Statistical Tests

No exact equality — over many paths, verify:

- simulated mean and volatility are close to input parameters;
- simulated correlations are close to the requested correlations;
- a small-$\nu$ Student's $t$ has heavier tails than a normal distribution;
- bootstrap sampling emits only complete historical rows;
- Markov transition frequencies approach matrix $P$.

- Pre-specify sample size and tolerance from sampling error — never loosen the tolerance after a failure.
- Add property-based invariant tests: non-negative long-only holdings, finite values, probability vectors summing to one, and value conservation across a no-cost internal rebalance.

### Tolerances and Edge Cases

IEEE-754 floating point, `NaN`, `Infinity`, epsilon comparisons, operation order. Handle explicitly:

- weights not summing to one, or to the selected gross exposure;
- disallowed negative inputs;
- a tax rate above 100%;
- invalid covariance;
- insufficient data;
- non-positive price or equity;
- an IRR with no unique solution;
- costs that make a trade economically infeasible.

### External Validation

- Compare small simulations against a spreadsheet or an independent Python calculation, before relying on the interface.
- Compare the full period-by-period behavior, not just terminal value: debt, basis, tax, costs, and value must agree every period.

Three layers:

- **Verification** — does the code implement the stated rules?
- **Statistical validation** — do generated samples reproduce the fitted distribution?
- **External validation** — is model behavior plausible on data not used for calibration?

Passing the first two does **not** establish forecasting ability.

## 9. Recommended Learning Sequence

1. Compounding, weights, contributions — without randomness.
2. Simple and log returns, mean, variance, percentiles.
3. Bootstrap sampling — one asset, then multiple assets with aligned rows.
4. Matrices, Cholesky decomposition, correlated-normal generation.
5. Student's $t$ vs. normal, on synthetic data.
6. The worker, typed arrays, batching, cancellation.
7. Rebalancing, cost basis, taxes, costs, leverage — one rule at a time, with hand-calculated tests for each.
8. Drawdown, Sharpe ratio, IRR, real returns — define conventions before adding metrics.
9. The educational page: assumptions, limitations, formulas.
10. Markov simulation — only after the existing engines are tested and cross-checked with independent results.

## 10. References and Further Study

Academic foundation; consult current documentation for browser APIs and libraries.

1. Glasserman, P. (2004). *Monte Carlo Methods in Financial Engineering*. Springer.
2. Casella, G., & Berger, R. L. (2002). *Statistical Inference* (2nd ed.). Duxbury.
3. Tsay, R. S. (2010). *Analysis of Financial Time Series* (3rd ed.). Wiley.
4. McNeil, A. J., Frey, R., & Embrechts, P. (2015). *Quantitative Risk Management* (Revised ed.). Princeton University Press.
5. Higham, N. J. (2002). Computing the nearest correlation matrix—A problem from finance. *IMA Journal of Numerical Analysis, 22*(3), 329–343.
6. Norris, J. R. (1998). *Markov Chains*. Cambridge University Press.
7. Maginn, J. L., Tuttle, D. L., McLeavey, D. W., & Pinto, J. E. (2007). *Managing Investment Portfolios* (3rd ed.). Wiley.
8. IEEE Standards Association. (2019). *IEEE Standard for Floating-Point Arithmetic* (IEEE 754-2019).

Suggested extensions: block bootstrap methods, shrinkage covariance estimators, multivariate maximum-likelihood estimation, backtesting of risk models, and time-weighted performance measurement.

The goal is not the most sophisticated model. It's understanding each model's assumptions, making those assumptions visible, and verifying the implementation follows the defined rules.
