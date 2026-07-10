"""Portfolio merge-on-add and edit/replace behavior (Task 2)."""
from app import db
from app.models import Holding


def _add(conn, ticker, shares, avg_cost, added_at):
    db.upsert_holding(conn, 1, Holding(
        ticker=ticker, shares=shares, avg_cost=avg_cost, added_at=added_at))


def test_upsert_holding_merges_shares_and_weighted_cost(conn):
    _add(conn, "AAPL", 10, 100.0, "2026-01-01T00:00:00+00:00")
    _add(conn, "AAPL", 10, 200.0, "2026-02-02T00:00:00+00:00")

    held = {h.ticker: h for h in db.get_portfolio(conn, 1)}
    aapl = held["AAPL"]
    assert aapl.shares == 20
    assert aapl.avg_cost == 150.0
    # first-buy date preserved
    assert aapl.added_at == "2026-01-01T00:00:00+00:00"


def test_upsert_holding_weighted_average_uneven(conn):
    _add(conn, "MSFT", 5, 100.0, "2026-01-01T00:00:00+00:00")
    _add(conn, "MSFT", 15, 300.0, "2026-01-05T00:00:00+00:00")
    msft = {h.ticker: h for h in db.get_portfolio(conn, 1)}["MSFT"]
    assert msft.shares == 20
    # (5*100 + 15*300) / 20 = 250
    assert msft.avg_cost == 250.0


def test_replace_holding_overwrites(conn):
    _add(conn, "NVDA", 10, 100.0, "2026-01-01T00:00:00+00:00")
    db.replace_holding(conn, 1, "NVDA", 3, 500.0)
    nvda = {h.ticker: h for h in db.get_portfolio(conn, 1)}["NVDA"]
    assert nvda.shares == 3
    assert nvda.avg_cost == 500.0
    # added_at untouched
    assert nvda.added_at == "2026-01-01T00:00:00+00:00"
