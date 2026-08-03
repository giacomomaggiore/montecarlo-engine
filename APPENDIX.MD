# Appendix: University-Level Study Guide for the Project

This appendix is a compact set of lecture notes for designing, validating, and explaining the simulator. It distinguishes **accounting identities** (which must hold exactly given the stated conventions) from **statistical assumptions** (which are estimated, uncertain, and potentially wrong). It is educational material, not investment, tax, or legal advice.



### Notation and conventions

Time is indexed by $t=0,1,\ldots,T$; assets by $i=1,\ldots,A$; and simulation paths by $j=1,\ldots,N$. Unless noted otherwise, returns are periodic, all values are nominal base-currency amounts, and vectors are columns. The accounting convention is: apply returns and debt interest, add an end-of-period contribution, perform any forced margin action, rebalance, then record the period. A model is valid only relative to these explicit conventions.


## Financial Foundations

### Simple and Log Returns

The simple return of an asset between two dates is:

$$
r_t = \frac{P_t}{P_{t-1}} - 1
$$

$P_t$ must be a total-return price or adjusted close, with dividends and stock splits already incorporated. Portfolio value evolves as:

$$
V_t = V_{t-1}(1 + r_t)
$$

The log return is:

$$
\ell_t = \log(1 + r_t)
$$

Log returns add over time, whereas simple returns compound portfolio value directly. The Student's $t$ engine models log returns and converts them to simple returns using:

$$
r_t = e^{\ell_t} - 1
$$

This transformation prevents simulated returns below $-100\%$, which would produce a negative value for a long-only asset.

Over $T$ periods, $\log(V_T/V_0)=\sum_{t=1}^{T}\ell_t$, whereas the cumulative simple return is $\prod_{t=1}^{T}(1+r_t)-1$. These are not interchangeable averages: the geometric mean is generally below the arithmetic mean because volatility creates a compounding drag.

### Unleveraged Portfolio

For weights $w_i$ that sum to one, the portfolio simple return for a period is:

$$
r_{p,t} = \sum_{i=1}^{n} w_{i,t-1} r_{i,t}
$$

Weights change after returns are applied. Rebalancing therefore requires tracking the value and quantity of each position; it cannot be reduced to a fixed weighted average of returns.

If $x_{i,t-1}$ denotes the dollar value immediately before returns, then $x_{i,t}^{-}=x_{i,t-1}(1+r_{i,t})$ and $V_t^{-}=\sum_i x_{i,t}^{-}$. The realised pre-trade weight is $x_{i,t}^{-}/V_t^{-}$. This state-based formulation is the correct starting point for rebalancing, proportional trading costs, average cost basis, and leverage.

### Leveraged Portfolio

Use the following definitions consistently:

$$
	\text{equity} = \text{gross asset value} - \text{debt}
$$

$$
	\text{gross exposure} = \frac{\text{gross asset value}}{\text{equity}}
$$

$$
	\text{maintenance margin} = \frac{\text{equity}}{\text{gross asset value}}
$$

For target leverage $L$, the initial maintenance ratio is $1/L$. With user-entered maintenance requirement $m$, the valid target is $1\le L\le\min(4,1/m)$. At equality, there is no margin buffer: a small loss, interest charge, or transaction cost can trigger a margin call.

For a single period with gross assets $G$, debt $D$, and asset return $r$ before interest, equity changes from $E=G-D$ to approximately $E'=G(1+r)-D(1+i_d)$, where $i_d$ is the borrowing rate. Leverage magnifies both gains and losses because the debt claim is fixed over the period. The approximation becomes an exact accounting identity once interest timing, trades, taxes, and costs are specified in the engine.

### Contributions and Cash Flows

Recurring contributions are made at the end of each period and do not earn that period's return. This convention must be identical in tests, the engine, and charts.

A high terminal value with recurring contributions does not imply a high investment return. Therefore:

* use CAGR only for an initial investment with no subsequent cash flows;
* use IRR or money-weighted return when contributions occur;
* use a cash-flow-neutral portfolio return series for volatility, Sharpe ratio, and drawdown.

For dated investor cash flows $C_t$ (positive when paid by the investor) and terminal distribution $W_T$, the money-weighted periodic return $q$ solves

$$
0=-C_0-\sum_{t=1}^{T} \frac{C_t}{(1+q)^t}+\frac{W_T}{(1+q)^T}.
$$

This is an IRR equation, not necessarily a uniquely solvable statistic: non-conventional cash-flow signs can create multiple roots or no economically meaningful root. The application must report this limitation instead of silently selecting an arbitrary answer.

### Taxation, Cost Basis, and Costs

The tax model is an educational simplification rather than tax advice:

* each asset has an average cost basis;
* a sale realizes $\text{proceeds} - \text{basis sold}$;
* realized losses offset later realized gains in the same path, without tax refunds;
* purchase costs increase basis and sale costs reduce proceeds;
* final liquidation sells all positions and calculates remaining taxes and costs.

Relevant topics include realized and unrealized capital gains, FIFO compared with average cost, tax-loss harvesting, and the limitations of this simplified model.

### Inflation and Base Currency

The simulator performs accounting in nominal base-currency units. For a real result, deflate nominal value by an inflation index consistent with the base currency:

$$
V_t^{\text{real}} = \frac{V_t^{\text{nominal}}}{I_t / I_0}
$$

A USD portfolio requires USD-converted returns, US CPI, and a USD short rate. An EUR portfolio requires EUR-converted returns, HICP, and an EUR short rate. Mixing local-currency returns without FX conversion is financially inconsistent.

Inflation adjustment changes purchasing-power interpretation, not the nominal cash ledger. For modest rates, the exact real simple return is $(1+r_t)/(1+\pi_t)-1$, not merely $r_t-\pi_t$; the latter is a first-order approximation.

## 2. Probability, Statistics, and Estimation

### Random Variables and Sampling

A Monte Carlo simulation produces many random observations from the same model. It does not provide a certain forecast; it estimates a distribution of possible outcomes.

For a metric $X$, the sample mean is:

$$
\bar{X} = \frac{1}{N}\sum_{j=1}^{N}X_j
$$

The Monte Carlo error of the mean decreases approximately as $1/\sqrt{N}$. Halving the error requires about four times as many paths. This relationship determines the feasible number of browser simulations.

More precisely, if independent terminal outcomes have finite standard deviation $\sigma_X$, then $\operatorname{SE}(\bar X)\approx s_X/\sqrt N$. A 95% Monte Carlo confidence interval is approximately $\bar X\pm1.96\operatorname{SE}(\bar X)$ under a central-limit approximation. This interval quantifies error from using finitely many simulated paths **conditional on the fitted model**; it does not quantify whether the model predicts future markets well.

### Mean, Variance, and Standard Deviation

For returns $r_1, \ldots, r_T$:

$$
s^2 = \frac{1}{T-1}\sum_{t=1}^{T}(r_t - \bar{r})^2
$$

Annualized volatility is $s\sqrt{12}$ for monthly data and $s\sqrt{52}$ for weekly data. Annualization assumes comparable observations and does not remove non-normality risk.

Estimation from historical data adds parameter uncertainty. Means are particularly noisy relative to volatilities and correlations, and a sample covariance is conditional on the chosen date range, frequency, proxies, and missing-data rule. The interface should disclose the common sample's dates and observation count.

### Percentiles and Quantiles

The $q$ -th percentile is the value below which a fraction $q$ of outcomes falls. The chart displays the 10th, 25th, 50th, 75th, and 90th percentiles at each period.

A percentile band is not an individual path. The 10th-percentile value in one month may belong to a different path from the 10th-percentile value in the next month. Only retained individual paths are selectable.

### Correlation and Covariance

Covariance measures how two returns move together. Correlation normalizes this measure to the interval from $-1$ to $1$:

$$
\rho_{ij} = \frac{\operatorname{Cov}(r_i, r_j)}{\sigma_i\sigma_j}
$$

Historical correlation is not stable, particularly during crises. It is an estimated input rather than a market law.

### Positive Semidefinite Matrices

A covariance matrix used to generate joint shocks must be positive semidefinite. Numerical errors, insufficient data, or nearly duplicate assets can create negative eigenvalues and cause Cholesky decomposition to fail.

Higham's algorithm finds a valid correlation matrix close to the estimated matrix. Relevant topics are:

* eigenvalues and eigenvectors;
* Cholesky decomposition;
* the difference between covariance and correlation;
* preservation of asset variances during matrix repair.

Let $D=\operatorname{diag}(s_1,\ldots,s_A)$ and let $R$ be a correlation matrix. The covariance is $\Sigma=DRD$. 

A valid correlation matrix is symmetric, has diagonal entries one, and is positive semidefinite: $a^\top R a\ge0$ for every vector $a$. 

If $R=LL^\top$ is positive definite, correlated normal shocks can be generated as $Lz$ for $z\sim N(0,I)$. Higham repair should be logged because it changes the fitted dependence structure; a small positive diagonal jitter may still be required for a strict Cholesky factorization.

### Dependence Beyond Correlation

Correlation describes linear co-movement, not necessarily joint crashes, tail dependence, causality, or stability through time. A multivariate elliptical Student's *t* model introduces common scale shocks and therefore tail dependence, while independently bootstrapped rows preserve only the realised one-period dependence in the selected sample. Neither approach establishes a structural economic relationship.

## 3. Monte Carlo Models in the Project

### Simulation Path

A path is a sequence of period scenarios. Each scenario contains:

* joint asset returns;
* inflation;
* the risk-free rate or base borrowing cost;
* optional metadata, such as a historical row or Markov regime.

The engine generates scenarios. The portfolio loop applies the same accounting rules for returns, interest, contributions, margin calls, rebalancing, taxation, and result recording. These responsibilities must remain separate.

### Historical Joint Bootstrap

Procedure:

1. Build an aligned historical matrix for all selected assets, inflation, and rates.
2. Remove rows with missing data.
3. Sample one row with replacement for each simulated period.
4. Pass all values from the sampled row to the portfolio together.

This method is simple and transparent. It preserves observed shocks and contemporaneous correlations.

It is an IID empirical bootstrap: conditional on the aligned dataset, each historical row has equal probability and simulated periods are independent. It does not preserve market order, volatility persistence, or crisis duration. It preserves only dependence observed within the same historical period. A block bootstrap could preserve short-run serial dependence, but it would require an explicit block-length rule and is not part of the first implementation.

The sampling universe must be constructed before simulation, rather than separately for each asset. Otherwise, a portfolio can combine an equity crash from one month with a bond shock and inflation observation from unrelated months, creating an outcome that was not a historical joint observation.

### Parametric Student's $t$ Engine
A multivariate normal distribution tends to underestimate extreme events. The Student's $t$ distribution provides heavier tails controlled by the degrees-of-freedom parameter $\nu$, and it interpolates between heavy-tailed behaviour and the Gaussian as $\nu\to\infty$.

Key theoretical properties

- **Tails and moments:** the $t$ distribution has finite mean only for $\nu>1$ and finite variance only for $\nu>2$. The excess kurtosis is

$$
	\text{excess kurtosis} = \begin{cases} \dfrac{6}{\nu - 4}, & \nu>4, \\ \text{undefined (infinite)}, & \nu\le 4. \end{cases}
$$

**Meaning of excess kurtosis.** Kurtosis is the standardized fourth central moment,

$$
\operatorname{Kurt}(X)=E\left[\left(\frac{X-E[X]}{\sqrt{\operatorname{Var}(X)}}\right)^4\right],
$$

when the required moments exist. A normal distribution has kurtosis $3$, so **excess kurtosis** is kurtosis minus $3$. It measures how much more probability a distribution places in its tails than a normal distribution with the same mean and variance. Positive excess kurtosis means extreme observations occur more often than under a normal model; it does not merely mean the centre is taller.

For example, $t_{10}$ has excess kurtosis $6/(10-4)=1$, while the normal limit has excess kurtosis $0$. As $\nu$ approaches $4$ from above, the fourth moment becomes arbitrarily large; at $\nu\le4$, kurtosis is not a finite summary. Sample excess kurtosis is very sensitive to a few extreme returns, so the project's estimate of $\nu$ is a transparent approximation, not a stable fact about markets.

- **Relation to the normal:** for large $\nu$ the $t$ density converges to the normal density; for moderate or small $\nu$ the tails are substantially heavier which increases the probability of extreme returns.

- **Multivariate Student's $t$:** use $S$ exclusively for the *scale* matrix. If $Z\sim N(0,S)$ and $U\sim\chi^2_{\nu}$ are independent, then

$$
Y = \mu + \frac{Z}{\sqrt{U/\nu}} \sim t_{\nu}(\mu, S).
$$

Equivalently, take $Z=Lz$ where $LL^\top=S$ and $z\sim N(0,I)$. This construction makes the shared random divisor explicit: it produces simultaneous unusually large moves across assets.

Formulas

- **Univariate Student's $t$ pdf (location-scale):** for $x\in\mathbb{R}$, degrees of freedom $\nu>0$, location $\mu$ and scale $\sigma>0$,

$$
f(x;\nu,\mu,\sigma)=\frac{\Gamma\left(\frac{\nu+1}{2}\right)}{\sqrt{\nu\pi}\,\Gamma\left(\frac{\nu}{2}\right)\sigma}\left[1+\frac{1}{\nu}\left(\frac{x-\mu}{\sigma}\right)^2\right]^{-\frac{\nu+1}{2}}.
$$

**Meaning of the location-scale form.** If $T\sim t_\nu$ is a standard Student's $t$ variable, then $X=\mu+\sigma T$ has the density above. Location $\mu$ shifts the entire distribution; it is the mean when $\nu>1$, and the median and mode for every symmetric $t$ distribution. The positive scale $\sigma$ stretches or compresses deviations from $\mu$: doubling $\sigma$ doubles every quantile distance from the centre.

Scale is **not** generally standard deviation. For $\nu>2$,

$$
\operatorname{Var}(X)=\sigma^2\frac{\nu}{\nu-2},
$$

so its standard deviation is $\sigma\sqrt{\nu/(\nu-2)}$, not $\sigma$. Only in the normal limit ($\nu\to\infty$) do scale and standard deviation coincide. Thus a fitted historical volatility cannot be used directly as $\sigma$ unless the degrees-of-freedom adjustment is made.

- **Standard $t$ (\(\mu=0,\sigma=1\)) and CDF:** denote the CDF by $T_{\nu}(x)=\Pr(t_{\nu}\le x)$. Closed-form CDFs exist only for special $\nu$; use numerical libraries for general $\nu$.

- **Variance (when defined):** for the standard $t_{\nu}$ with $\nu>2$,

$$
\operatorname{Var}(t_{\nu})=\frac{\nu}{\nu-2}.
$$
For the location-scale form, multiply by $\sigma^2$.

- **Construction from Normal and Chi-square:** if $Z\sim N(0,1)$ and $V\sim\chi^2_{\nu}$ independent, then

$$
T = \dfrac{Z}{\sqrt{V/\nu}} \sim t_{\nu}.
$$

- **Multivariate $t$ density:** for $x\in\mathbb{R}^p$, degrees $\nu$, location $\mu$ and positive-definite scale matrix $S$,

$$
f(x)=\frac{\Gamma\left(\frac{\nu+p}{2}\right)}{\Gamma\left(\frac{\nu}{2}\right)(\nu\pi)^{p/2}|S|^{1/2}}\left[1+\frac{1}{\nu}(x-\mu)^\top S^{-1}(x-\mu)\right]^{-\frac{\nu+p}{2}}.
$$

These formulas, together with the moment and scale relations above, provide the core mathematical definitions used when fitting and sampling Student's $t$ models in the engine.

- **Scale vs covariance:** the scale matrix $S$ used in the multivariate $t$ is related to the covariance matrix $\Sigma$ by

$$
\Sigma = S\frac{\nu}{\nu - 2}\quad(\nu>2),
$$
so the practitioner must not confuse $S$ and $\Sigma$ when calibrating volatility.

Thus, for the implementation's covariance estimate $\widehat\Sigma$ and $\nu>2$, use $S=\widehat\Sigma(\nu-2)/\nu$. Applying the Cholesky factor of $\widehat\Sigma$ directly would inflate simulated covariance by $\nu/(\nu-2)$.

**Meaning of scale versus covariance.** The matrix $S$ controls the shape and directions of a multivariate $t$, much as a covariance matrix does for a multivariate normal distribution. But the random factor $1/\sqrt{U/\nu}$ adds extra variation to every vector. Therefore, when $\nu$ is finite, $S$ is smaller than the actual covariance matrix. Correlations are unchanged by the positive factor $\nu/(\nu-2)$, but every variance and covariance is enlarged by it.

For one asset with $\nu=6$ and historical variance $\widehat\Sigma=0.04$, the factor is $6/(6-2)=1.5$. Set $S=0.04/1.5\approx0.02667$. The generated $t_6$ returns then have variance $0.02667\times1.5=0.04$, matching the calibration target. If $S$ were incorrectly set to $0.04$, the simulated variance would be $0.06$: 50% too high. The same scalar conversion applies to every element of the full covariance matrix before Cholesky decomposition.

Parameter estimation and practical notes

- **Estimating $\nu$:** common approaches are (a) method-of-moments using sample excess kurtosis $\hat\gamma_2$, giving $\hat\nu=4+6/\hat\gamma_2$ only when $\hat\gamma_2>0$, (b) maximum likelihood estimation (MLE) on standardized residuals, or (c) profile likelihood over a grid. MLE is preferable when data size permits, but the project deliberately uses a transparent pooled-kurtosis estimate and clamps it to $[5,100]$; this stabilizes the generator but is not a full multivariate MLE.

- **Correlation and positive-definiteness:** estimate a correlation matrix from standardized residuals and repair it (for example using Higham's near-correlation matrix) before using Cholesky on the scale/correlation matrix.

- **Generating samples:** the usual construction draws a multivariate normal vector and an independent chi-square (or Gamma) variate, rescales, and applies the Cholesky factor of the scale matrix to introduce correlation.

- **Implications for risk metrics:** heavy tails increase VaR and Expected Shortfall materially versus Gaussian assumptions. Because variance may be undefined for $\nu\le2$, avoid using variance-based standardization when $\nu$ is estimated near or below 2.

Recommended simulation procedure (expanded)

1. Estimate the location and covariance from aligned log returns, and report the calibration sample.
2. Estimate $\nu$, check its stability, and enforce the project's documented clamp.
3. Repair the correlation matrix if needed, restore the estimated marginal scales, and construct $S=\widehat\Sigma(\nu-2)/\nu$.
4. For each draw, sample $z\sim N(0,I)$ and $U\sim\chi^2_{\nu}$ independently; then calculate $\ell=\mu+Lz/\sqrt{U/\nu}$ with $LL^\top=S$.
5. Convert simulated log returns to simple returns and run the portfolio accounting loop.

Avoid confusing the scale matrix and the covariance matrix when reporting or matching historical volatility; document your parameterization clearly.

### Pseudo-Randomness, Seed, and Reproducibility

A pseudo-random generator is deterministic for a given initial state. The project uses `xoshiro128**` with a 32-bit seed:

* the same seed, data, and model version must produce the same result;
* do not use `Math.random()`, because it prevents reproducible tests;
* the generator is not cryptographic and must not be used for security;
* record the seed, dataset version, and model version in exports.

Relevant topics include uniform-to-normal transformations such as Box-Muller and the construction of a Student's $t$ variable from normal and chi-square variables.

## 4. Markov Chains and Market Regimes

### Basic Concept

A discrete Markov chain has states $S_t \in \{1, \ldots, K\}$. The probability of the next state depends only on the current state:

$$
P(S_{t+1}=j \mid S_t=i) = P_{ij}
$$

$P$ is a transition matrix: every element is non-negative and every row sums to one. The vector $\pi$ contains the initial state probabilities.

### Rationale

An independent bootstrap can sample a crisis month followed immediately by a quiet month. A Markov model can assign a higher probability to difficult periods after difficult periods when that persistence is present in the data.

An illustrative three-state model is:

| Regime | Interpretation | Emission |
| --- | --- | --- |
| 0 | Calm market | Low-volatility historical rows |
| 1 | Normal market | Intermediate historical rows |
| 2 | Stress | Rows with drawdowns or high volatility |

A state is not an economic forecast. It is a statistical classification of historical data.

### Initial Implementation

The first Markov version should not estimate a new distribution for each regime. Use the following procedure:

1. Build the aligned historical matrix already used by the other engines.
2. Assign each row to a small number of regimes with a documented rule.
3. Count observed transitions between consecutive states to estimate $P$.
4. Estimate $\pi$ from initial historical frequencies or from the stationary distribution.
5. Sample the next state from the appropriate row of $P$.
6. Sample a historical row assigned to that regime.
7. Pass the complete row to the portfolio loop.

This approach preserves cross-asset correlation because it emits complete historical rows. It is also easier to inspect than a model with many parametric distributions.

### Design Choices Before Implementation

* Number of regimes: begin with 2 or 3.
* Regime definition: volatility/return thresholds, deterministic clustering, or a hidden Markov model.
* Classification features: equity-index return, rolling volatility, drawdown, credit spreads, or a combination.
* Sparse-regime policy: merge regimes, reject the model, or apply smoothing.
* Frequency: weekly and monthly states are not directly interchangeable.

### Limitations and Advanced Topics

First-order Markov chains assume that only the current state matters. They can create excessively abrupt regime changes and depend strongly on the classification method.

Advanced topics and theoretical properties

- **Stationary distribution:** the stationary vector $\pi$ satisfies

$$
\pi = \pi P,
$$

and for an irreducible, positive-recurrent chain $\pi_i$ gives the long-run fraction of time spent in state $i$.

- **Recurrence and mean recurrence time:** for an ergodic chain the mean recurrence time to state $i$ equals $1/\pi_i$.

- **Persistence and expected sojourn time:** the expected consecutive time spent in state $i$ (sojourn) is approximately $1/(1-P_{ii})$ when self-transition probabilities dominate.

- **Irreducibility and aperiodicity:** ensure the estimated chain is irreducible (every state reachable) and aperiodic (not locked in cycles) so that a unique stationary distribution exists and mixing occurs.

- **Mixing and convergence:** the chain's mixing time controls how quickly samples forget the initial state. Slow mixing leads to long regime persistence and affects simulated path diversity.

- **Absorbing states and the fundamental matrix:** if some regimes are absorbing, analyse the fundamental matrix $N=(I-Q)^{-1}$ for transient-state behaviour and expected visits.

Estimation and regularization

- **MLE from counts:** when regimes are assigned to historical rows, maximum likelihood estimation of $P$ reduces to normalized counts: $P_{ij}=N_{ij}/\sum_j N_{ij}$. Apply Laplace (add-one) or Dirichlet smoothing when counts are sparse.

- **Hidden Markov models (HMMs):** an HMM jointly estimates transitions and emission distributions (or parametric emissions such as Gaussians or Student's $t$) using EM/Baum–Welch. HMMs capture state uncertainty but are more complex to validate.

- **Model selection and validation:** use out-of-sample tests, likelihood-based criteria (AIC/BIC), and qualitative checks (persistence, regime durations) to avoid overfitting. Compare simulated regime durations to historical durations.

Practical design guidance

- **Simple initial approach:** start with 2–3 regimes, use transparent deterministic classification (volatility thresholds or clustering), and estimate $P$ from empirical transitions; this yields interpretable behaviour and easy debugging.

- **Emission choice:** prefer emitting complete historical rows when cross-asset correlation preservation is essential. Use parametric regime emissions (e.g., Student's $t$ per regime) only when you need smoothed synthetic rows and have enough data.

- **Smoothing and sparse regimes:** merge or smooth regimes with few observations rather than rely on zero-probability transitions. Laplace smoothing reduces brittle behaviour in simulation.

- **Diagnostics:** report the estimated $P$ matrix, stationary distribution $\pi$, mean regime durations, and mixing diagnostics. Visualize regime sequences and compare path-level statistics to historical sequences.

Additional formulas and practical calculations

- **n-step transitions:** the probability of moving from state $i$ to $j$ in $n$ steps is the $(i,j)$ element of $P^n$. For a distribution vector $p_0$ over states, the distribution after $n$ steps is

$$
p_n = p_0 P^n.
$$

- **Stationary distribution (linear system):** solve

$$
\pi = \pi P,\qquad \sum_i\pi_i=1,
$$

which in practice amounts to solving the linear system $(P^\top - I)\pi^\top = 0$ with a normalization constraint.

- **Two-state closed-form:** for

$$
P=\begin{pmatrix}p & 1-p\\1-q & q\end{pmatrix},
$$
the stationary distribution is

$$
\pi=\left(\frac{1-q}{2-p-q},\,\frac{1-p}{2-p-q}\right).
$$

- **Sampling the chain:** given current state $i$, draw the next state from the categorical distribution with probabilities $P_{i,\cdot}$. Initialize with $\pi$ or a chosen start distribution.

- **Laplace smoothing (additive):** when counts $N_{ij}$ are sparse, use

$$
\hat P_{ij}=\frac{N_{ij}+\alpha}{\sum_j(N_{ij}+\alpha)}=\frac{N_{ij}+\alpha}{N_{i\cdot}+K\alpha},
$$
with $\alpha=1$ (add-one) or a small $\alpha<1$ for milder regularization.

- **Spectral gap and mixing:** let $1=\lambda_1>\lambda_2\ge\dots$ be eigenvalues of $P$ in magnitude; the spectral gap $1-\lambda_2$ controls mixing speed. A small gap implies slow mixing and long persistence of initial conditions.

- **Expected visits (absorbing/transient):** partition $P$ into transient $Q$ and absorbing blocks; the fundamental matrix $N=(I-Q)^{-1}$ gives expected visits to transient states before absorption.

Practical diagnostics and checks

- Compute empirical transition counts $N_{ij}$, show $P$ and smoothed $\hat P$, and report eigenvalues and the second-largest magnitude eigenvalue $\lambda_2$.
- Compare empirical and simulated regime-length distributions (histograms) and mean durations $1/(1-P_{ii})$.
- When using HMMs, show posterior state probabilities for each historical row and inspect ambiguous classifications.

These additions extend the Markov chain exposition with concrete formulas and diagnostics useful for implementation and validation.

## 5. Metrics and Result Interpretation

### Drawdown

Drawdown measures the loss from the previous peak:

$$
DD_t = \frac{V_t}{\max_{u \le t} V_u} - 1
$$

It must be calculated on a unitized index rather than a value series with contributions. Otherwise, a contribution may appear to be a market recovery.

If $u_0=1$ and $u_t=u_{t-1}(1+r_{p,t}^{\mathrm{neutral}})$, calculate drawdown from $u_t$, where the neutral return excludes external cash flows. Maximum drawdown is $\min_t DD_t$. It measures depth, not duration or time to recovery.

### Sharpe Ratio

A periodic definition is:

$$
	\text{Sharpe} = \frac{\overline{r_p-r_f}}{s(r_p-r_f)}\sqrt{m}
$$

Here, $m$ is 12 or 52. The Sharpe ratio does not measure tail risk and can be misleading with asymmetric distributions, leverage, or dependent returns.

It is undefined when the sample standard deviation of excess returns is zero. Serial correlation can make usual annualization overstate the ratio; report it as a descriptive, model-dependent summary rather than a utility measure.

### Tail Metrics and Decision Limits

Future versions may include:

* Value at Risk (VaR): loss threshold at a specified percentile;
* Conditional VaR or Expected Shortfall: average loss beyond VaR;
* probability of ruin: probability of insolvency; target shortfall is reported separately;
* sequence-of-returns risk: effect of return order on portfolios with cash flows.

These metrics are model-dependent estimates, not objective probabilities.

For a loss variable $L=-R$, $\operatorname{VaR}_{\alpha}(L)=\inf\{x:\Pr(L\le x)\ge\alpha\}$ and $\operatorname{ES}_{\alpha}(L)=E[L\mid L\ge\operatorname{VaR}_{\alpha}(L)]$ for a continuous distribution. Expected shortfall uses the severity of tail losses, but both measures inherit every assumption in the data, calibration, and simulation engine. A percentile fan chart similarly shows a cross-sectional distribution at each horizon, not the trajectory that any investor will experience.

## 6. Browser Software Engineering

### Separation of Responsibilities

The project has four simple layers:

* `features/`: React components, inputs, and results;
* `core/data/`: loading and validation of static data;
* `core/simulation/`: `PeriodScenario` generators;
* `core/portfolio/`: pure accounting independent of the simulation method.

The Web Worker coordinates computation and batching. React contains no financial formulas. This separation permits engine comparisons using identical scenarios and accounting tests without a browser.

### Essential TypeScript

Relevant language features include:

* discriminated types for `engine: 'bootstrap' | 'studentT' | 'markov'`;
* `readonly` for immutable inputs;
* `Float32Array` and `Float64Array`;
* unions, type guards, and runtime validation of JSON data;
* the difference between JavaScript `number` values and typed-array values.

`.f32` files are compact for transfer. Accounting operations must use JavaScript `number` values, which provide IEEE-754 double precision, rather than `Float32` values.

### React and Simulation State

The simulator must keep input state separate from execution state:

* valid configuration or validation errors;
* current run ID;
* `idle`, `running`, `completed`, `cancelled`, or `failed` status;
* progress and the most recent completed result.

When input changes during a simulation, terminate the worker and ignore messages with an obsolete run ID. Update charts once per batch rather than once per path.

### Web Workers and Buffer Transfer

A Web Worker prevents main-thread blocking but does not make computation free:

* the worker cannot update React or the DOM directly;
* `postMessage` without a transfer list copies buffers and can consume substantial memory;
* with a transfer list, the buffer changes owner and the sender can no longer use it;
* a long synchronous loop cannot receive cancellation messages;
* process bounded batches and publish progress between batches.

### Static Data and Caching

Relevant browser topics include `fetch`, `ArrayBuffer`, `DataView`, `Cache-Control`, Brotli/gzip compression, and browser caching. The manifest should be small and loaded immediately. The return matrix should be loaded only after frequency and currency selection.

Do not use a Parquet parser in the browser for the first version. Its compression benefit does not justify the complexity when a `Float32` binary file has a simple, known schema.

### Charts with uPlot

uPlot is suitable for dense time series. Use the following rules:

* provide only percentiles and at most 50 individual paths;
* do not create one chart per simulation;
* maintain stable container dimensions;
* update chart data after each batch rather than after each point;
* show the leverage ratio only when leverage is active.

## 7. Computational Cost and Memory

Definitions:

* $N$: number of paths;
* $T$: periods per path;
* $A$: number of assets, where $A \le 6$.

### Main Complexity

The portfolio loop costs approximately:

$$
O(N \times T \times A)
$$

For Student's $t$, Cholesky factorization of an $A \times A$ matrix costs $O(A^3)$ once per run. Generating correlated shocks costs approximately $O(N \times T \times A^2)$. This is acceptable for six assets but grows rapidly with asset count.

For Markov simulation, the additional per-period cost is small: sample a state and a compatible row. Regime classification and transition-matrix estimation occur once for each data configuration.

### Project Budget

The limit is:

$$
N \times T \le 10{,}000{,}000
$$

Examples:

| Frequency and Horizon | Periods $T$ | Maximum Paths Within Budget |
| --- | ---: | ---: |
| 30 monthly years | 360 | 27,777 |
| 10 monthly years | 120 | 50,000, limited by the absolute maximum |
| 30 weekly years | 1,560 | 6,410 |
| 10 weekly years | 520 | 19,230 |

A `Float32Array` containing 10 million values requires approximately 40 MB. Retaining all positions, debt balances, and cost bases for every path would multiply memory use. The worker must therefore process batches, retain terminal metrics for all paths, and retain complete details for only 50 paths.

### Measurements

Use browser performance tools to measure:

* total run time and time per batch;
* worker and main-thread memory;
* data loading and decompression time;
* dropped frames during chart updates;
* the difference between monthly and weekly data;
* the effect of leverage, taxation, and rebalancing on time per period.

Measure before optimizing. The primary bottleneck may be rendering, buffer transfer, or allocation rather than the Monte Carlo formula.

## 8. Testing, Validation, and Numerical Safety

### Essential Unit Tests

Each test uses small inputs, a fixed seed, and hand-calculable results:

* one asset with no costs or taxes;
* end-of-period contribution;
* purchase and sale with average cost;
* a loss offsetting a later gain;
* time-based and band-based rebalancing;
* fixed and percentage costs;
* debt interest;
* margin call, deleveraging, and insolvency;
* aligned bootstrap rows;
* reproducibility with the same seed;
* a Higham-repaired matrix and valid Cholesky decomposition.

### Statistical Tests

Statistical tests must not require exact equality. Over many paths, they verify that:

* simulated mean and volatility are close to input parameters;
* simulated correlations are close to the requested correlations;
* a Student's $t$ distribution with small $\nu$ has heavier tails than a normal distribution;
* bootstrap sampling emits only complete historical rows;
* Markov transition frequencies approach matrix $P$.

For each stochastic test, pre-specify a sample size and tolerance justified by sampling error, rather than changing the tolerance after a failure. Add property-based tests for invariants: non-negative long-only holdings, finite values for valid configurations, probability vectors summing to one within tolerance, and conservation of value across a no-cost internal rebalance.

### Tolerances and Edge Cases

Relevant numerical topics include IEEE-754 floating point, `NaN`, `Infinity`, epsilon comparisons, and operation order. Handle explicitly:

* weights that do not sum to one or to the selected gross exposure;
* negative inputs where they are not permitted;
* tax rates above $100\%$;
* invalid covariance;
* insufficient data;
* non-positive price or equity;
* IRR with no unique solution;
* costs that make a trade economically infeasible.

### External Validation

Compare small simulations with a spreadsheet or an independent Python calculation before relying on the interface. Compare the complete period-by-period behavior, not only terminal value: debt, basis, tax, costs, and value must agree in every period.

Validation has three layers: **verification** asks whether code implements stated rules; **statistical validation** asks whether generated samples reproduce the fitted distribution; and **external validation** asks whether model behavior remains plausible on data not used for calibration. Passing the first two does not establish forecasting ability.

## 9. Recommended Learning Sequence

1. Implement and verify compounding, weights, and contributions without randomness.
2. Study simple returns, log returns, mean, variance, and percentiles.
3. Implement bootstrap sampling for one asset and then for multiple assets using aligned rows.
4. Study matrices, Cholesky decomposition, and correlated-normal generation.
5. Implement Student's $t$ and compare it with the normal distribution using synthetic data.
6. Add the worker, typed arrays, batching, and cancellation.
7. Add rebalancing, cost basis, taxes, costs, and leverage one rule at a time, with hand-calculated tests for each rule.
8. Study drawdown, Sharpe ratio, IRR, and real returns. Add metrics only after defining their conventions.
9. Implement the educational page that documents assumptions, limitations, and formulas.
10. Study and add Markov simulation only after the existing engines have been tested and compared with independent results.

## 10. References and Further Study

Use these sources as the academic foundation; consult current official documentation for browser APIs and libraries.

1. Glasserman, P. (2004). *Monte Carlo Methods in Financial Engineering*. Springer.
2. Casella, G., & Berger, R. L. (2002). *Statistical Inference* (2nd ed.). Duxbury.
3. Tsay, R. S. (2010). *Analysis of Financial Time Series* (3rd ed.). Wiley.
4. McNeil, A. J., Frey, R., & Embrechts, P. (2015). *Quantitative Risk Management* (Revised ed.). Princeton University Press.
5. Higham, N. J. (2002). Computing the nearest correlation matrix—A problem from finance. *IMA Journal of Numerical Analysis, 22*(3), 329–343.
6. Norris, J. R. (1998). *Markov Chains*. Cambridge University Press.
7. Maginn, J. L., Tuttle, D. L., McLeavey, D. W., & Pinto, J. E. (2007). *Managing Investment Portfolios* (3rd ed.). Wiley.
8. IEEE Standards Association. (2019). *IEEE Standard for Floating-Point Arithmetic* (IEEE 754-2019).

Suggested extensions: block bootstrap methods, shrinkage covariance estimators, multivariate maximum-likelihood estimation, backtesting of risk models, and time-weighted performance measurement.

The objective is not to use the most sophisticated model. It is to understand each model's assumptions, make those assumptions visible in the interface, and verify that the implementation follows the defined rules.

