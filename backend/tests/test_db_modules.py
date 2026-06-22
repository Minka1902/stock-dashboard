from app import db
from app.models import (
    CongressTrade,
    FearGreedSnapshot,
    InsiderTrade,
    NewsArticle,
    TechnicalSignal,
    WatchItem,
    YieldPoint,
)


def _news(url="https://x.com/a", seendate="2026-06-22T12:00:00Z"):
    return NewsArticle(
        url=url, title="t", domain="x.com", seendate=seendate,
        sourcecountry="United States", image="",
    )


def _trade(accession="A1", value=1000.0, filed_at="2026-06-22T09:00:00-04:00"):
    return InsiderTrade(
        accession=accession, ticker="CBL", company="CBL Inc", owner="Jane Doe",
        role="Director", transaction_date="2026-06-18", transaction_type="Buy",
        shares=100.0, value=value, filing_url="https://sec.gov/x", filed_at=filed_at,
    )


def test_news_upsert_dedupes_and_orders_by_date(conn):
    db.upsert_news(conn, [
        _news("https://x.com/a", "2026-06-20T00:00:00Z"),
        _news("https://x.com/b", "2026-06-22T00:00:00Z"),
    ])
    db.upsert_news(conn, [_news("https://x.com/a", "2026-06-20T00:00:00Z")])  # dup url
    rows = db.get_news(conn)
    assert len(rows) == 2
    assert rows[0].url == "https://x.com/b"  # newest first


def test_trades_upsert_idempotent_and_ordered(conn):
    db.upsert_trades(conn, [
        _trade("A1", 500.0, "2026-06-21T09:00:00-04:00"),
        _trade("A2", 999.0, "2026-06-22T09:00:00-04:00"),
    ])
    db.upsert_trades(conn, [_trade("A1", 700.0, "2026-06-21T09:00:00-04:00")])
    rows = db.get_trades(conn)
    assert len(rows) == 2
    assert rows[0].accession == "A2"  # newest filed_at first
    assert next(r for r in rows if r.accession == "A1").value == 700.0  # updated


def test_watchlist_add_remove(conn):
    db.add_watch(conn, WatchItem(ticker="AAPL", note="watching", added_at="2026-06-22T10:00:00Z"))
    db.add_watch(conn, WatchItem(ticker="MSFT", note="", added_at="2026-06-22T11:00:00Z"))
    assert [w.ticker for w in db.get_watchlist(conn)] == ["MSFT", "AAPL"]  # newest first
    db.remove_watch(conn, "AAPL")
    assert [w.ticker for w in db.get_watchlist(conn)] == ["MSFT"]


def test_yield_curve_upsert_and_get(conn):
    points = [
        YieldPoint(date="2026-06-20", yr2=4.85, yr10=4.62, yr30=4.78, spread=-0.23),
        YieldPoint(date="2026-06-19", yr2=4.90, yr10=4.60, yr30=None, spread=-0.30),
    ]
    db.upsert_yield_curve(conn, points)
    rows = db.get_yield_curve(conn, days=365)
    assert len(rows) == 2
    assert rows[0].date == "2026-06-19"  # ascending by date
    assert rows[1].date == "2026-06-20"
    # Upsert should update the spread value.
    db.upsert_yield_curve(conn, [YieldPoint(date="2026-06-20", yr2=4.80, yr10=4.65, yr30=4.78, spread=-0.15)])
    updated = db.get_yield_curve(conn, days=365)
    jun20 = next(r for r in updated if r.date == "2026-06-20")
    assert jun20.spread == -0.15


def test_technical_signals_upsert_replaces(conn):
    sig = TechnicalSignal(
        ticker="AAPL", fetched_at="2026-06-22T10:00:00+00:00",
        price=150.0, change_pct=1.5, ma50=145.0, ma200=140.0,
        golden_cross=True, rsi14=62.5, high_52w=200.0, low_52w=120.0,
        prices_json="[150.0]",
    )
    db.upsert_technical_signals(conn, [sig])
    rows = db.get_technical_signals(conn)
    assert len(rows) == 1
    assert rows[0].golden_cross is True  # bool, not integer

    # Update with new price.
    sig2 = TechnicalSignal(
        ticker="AAPL", fetched_at="2026-06-22T11:00:00+00:00",
        price=155.0, change_pct=3.3, ma50=146.0, ma200=141.0,
        golden_cross=False, rsi14=70.0, high_52w=200.0, low_52w=120.0,
        prices_json="[155.0]",
    )
    db.upsert_technical_signals(conn, [sig2])
    rows = db.get_technical_signals(conn)
    assert len(rows) == 1
    assert rows[0].price == 155.0
    assert rows[0].golden_cross is False


def test_fear_greed_upsert_appends(conn):
    snaps = [
        FearGreedSnapshot(captured_at="2026-06-20T10:00:00+00:00", score=30.0, rating="Fear"),
        FearGreedSnapshot(captured_at="2026-06-21T10:00:00+00:00", score=55.0, rating="Neutral"),
    ]
    db.upsert_fear_greed(conn, snaps)
    rows = db.get_fear_greed(conn, days=365)
    assert len(rows) == 2
    assert rows[0].captured_at < rows[1].captured_at  # ascending

    # Upserting same timestamp updates score.
    db.upsert_fear_greed(conn, [FearGreedSnapshot(
        captured_at="2026-06-20T10:00:00+00:00", score=35.0, rating="Fear"
    )])
    rows = db.get_fear_greed(conn, days=365)
    assert len(rows) == 2
    assert next(r for r in rows if "06-20" in r.captured_at).score == 35.0


def test_congress_trades_upsert_dedupes(conn):
    trade = CongressTrade(
        trade_hash="abc123def456abcd",
        representative="Jane Smith", party="D", state="CA",
        ticker="AAPL", asset_description="Apple Inc.",
        transaction_date="2026-06-01", transaction_type="Purchase",
        amount_range="$15,001 - $50,000", filed_at="2026-06-10", chamber="house",
    )
    db.upsert_congress_trades(conn, [trade, trade])  # same hash twice
    rows = db.get_congress_trades(conn)
    assert len(rows) == 1

    # A second upsert updates amount_range.
    trade2 = CongressTrade(
        trade_hash="abc123def456abcd",
        representative="Jane Smith", party="D", state="CA",
        ticker="AAPL", asset_description="Apple Inc.",
        transaction_date="2026-06-01", transaction_type="Purchase",
        amount_range="$50,001 - $100,000", filed_at="2026-06-11", chamber="house",
    )
    db.upsert_congress_trades(conn, [trade2])
    rows = db.get_congress_trades(conn)
    assert len(rows) == 1
    assert rows[0].amount_range == "$50,001 - $100,000"
