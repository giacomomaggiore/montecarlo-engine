"""Phase 1.6 independent cross-check.

This script is NOT part of the shipped pipeline (it does not touch data/*.csv
or produce a browser artifact) and is not run by CI. It exists purely as an
audit trail: an implementation of the PRNG and the portfolio accounting rules,
written from scratch in a second language from the README's prose description
only (not by reading the TypeScript source line-by-line), used once to produce
independent "ground truth" numbers. Those numbers are then pasted as expected
values into src/core/simulation/independentCheck.test.ts, so the TypeScript
engine is checked against a second, independently-derived implementation
instead of only against its own author's hand arithmetic.

Run with: python3 validation/phase_1_6_independent_check.py
"""

import struct

MASK32 = 0xFFFFFFFF
UINT32_RANGE = 1 << 32


def f32(value):
    # The shipped dataset stores returns as Float32 ("a transport format, not
    # the accounting precision" per the README). Round-tripping every literal
    # through the same 32-bit format before using it in float64 arithmetic
    # reproduces exactly what JavaScript reads out of a Float32Array element,
    # instead of comparing against an unrounded float64 literal.
    return struct.unpack("f", struct.pack("f", value))[0]


# --- xoshiro128** PRNG -------------------------------------------------------
# Reimplemented from the README/LOG description of src/core/math/random.ts:
# SplitMix32-style seed expansion (add the golden-gamma constant, then two
# MurmurHash3 finalizer mixes), then the standard xoshiro128** scrambler.
# All arithmetic is masked to 32 bits after every step, mirroring JavaScript's
# `>>> 0`, so this reproduces the exact same bit pattern as the TS generator.


def imul32(a, b):
    # Math.imul multiplies two 32-bit integers and keeps only the low 32 bits.
    # Two's-complement multiplication and unsigned multiplication share the
    # same low-order bits (they differ only by multiples of 2**32), so a plain
    # unsigned multiply-and-mask reproduces Math.imul's result bit-for-bit.
    return (a * b) & MASK32


def rotl32(value, bits):
    return ((value << bits) & MASK32) | (value >> (32 - bits))


def expand_seed(seed):
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
    return state


def init_state(seed):
    if not (0 <= seed <= MASK32):
        raise ValueError("seed must be an unsigned 32-bit integer")
    return expand_seed(seed)


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


def next_int(state, upper_exclusive):
    # Rejection sampling before the modulo: without it, historical rows
    # whose index falls in the "leftover" part of the 2**32 range would be
    # drawn very slightly more often than rows that divide evenly into it.
    accepted_range = (UINT32_RANGE // upper_exclusive) * upper_exclusive
    value, state = next_uint32(state)
    while value >= accepted_range:
        value, state = next_uint32(state)
    return value % upper_exclusive, state


# --- Portfolio accounting ----------------------------------------------------
# Reimplemented from the README's Portfolio Logic section and the per-period
# operation order, independently of src/core/portfolio/cashFlows.ts.


def allocate_initial_investment(initial_investment, weights):
    return [initial_investment * w for w in weights]


def apply_period_return(holdings, asset_returns):
    return [h * (1 + r) for h, r in zip(holdings, asset_returns)]


def compute_scheduled_contribution(cash_flow, period_index, initial_investment, pre_contribution_equity):
    mode = cash_flow["mode"]
    if mode == "lumpSum":
        return 0.0
    if mode == "dca":
        return cash_flow["amount"]
    if mode == "valueAveraging":
        target_value = initial_investment + period_index * cash_flow["targetIncrease"]
        return max(0.0, target_value - pre_contribution_equity)
    raise ValueError(f"unknown cash flow mode: {mode}")


def invest_contribution(holdings, weights, contribution):
    return [h + w * contribution for h, w in zip(holdings, weights)]


def step_portfolio_period(holdings, asset_returns, cash_flow, weights, period_index, initial_investment):
    start_equity = sum(holdings)

    grown = apply_period_return(holdings, asset_returns)
    pre_contribution_equity = sum(grown)

    contribution = compute_scheduled_contribution(
        cash_flow, period_index, initial_investment, pre_contribution_equity
    )
    final_holdings = invest_contribution(grown, weights, contribution)

    return {
        "holdings": final_holdings,
        "contribution": contribution,
        "equity": sum(final_holdings),
        "neutralReturn": pre_contribution_equity / start_equity - 1,
    }


# --- Fixture ------------------------------------------------------------------
# Small, distinctive-by-row dataset so a wrong row draw cannot accidentally
# produce the right numbers. Six rows keeps next_int(6)'s rejection sampling
# and modulo exercised without a large table to eyeball.

ASSET_A_RETURNS = [f32(v) for v in [0.05, -0.03, 0.02, 0.10, -0.07, 0.01]]
ASSET_B_RETURNS = [f32(v) for v in [-0.02, 0.04, 0.01, -0.05, 0.03, 0.02]]
ROW_COUNT = len(ASSET_A_RETURNS)
WEIGHTS = [0.6, 0.4]
INITIAL_INVESTMENT = 1000.0
PERIODS = 4


def run_case(label, seed, cash_flow):
    state = init_state(seed)
    holdings = allocate_initial_investment(INITIAL_INVESTMENT, WEIGHTS)

    print(f"\n=== {label} (seed={seed}) ===")
    print(f"period 0: holdings={fmt(holdings)} equity={sum(holdings):.6f}")

    for period_index in range(1, PERIODS + 1):
        row, state = next_int(state, ROW_COUNT)
        asset_returns = [ASSET_A_RETURNS[row], ASSET_B_RETURNS[row]]

        result = step_portfolio_period(
            holdings, asset_returns, cash_flow, WEIGHTS, period_index, INITIAL_INVESTMENT
        )
        holdings = result["holdings"]

        print(
            f"period {period_index}: row={row} returns={fmt(asset_returns)} "
            f"contribution={result['contribution']!r} "
            f"neutralReturn={result['neutralReturn']!r} "
            f"holdings={fmt(holdings)} equity={result['equity']!r}"
        )


def fmt(values):
    return "[" + ", ".join(f"{v!r}" for v in values) + "]"


if __name__ == "__main__":
    run_case("lump sum", seed=42, cash_flow={"mode": "lumpSum"})
    run_case("DCA (amount=100)", seed=7, cash_flow={"mode": "dca", "amount": 100.0})
    run_case(
        "value averaging (targetIncrease=80)",
        seed=123,
        cash_flow={"mode": "valueAveraging", "targetIncrease": 80.0},
    )
