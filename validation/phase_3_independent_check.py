"""Phase 3.6 independent cross-check for the parametric Student's t engine.

This script is NOT part of the shipped pipeline and is not run by CI. Like
validation/phase_1_6_independent_check.py, it exists purely as an audit
trail: a second implementation of the Phase 3 chain -- Box-Muller normals,
Marsaglia-Tsang gammas, the Student's t fit (log returns, sample mean,
ddof=1 covariance, pooled moment-ratio kurtosis, nu = 4 + 6/gamma_2 clamped
to [5, 100], scale S = Sigma*(nu-2)/nu, Higham nearest-correlation repair
via NumPy's own eigendecomposition, Cholesky), the per-scenario sampling
rule, and the Phase 1 portfolio accounting -- written from the README's
Phase 3 prose, not by reading the TypeScript source line by line. Its
printed numbers are pasted as expected values into
src/core/simulation/studentTIndependentCheck.test.ts and
src/core/simulation/parametricStudentT.test.ts /
src/core/math/distributions.test.ts, so the TypeScript engine is checked
against an independently derived implementation instead of only against its
own author's arithmetic.

Unlike Phase 1.6 (integers and +-*/ only), this chain exercises exp, log,
cos, and sqrt: cross-language agreement additionally proves the
transcendental-function results match at float64 precision on this platform.

Run with: python3 validation/phase_3_independent_check.py
"""

import math

import numpy as np

MASK32 = 0xFFFFFFFF
UINT32_RANGE = 1 << 32


# --- xoshiro128** PRNG (same free-function port proven in Phase 1.6) --------


def imul32(a, b):
    # Math.imul keeps only the low 32 bits; unsigned multiply-and-mask
    # reproduces it bit for bit.
    return (a * b) & MASK32


def rotl32(value, bits):
    return ((value << bits) & MASK32) | (value >> (32 - bits))


def init_state(seed):
    if not (0 <= seed <= MASK32):
        raise ValueError("seed must be an unsigned 32-bit integer")
    value = seed
    state = []
    for _ in range(4):
        value = (value + 0x9E3779B9) & MASK32
        mixed = value
        mixed = imul32(mixed ^ (mixed >> 16), 0x85EBCA6B)
        mixed = imul32(mixed ^ (mixed >> 13), 0xC2B2AE35)
        state.append((mixed ^ (mixed >> 16)) & MASK32)
    if all(word == 0 for word in state):
        raise ValueError("seed expansion produced an all-zero state")
    return tuple(state)


def next_uint32(state):
    s0, s1, s2, s3 = state
    result = imul32(rotl32(imul32(s1, 5), 7), 9)
    temporary = (s1 << 9) & MASK32
    s2 = (s2 ^ s0) & MASK32
    s3 = (s3 ^ s1) & MASK32
    s1 = (s1 ^ s2) & MASK32
    s0 = (s0 ^ s3) & MASK32
    s2 = (s2 ^ temporary) & MASK32
    s3 = rotl32(s3, 11)
    return result, (s0, s1, s2, s3)


def make_uniform(seed):
    """Returns a nullary function yielding U[0,1) draws, threading state."""
    state = [init_state(seed)]

    def uniform():
        value, state[0] = next_uint32(state[0])
        return value / UINT32_RANGE

    return uniform


# --- Distribution samplers (Phase 3.3 rules) ---------------------------------


def next_standard_normal(uniform):
    # Box-Muller, cosine half only: u1 in (0,1] so log is finite, u2 in
    # [0,1). The sine companion is deliberately discarded (stateless rule).
    u1 = 1 - uniform()
    u2 = uniform()
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def next_gamma(uniform, shape):
    # Marsaglia-Tsang for shape >= 1, log acceptance test used
    # unconditionally. Each attempt: one normal (two uniforms), then one
    # uniform; attempts with (1 + c*x)^3 <= 0 are rejected before their
    # uniform is drawn.
    if shape < 1:
        raise ValueError("shape must be at least 1")
    d = shape - 1 / 3
    c = 1 / math.sqrt(9 * d)
    while True:
        x = next_standard_normal(uniform)
        cube = 1 + c * x
        if cube <= 0:
            continue
        v = cube**3
        u = uniform()
        if u == 0 or math.log(u) < 0.5 * x * x + d - d * v + d * math.log(v):
            return d * v


def next_chi_square(uniform, degrees_of_freedom):
    return 2 * next_gamma(uniform, degrees_of_freedom / 2)


# --- Student's t fit (Phase 3.1/3.2/3.4 rules) --------------------------------


def project_psd(matrix):
    eigenvalues, eigenvectors = np.linalg.eigh(matrix)
    return (eigenvectors * np.maximum(eigenvalues, 0)) @ eigenvectors.T


def nearest_correlation(matrix, tolerance=1e-10, max_iterations=200):
    # Higham (2002) alternating projections with Dykstra's correction.
    current = matrix.copy()
    correction = np.zeros_like(matrix)
    for _ in range(max_iterations):
        shifted = current - correction
        projected = project_psd(shifted)
        correction = projected - shifted
        unit_diagonal = projected.copy()
        np.fill_diagonal(unit_diagonal, 1.0)
        if np.max(np.abs(unit_diagonal - current)) < tolerance:
            return unit_diagonal
        current = unit_diagonal
    raise RuntimeError("nearest-correlation repair did not converge")


def fit_student_t(simple_return_columns, periods_per_year, nu_override=None):
    # Log returns of the Float32-rounded simple returns.
    log_columns = [np.log1p(column) for column in simple_return_columns]
    location = [column.mean() for column in log_columns]
    covariance = np.cov(np.vstack(log_columns), ddof=1)
    covariance = np.atleast_2d(covariance)

    # Pooled standardized residuals -> moment-ratio excess kurtosis -> nu.
    pooled = np.concatenate(
        [
            (column - column.mean()) / column.std(ddof=1)
            for column in log_columns
        ]
    )
    second_moment = (pooled**2).mean()
    fourth_moment = (pooled**4).mean()
    excess_kurtosis = fourth_moment / second_moment**2 - 3
    if nu_override is not None:
        nu = nu_override
    elif excess_kurtosis <= 0:
        nu = 100.0
    else:
        nu = min(100.0, max(5.0, 4 + 6 / excess_kurtosis))

    # Scale conversion, then repair in correlation space preserving scale.
    scale = covariance * (nu - 2) / nu
    standard_deviations = np.sqrt(np.diag(scale))
    correlation = scale / np.outer(standard_deviations, standard_deviations)
    repaired = nearest_correlation(correlation)
    repaired_scale = repaired * np.outer(standard_deviations, standard_deviations)
    cholesky = np.linalg.cholesky(repaired_scale)

    return {
        "location": location,
        "excess_kurtosis": excess_kurtosis,
        "nu": nu,
        "cholesky": cholesky,
    }


def next_scenario_returns(uniform, model):
    # Draw-order contract: z_1..z_D normals in asset order, then one
    # chi-square; l = mu + (L z) * sqrt(nu/chi2); r = expm1(l).
    dimension = len(model["location"])
    normals = [next_standard_normal(uniform) for _ in range(dimension)]
    chi_square = next_chi_square(uniform, model["nu"])
    tail_multiplier = math.sqrt(model["nu"] / chi_square)
    returns = []
    for i in range(dimension):
        correlated = sum(
            model["cholesky"][i][j] * normals[j] for j in range(i + 1)
        )
        returns.append(
            math.expm1(model["location"][i] + correlated * tail_multiplier)
        )
    return returns


# --- Phase 1 portfolio accounting (free-function rules from 1.6) --------------


def allocate_initial_investment(initial_investment, weights):
    return [initial_investment * weight for weight in weights]


def step_portfolio_period(holdings, asset_returns, weights, dca_amount):
    grown = [h * (1 + r) for h, r in zip(holdings, asset_returns)]
    contribution = dca_amount
    final = [h + weight * contribution for h, weight in zip(grown, weights)]
    return final, sum(final)


# --- Reference traces ---------------------------------------------------------


def main():
    print("=== Phase 3.3 sampler reference sequences ===")
    uniform = make_uniform(42)
    print("normals(seed 42):", [next_standard_normal(uniform) for _ in range(4)])
    uniform = make_uniform(7)
    print("gamma(seed 7, shape 2.5):", [next_gamma(uniform, 2.5) for _ in range(3)])
    uniform = make_uniform(123)
    print("chi2(seed 123, dof 5):", [next_chi_square(uniform, 5) for _ in range(3)])

    # The same Float32-rounded two-asset fixture the TypeScript tests use.
    asset_a = np.array(
        [0.02, -0.05, 0.03, 0.01, -0.02, 0.04, -0.01, 0.02], dtype=np.float32
    ).astype(np.float64)
    asset_b = np.array(
        [0.01, -0.03, 0.02, 0.005, -0.01, 0.03, -0.005, 0.015], dtype=np.float32
    ).astype(np.float64)

    print("\n=== Phase 3.4 fit reference (weekly, automatic nu) ===")
    model = fit_student_t([asset_a, asset_b], periods_per_year=52)
    print("location:", model["location"])
    print("pooled excess kurtosis:", model["excess_kurtosis"])
    print("nu:", model["nu"])
    print("cholesky:", model["cholesky"].tolist())
    print("periodInflation(2%):", math.log(1.02) / 52)
    print("periodRiskFree(3%):", 1.03 ** (1 / 52) - 1)
    print("override location(7%):", math.log(1.07) / 52)

    print("\n=== Phase 3.4 engine scenario trace (seed 42) ===")
    uniform = make_uniform(42)
    for period in range(3):
        print(f"period {period + 1}:", next_scenario_returns(uniform, model))

    print("\n=== Phase 3.6 full-chain DCA replay (seed 42) ===")
    # weights 60/40, initial 1000, DCA 100 per period, 4 periods, one path.
    weights = [0.6, 0.4]
    holdings = allocate_initial_investment(1000, weights)
    uniform = make_uniform(42)
    print("period 0 equity:", sum(holdings))
    for period in range(1, 5):
        returns = next_scenario_returns(uniform, model)
        holdings, equity = step_portfolio_period(holdings, returns, weights, 100)
        print(f"period {period}: returns={returns} equity={equity!r}")

    print("\n=== Phase 3.6 full-chain lump-sum replay (seed 7) ===")
    holdings = allocate_initial_investment(1000, weights)
    uniform = make_uniform(7)
    for period in range(1, 5):
        returns = next_scenario_returns(uniform, model)
        holdings, equity = step_portfolio_period(holdings, returns, weights, 0)
        print(f"period {period}: returns={returns} equity={equity!r}")


if __name__ == "__main__":
    main()
