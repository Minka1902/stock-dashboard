"""Unit tests for the boom_score source module."""
import json
import sqlite3

import pytest

from app import db
from app.models import (
    AnalystSignal, BoomScore, CongressTrade, InsiderTrade,
    ShortInterest, SocialSentiment, TechnicalSignal, WatchItem,
)
from app.sources import boom_score as boom_score_source


@pytest.fixture
def score_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.init_schema(conn)
    yield conn
    conn.close()


def _add_ticker(conn, ticker="GME"):
    db.add_watch(conn, WatchItem(ticker=ticker, note="", added_at="2026-06-22T10:00:00+00:00"))


def _add_technical(conn, ticker="GME", golden_cross=False, rsi14=55.0):
    db.upsert_technical_signals(conn, [TechnicalSignal(
        ticker=ticker, fetched_at="2026-06-22T10:00:00+00:00",
        price=100.0, change_pct=1.0, ma50=101.0 if golden_cross else 99.0,
        ma200=100.0, golden_cross=golden_cross, rsi14=rsi14,
        high_52w=150.0, low_52w=80.0, prices_json="[100.0]",
    )])


def _add_insider_buy(conn, ticker="GME", accession="A1", date="2026-06-10"):
    db.upsert_trades(conn, [InsiderTrade(
        accession=accession, ticker=ticker, company="Co", owner="Owner",
        role="Director", transaction_date=date, transaction_type="Buy",
        shares=100.0, value=10000.0, filing_url="https://sec.gov/x",
        filed_at="2026-06-10T10:00:00+00:00",
    )])


def _add_congress_purchase(conn, ticker="GME"):
    db.upsert_congress_trades(conn, [CongressTrade(
        trade_hash="hash001", representative="Rep Smith", party="D",
        state="CA", ticker=ticker, asset_description="Stock",
        transaction_date="2026-06-10", transaction_type="Purchase",
        amount_range="$15,001 - $50,000", filed_at="2026-06-15", chamber="house",
    )])


def _add_short(conn, ticker="GME", squeeze=False, pct=0.10):
    db.upsert_short_interest(conn, [ShortInterest(
        ticker=ticker, fetched_at="2026-06-22T10:00:00+00:00",
        shares_short=1_000_000, short_pct_float=pct, days_to_cover=2.0,
        prior_month_shares=900_000, squeeze_flag=squeeze,
    )])


def _add_social(conn, ticker="GME", rank_change=0):
    db.upsert_social_sentiment(conn, [SocialSentiment(
        ticker=ticker, fetched_at="2026-06-22T10:00:00+00:00",
        mentions=500, upvotes=200, rank=5, rank_24h_ago=5 + rank_change,
        rank_change=rank_change,
    )])


def _add_analyst(conn, ticker="GME", upgrades=0):
    db.upsert_analyst_signals(conn, [AnalystSignal(
        ticker=ticker, fetched_at="2026-06-22T10:00:00+00:00",
        next_earnings="2026-07-30", rec_strong_buy=5, rec_buy=10,
        rec_hold=3, rec_sell=1, recent_upgrades=upgrades, recent_downgrades=0,
        latest_action="up" if upgrades > 0 else None, latest_firm="GS", latest_to_grade="Buy",
    )])


def test_zero_score_no_signals(score_conn):
    _add_ticker(score_conn)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert len(scores) == 1
    assert scores[0].score == 0
    assert scores[0].golden_cross is False
    assert json.loads(scores[0].components) == {}


def test_golden_cross_adds_20(score_conn):
    _add_ticker(score_conn)
    _add_technical(score_conn, golden_cross=True, rsi14=60.0)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].golden_cross is True
    assert scores[0].score >= 20
    assert "golden_cross" in json.loads(scores[0].components)


def test_rsi_recovery_zone_adds_10(score_conn):
    _add_ticker(score_conn)
    _add_technical(score_conn, golden_cross=False, rsi14=40.0)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].rsi_recovery is True
    assert scores[0].score >= 10


def test_rsi_outside_zone_does_not_fire(score_conn):
    _add_ticker(score_conn)
    _add_technical(score_conn, golden_cross=False, rsi14=55.0)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].rsi_recovery is False


def test_insider_cluster_two_buys_adds_20(score_conn):
    _add_ticker(score_conn)
    _add_insider_buy(score_conn, accession="A1", date="2026-06-10")
    _add_insider_buy(score_conn, accession="A2", date="2026-06-11")
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].insider_cluster_buy is True
    assert scores[0].score >= 20


def test_insider_cluster_one_buy_does_not_fire(score_conn):
    _add_ticker(score_conn)
    _add_insider_buy(score_conn, accession="A1", date="2026-06-10")
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].insider_cluster_buy is False


def test_congress_buy_adds_15(score_conn):
    _add_ticker(score_conn)
    _add_congress_purchase(score_conn)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].congress_buy is True
    assert scores[0].score >= 15


def test_short_squeeze_adds_10(score_conn):
    _add_ticker(score_conn)
    _add_short(score_conn, squeeze=True, pct=0.25)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].short_squeeze is True
    assert scores[0].score >= 10


def test_wsb_rising_rank_change_gte5_adds_10(score_conn):
    _add_ticker(score_conn)
    _add_social(score_conn, rank_change=5)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].wsb_rising is True
    assert scores[0].score >= 10


def test_wsb_rising_rank_change_lt5_does_not_fire(score_conn):
    _add_ticker(score_conn)
    _add_social(score_conn, rank_change=4)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].wsb_rising is False


def test_analyst_upgrade_adds_15(score_conn):
    _add_ticker(score_conn)
    _add_analyst(score_conn, upgrades=2)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].analyst_upgrade is True
    assert scores[0].score >= 15


def test_max_score_all_signals(score_conn):
    _add_ticker(score_conn)
    _add_technical(score_conn, golden_cross=True, rsi14=40.0)
    _add_insider_buy(score_conn, accession="A1")
    _add_insider_buy(score_conn, accession="A2")
    _add_congress_purchase(score_conn)
    _add_short(score_conn, squeeze=True, pct=0.25)
    _add_social(score_conn, rank_change=10)
    _add_analyst(score_conn, upgrades=3)
    scores = boom_score_source.compute_all(["GME"], score_conn)
    assert scores[0].score == 100  # 20+20+15+15+10+10+10


def test_compute_all_empty_tickers(score_conn):
    assert boom_score_source.compute_all([], score_conn) == []


def test_compute_all_multiple_tickers(score_conn):
    _add_ticker(score_conn, "GME")
    _add_ticker(score_conn, "AAPL")
    _add_technical(score_conn, "GME", golden_cross=True, rsi14=60.0)
    scores = boom_score_source.compute_all(["GME", "AAPL"], score_conn)
    assert len(scores) == 2
    gme_score = next(s for s in scores if s.ticker == "GME")
    aapl_score = next(s for s in scores if s.ticker == "AAPL")
    assert gme_score.score > aapl_score.score
