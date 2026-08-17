"""Procedural Phase 8 reference trace for a one-asset margin call.

The trace follows the README formulas without importing application code:
open at 2x, apply a 20% asset loss, then sell proportionally until the
post-sale gross leverage returns to 2x. It is a compact audit aid for the
matching TypeScript runner test.
"""


def main():
    investor_equity = 1000.0
    target_leverage = 2.0
    gross_assets = investor_equity * target_leverage
    debt = gross_assets - investor_equity

    # Asset return changes gross assets; debt is unchanged when rates/spread are zero.
    gross_assets *= 0.8
    equity = gross_assets - debt

    # With frictionless proportional sales, equity stays constant because every
    # sale dollar reduces both gross assets and debt by the same dollar.
    target_gross_assets = target_leverage * equity
    sale = gross_assets - target_gross_assets
    gross_assets -= sale
    debt -= sale

    print(f"gross_assets={gross_assets:.12f}")
    print(f"debt={debt:.12f}")
    print(f"equity={gross_assets - debt:.12f}")
    print(f"gross_leverage={gross_assets / (gross_assets - debt):.12f}")


if __name__ == '__main__':
    main()