"""Tests for the suggestion engine + renderers."""
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from app import db
from app.models import (
    BoomScore, Holding, Seasonality, TechnicalSignal, WatchItem,
)
from app import suggestions


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_schema(c)
    yield c
    c.close()


def _boom(ticker, score, **flags):
    base = dict(
        golden_cross=False, rsi_recovery=False, insider_cluster_buy=False,
        congress_buy=False, short_squeeze=False, wsb_rising=False, analyst_upgrade=False,
    )
    base.update(flags)
    return BoomScore(ticker=ticker, computed_at="2026-06-28T00:00:00+00:00",
                     score=score, components="{}", **base)


def _seed_seasonality(conn, ticker, returns):
    windows = [{"key": "fwd_week", "label": "Next Week", "kind": "forward",
                "per_year": [{"year": 2016 + i, "return": r} for i, r in enumerate(returns)]}]
    db.upsert_seasonality(conn, [Seasonality(
        ticker=ticker, computed_at="2026-06-28T00:00:00+00:00",
        as_of="06-29", history_years=len(returns), windows_json=json.dumps(windows),
    )])


def _setup(conn):
    for t in ("AAPL", "PLTR", "NVDA"):
        db.add_watch(conn, WatchItem(ticker=t, note="", added_at="2026-06-28T00:00:00+00:00"))
    # Hold AAPL, bought at 100.
    db.upsert_holding(conn, Holding(ticker="AAPL", shares=10, avg_cost=100.0,
                                    added_at="2026-06-28T00:00:00+00:00"))
    # AAPL bearish (overbought), PLTR strong bullish, NVDA mild.
    db.upsert_boom_scores(conn, [
        _boom("AAPL", -10, overbought_rsi=True),
        _boom("PLTR", 78, golden_cross=True, near_52w_high=True),
        _boom("NVDA", 30, macd_crossover=True),
    ])
    db.upsert_technical_signals(conn, [TechnicalSignal(
        ticker="AAPL", fetched_at="2026-06-28T00:00:00+00:00", price=130.0,
        change_pct=1.0, ma50=120.0, ma200=110.0, golden_cross=True, rsi14=75.0,
        high_52w=135.0, low_52w=90.0, prices_json="[130.0]",
    )])
    _seed_seasonality(conn, "PLTR", [0.05] * 8)   # strong tailwind
    _seed_seasonality(conn, "AAPL", [0.001] * 8)  # neutral


def test_holdings_alert_trim_on_bearish_with_gain(conn):
    _setup(conn)
    d = suggestions.build_digest(conn, "2026-06-29")
    aapl = next(a for a in d["holdings_alerts"] if a["ticker"] == "AAPL")
    assert aapl["pl_pct"] == 30.0
    assert "Trim" in aapl["action"]
    assert "overbought RSI" in aapl["reasons"]


def test_opportunities_exclude_held_and_rank_by_score(conn):
    _setup(conn)
    d = suggestions.build_digest(conn, "2026-06-29")
    tickers = [o["ticker"] for o in d["opportunities"]]
    assert "AAPL" not in tickers          # held → not an "opportunity"
    assert tickers[0] == "PLTR"           # highest Boom Score first
    pltr = d["opportunities"][0]
    assert "golden cross" in pltr["signals"]


def test_seasonality_tailwind_flagged(conn):
    _setup(conn)
    d = suggestions.build_digest(conn, "2026-06-29")
    pltr = next((s for s in d["seasonality"] if s["ticker"] == "PLTR"), None)
    assert pltr is not None
    assert pltr["kind"] == "tailwind"
    assert pltr["avg_pct"] == 5.0
    assert pltr["win_rate"] == 1.0


def test_market_context_present(conn):
    _setup(conn)
    d = suggestions.build_digest(conn, "2026-06-29")
    assert d["market_context"]["summary"].startswith("Market:")
    assert d["disclaimer"]


def test_earnings_soon_drives_action(conn):
    _setup(conn)
    from app.models import AnalystSignal
    soon = (datetime.now(timezone.utc).date() + timedelta(days=3)).isoformat()
    db.upsert_analyst_signals(conn, [AnalystSignal(
        ticker="AAPL", fetched_at="2026-06-28T00:00:00+00:00", next_earnings=soon,
        rec_strong_buy=1, rec_buy=1, rec_hold=1, rec_sell=0,
        recent_upgrades=0, recent_downgrades=0, latest_action=None,
        latest_firm=None, latest_to_grade=None,
    )])
    # for_date = today so "in 3d" lands inside the 7-day window.
    today = datetime.now(timezone.utc).date().isoformat()
    d = suggestions.build_digest(conn, today)
    aapl = next(a for a in d["holdings_alerts"] if a["ticker"] == "AAPL")
    assert "Earnings" in aapl["action"]
    assert any("earnings in" in r for r in aapl["reasons"])


def test_render_email_and_sms(conn):
    _setup(conn)
    d = suggestions.build_digest(conn, "2026-06-29")
    subject, text, html = suggestions.render_email(d)
    assert "2026-06-29" in subject
    assert "PLTR" in text
    assert "<html" not in html  # body fragment only; smtp wrapper adds <html>
    sms = suggestions.render_sms(d)
    assert len(sms) <= 320
    assert "app" in sms.lower()


def test_empty_state_builds_without_error(conn):
    d = suggestions.build_digest(conn, "2026-06-29")
    assert d["holdings_alerts"] == []
    assert d["opportunities"] == []
    assert d["seasonality"] == []
