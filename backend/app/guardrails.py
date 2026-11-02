"""Server-side order guardrails (STC-50), run inside execution.submit for
every order — paper tickets and bot fills alike. Per-user limits live in
risk_settings with safe defaults; notional limits are in the user's base
currency. A limit that can't be checked (no FX rate) refuses the order rather
than waving it through.
"""
from datetime import datetime

from app import currency, db, execution
from app.models import Order


def _price(o: Order) -> float | None:
    return o.fill_price or o.limit_price or o.stop_price or o.reference_price


def _in_base(conn, user_id: int, amount: float, ccy: str) -> float | None:
    base = db.get_notify_profile(conn, user_id).base_currency
    rate = currency.fx_rate(ccy, base)
    return amount * rate if rate is not None else None


def kill_switch(conn, o: Order, now: datetime) -> str | None:
    s = db.get_risk_settings(conn, o.user_id)
    if s.trading_halted_at:
        return f"trading is halted by your kill switch (since {s.trading_halted_at[:16].replace('T', ' ')} UTC)"
    return None


def market_hours(conn, o: Order, now: datetime) -> str | None:
    if db.get_risk_settings(conn, o.user_id).allow_outside_hours or execution._is_live(o.ticker, now):
        return None
    return (f"{o.ticker}'s market isn't open — orders outside regular hours are off "
            f"(turn on 'allow outside hours' on the Risk tab to queue them)")


def order_notional(conn, o: Order, now: datetime) -> str | None:
    s = db.get_risk_settings(conn, o.user_id)
    px = _price(o)
    if px is None:
        return "no price to check the order size against your limit"
    value = _in_base(conn, o.user_id, o.qty * px, o.currency)
    if value is None:
        return f"no {o.currency} exchange rate to check the order size against your limit"
    if value > s.max_order_notional:
        return f"order is {value:,.0f} in your base currency; the limit per order is {s.max_order_notional:,.0f}"
    return None


def daily_limits(conn, o: Order, now: datetime) -> str | None:
    s = db.get_risk_settings(conn, o.user_id)
    today = db.orders_today(conn, o.user_id, now.date().isoformat())
    if len(today) >= s.max_orders_per_day:
        return f"{len(today)} orders today; the daily limit is {s.max_orders_per_day}"
    total = 0.0
    for x in [*today, o]:
        px = _price(x)
        value = _in_base(conn, o.user_id, x.qty * px, x.currency) if px else None
        if value is None:
            return f"no price or {x.currency} rate to check today's total against your limit"
        total += value
    if total > s.max_notional_per_day:
        return f"today's orders would total {total:,.0f}; the daily limit is {s.max_notional_per_day:,.0f}"
    return None


def position_size(conn, o: Order, now: datetime) -> str | None:
    if o.side != "BUY":
        return None
    s = db.get_risk_settings(conn, o.user_id)
    px = _price(o) or 0.0
    holdings = [h for h in db.get_portfolio(conn, o.user_id, o.account) if h.currency == o.currency]
    equity = sum(c.balance for c in db.get_cash(conn, o.user_id, o.account) if c.currency == o.currency) \
        + sum(h.shares * h.avg_cost for h in holdings)
    if equity <= 0:
        return None   # nothing to measure against; the ledger refuses an unfunded buy anyway
    held = next((h.shares * h.avg_cost for h in holdings if h.ticker == o.ticker), 0.0)
    pct = (held + o.qty * px) / equity * 100
    if pct > s.max_position_pct:
        return f"{o.ticker} would be {pct:.0f}% of the account; the limit per position is {s.max_position_pct:g}%"
    return None


ALL = (kill_switch, market_hours, order_notional, daily_limits, position_size)
execution.CHECKS[:] = list(ALL)
