from app import db
from app.models import InsiderTrade, NewsArticle, WatchItem


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
