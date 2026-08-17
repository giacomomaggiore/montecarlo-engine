"""Independent Phase 7 cost and tax trace derived from README.md's rules."""

import json


FIXED_COST = 2.0
PROPORTIONAL_COST = 0.01
TAX_RATE = 0.20
WEIGHTS = [0.5, 0.5]
CONTRIBUTION = 105.0


def price_trades(trades):
    priced = []
    for asset_index, value in trades:
        if value == 0:
            continue
        fee = FIXED_COST + PROPORTIONAL_COST * abs(value)
        priced.append((asset_index, value, fee))
    return priced


def apply_buys(bases, trades):
    next_bases = list(bases)
    for asset_index, value, fee in trades:
        if value > 0:
            next_bases[asset_index] += value + fee
    return next_bases


def apply_sales(holdings, bases, carryforward, trades):
    next_holdings = list(holdings)
    next_bases = list(bases)
    total_gain_loss = 0.0
    tax_paid = 0.0
    for asset_index, value, fee in trades:
        if value >= 0:
            continue
        gross_sale = -value
        disposed_basis = next_bases[asset_index] * gross_sale / next_holdings[asset_index]
        gain_loss = gross_sale - fee - disposed_basis
        next_holdings[asset_index] -= gross_sale
        next_bases[asset_index] -= disposed_basis
        total_gain_loss += gain_loss
        if gain_loss < 0:
            carryforward += -gain_loss
        else:
            carry_used = min(carryforward, gain_loss)
            carryforward -= carry_used
            tax_paid += (gain_loss - carry_used) * TAX_RATE
    return next_holdings, next_bases, carryforward, total_gain_loss, tax_paid


def execute_period(holdings, bases, carryforward, asset_returns):
    grown = [holding * (1 + asset_return) for holding, asset_return in zip(holdings, asset_returns)]

    # Gross DCA cash pays both asset purchases and their nonzero-order costs.
    gross_buys = (CONTRIBUTION - len(WEIGHTS) * FIXED_COST) / (1 + PROPORTIONAL_COST)
    contribution_trades = price_trades(
        [(asset_index, gross_buys * weight) for asset_index, weight in enumerate(WEIGHTS)]
    )
    after_contribution = [
        holding + contribution_trades[asset_index][1]
        for asset_index, holding in enumerate(grown)
    ]
    next_bases = apply_buys(bases, contribution_trades)

    equity = sum(after_contribution)
    intended = [
        (asset_index, equity * weight - holding)
        for asset_index, (weight, holding) in enumerate(zip(WEIGHTS, after_contribution))
    ]
    sales = price_trades([(asset_index, value) for asset_index, value in intended if value < 0])
    after_sales, next_bases, carryforward, gain_loss, tax_paid = apply_sales(
        after_contribution, next_bases, carryforward, sales
    )
    available_proceeds = (
        sum(-value for _, value, _ in sales) - sum(fee for _, _, fee in sales) - tax_paid
    )
    buy_intent = [(asset_index, value) for asset_index, value in intended if value > 0]
    if buy_intent:
        affordable_buys = (available_proceeds - len(buy_intent) * FIXED_COST) / (1 + PROPORTIONAL_COST)
        intended_buys = sum(value for _, value in buy_intent)
        scale = min(1.0, affordable_buys / intended_buys)
        buys = price_trades([(asset_index, value * scale) for asset_index, value in buy_intent])
    else:
        buys = []
    final_holdings = list(after_sales)
    for asset_index, value, _ in buys:
        final_holdings[asset_index] += value
    next_bases = apply_buys(next_bases, buys)
    total_fees = sum(fee for _, _, fee in contribution_trades + sales + buys)
    return {
        "holdings": final_holdings,
        "bases": next_bases,
        "carryforward": carryforward,
        "fees": total_fees,
        "gain_loss": gain_loss,
        "tax_paid": tax_paid,
        "contribution": CONTRIBUTION,
    }


def liquidate(holdings, bases, carryforward):
    sales = price_trades([(asset_index, -holding) for asset_index, holding in enumerate(holdings)])
    _, next_bases, carryforward, gain_loss, tax_paid = apply_sales(
        holdings, bases, carryforward, sales
    )
    terminal_wealth = sum(-value for _, value, _ in sales) - sum(fee for _, _, fee in sales) - tax_paid
    return {
        "terminal_wealth": terminal_wealth,
        "bases": next_bases,
        "carryforward": carryforward,
        "fees": sum(fee for _, _, fee in sales),
        "gain_loss": gain_loss,
        "tax_paid": tax_paid,
    }


def main():
    holdings = [500.0, 500.0]
    bases = [500.0, 500.0]
    carryforward = 0.0
    trace = []
    for asset_returns in ([0.20, -0.20], [-0.10, 0.10]):
        period = execute_period(holdings, bases, carryforward, asset_returns)
        trace.append(period)
        holdings = period["holdings"]
        bases = period["bases"]
        carryforward = period["carryforward"]
    print(json.dumps({"periods": trace, "liquidation": liquidate(holdings, bases, carryforward)}, indent=2))


if __name__ == "__main__":
    main()