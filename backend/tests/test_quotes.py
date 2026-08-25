"""Unit tests for the live quotes module (parser, state mapping, TTL cache)."""
import pytest

from app import quotes
from app.models import LiveQuote

FETCHED = "2026-07-04T12:00:00+00:00"


def _payload(meta=None, closes=None):
    return {
        "chart": {
            "result": [
                {
                    "meta": meta or {},
                    "indicators": {"quote": [{"close": closes if closes is not None else []}]},
                }
            ]
        }
    }


@pytest.fixture(autouse=True)
def clear_cache():
    quotes._cache.clear()
    yield
    quotes._cache.clear()


# ---- parse_quote ----

def test_parse_quote_premarket_uses_last_close():
    payload = _payload(
        meta={"regularMarketPrice": 100.0, "chartPreviousClose": 98.0, "marketState": "PRE"},
        closes=[97.5, 101.5, None],
    )
    q = quotes.parse_quote(payload, "aapl", FETCHED)
    assert q.ticker == "AAPL"
    assert q.price == 101.5
    assert q.market_state == "PRE"
    assert q.previous_close == 98.0
    assert q.change_pct == round((101.5 - 98.0) / 98.0 * 100, 2)
    assert q.fetched_at == FETCHED


def test_parse_quote_premarket_sets_extended_change_and_regular_price():
    payload = _payload(
        meta={"regularMarketPrice": 100.0, "chartPreviousClose": 98.0, "marketState": "PRE"},
        closes=[97.5, 101.5, None],
    )
    q = quotes.parse_quote(payload, "AAPL", FETCHED)
    assert q.regular_price == 100.0
    # PRE: extended move is vs the previous session close (same as change_pct here)
    assert q.extended_change_pct == round((101.5 - 98.0) / 98.0 * 100, 2)


def test_parse_quote_afterhours_extended_change_vs_regular_close():
    payload = _payload(
        meta={"regularMarketPrice": 100.0, "chartPreviousClose": 98.0, "marketState": "POST"},
        closes=[100.0, 102.0],
    )
    q = quotes.parse_quote(payload, "AAPL", FETCHED)
    assert q.regular_price == 100.0
    # POST: extended move is vs today's regular close
    assert q.extended_change_pct == round((102.0 - 100.0) / 100.0 * 100, 2)
    # change_pct is still measured vs previous session close
    assert q.change_pct == round((102.0 - 98.0) / 98.0 * 100, 2)


def test_parse_quote_live_has_no_extended_change():
    payload = _payload(
        meta={"regularMarketPrice": 100.0, "chartPreviousClose": 98.0, "marketState": "REGULAR"},
        closes=[99.0, 100.5],
    )
    q = quotes.parse_quote(payload, "AAPL", FETCHED)
    assert q.extended_change_pct is None
    assert q.regular_price == 100.0


def test_parse_quote_all_none_closes_falls_back_to_regular_market_price():
    payload = _payload(
        meta={"regularMarketPrice": 100.0, "chartPreviousClose": 98.0, "marketState": "REGULAR"},
        closes=[None, None],
    )
    q = quotes.parse_quote(payload, "AAPL", FETCHED)
    assert q.price == 100.0
    assert q.market_state == "LIVE"


def test_parse_quote_missing_meta():
    payload = _payload(closes=[100.0, 102.0])
    q = quotes.parse_quote(payload, "AAPL", FETCHED)
    assert q.price == 102.0
    assert q.change_pct is None
    assert q.previous_close is None
    assert q.market_state == "CLOSED"


def test_parse_quote_previous_close_fallback():
    payload = _payload(meta={"previousClose": 50.0}, closes=[51.0])
    q = quotes.parse_quote(payload, "AAPL", FETCHED)
    assert q.previous_close == 50.0
    assert q.change_pct == 2.0


def test_parse_quote_zero_previous_close_gives_no_change():
    payload = _payload(meta={"chartPreviousClose": 0}, closes=[51.0])
    q = quotes.parse_quote(payload, "AAPL", FETCHED)
    assert q.change_pct is None


def test_parse_quote_empty_or_priceless_returns_none():
    assert quotes.parse_quote({}, "AAPL", FETCHED) is None
    assert quotes.parse_quote({"chart": {"result": []}}, "AAPL", FETCHED) is None
    assert quotes.parse_quote(_payload(), "AAPL", FETCHED) is None  # no closes, no meta price
    assert quotes.parse_quote(
        _payload(meta={"regularMarketPrice": "n/a"}, closes=[None]), "AAPL", FETCHED
    ) is None


# ---- normalize_market_state ----

@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("PRE", "PRE"),
        ("REGULAR", "LIVE"),
        ("POST", "POST"),
        ("PREPRE", "CLOSED"),
        ("POSTPOST", "CLOSED"),
        ("CLOSED", "CLOSED"),
        ("regular", "LIVE"),
        (None, "CLOSED"),
        ("", "CLOSED"),
    ],
)
def test_normalize_market_state(raw, expected):
    assert quotes.normalize_market_state(raw) == expected


# ---- TTL cache ----

def _stub_quote(ticker):
    return LiveQuote(
        ticker=ticker, price=100.0, change_pct=1.0, previous_close=99.0,
        market_state="LIVE", fetched_at=FETCHED,
    )


def test_get_quotes_caches_within_ttl(monkeypatch):
    calls = []

    def counting_fetch(tickers):
        calls.append(list(tickers))
        return [_stub_quote(t) for t in tickers]

    monkeypatch.setattr(quotes, "fetch_quotes", counting_fetch)
    first = quotes.get_quotes(["AAPL"])
    second = quotes.get_quotes(["AAPL"])
    assert len(calls) == 1
    assert first == second
    assert first[0].ticker == "AAPL"


def test_get_quotes_negative_caches_failed_ticker(monkeypatch):
    calls = []

    def failing_fetch(tickers):
        calls.append(list(tickers))
        return []

    monkeypatch.setattr(quotes, "fetch_quotes", failing_fetch)
    assert quotes.get_quotes(["BAD"]) == []
    assert quotes.get_quotes(["BAD"]) == []
    assert len(calls) == 1


def test_get_quotes_fetches_only_missing(monkeypatch):
    calls = []

    def counting_fetch(tickers):
        calls.append(list(tickers))
        return [_stub_quote(t) for t in tickers]

    monkeypatch.setattr(quotes, "fetch_quotes", counting_fetch)
    quotes.get_quotes(["AAPL"])
    result = quotes.get_quotes(["AAPL", "MSFT"])
    assert calls == [["AAPL"], ["MSFT"]]
    assert [q.ticker for q in result] == ["AAPL", "MSFT"]


# ---------- FX pairs ----------

def test_is_fx_recognises_yahoo_pair_suffix():
    assert quotes.is_fx("EURUSD=X")
    assert quotes.is_fx("usdils=x")
    assert not quotes.is_fx("AAPL")
    assert not quotes.is_fx("BRK.B")


def test_fx_label_splits_a_six_letter_pair():
    assert quotes.fx_label("USDILS=X") == "USD/ILS"
    assert quotes.fx_label("EURUSD=X") == "EUR/USD"


def test_fx_label_falls_back_for_odd_symbols():
    """Yahoo also carries shapes like "ILS=X"; better a raw symbol than a
    mangled slash."""
    assert quotes.fx_label("ILS=X") == "ILS=X"


def test_decorate_fx_tags_only_currency_quotes():
    made = [
        LiveQuote(ticker="AAPL", price=1.0, change_pct=None, previous_close=None,
                  market_state="LIVE", fetched_at="t"),
        LiveQuote(ticker="EURUSD=X", price=1.09, change_pct=None, previous_close=None,
                  market_state="LIVE", fetched_at="t"),
    ]
    out = quotes.decorate_fx(made)
    assert (out[0].kind, out[0].label) == ("equity", "")
    assert (out[1].kind, out[1].label) == ("fx", "EUR/USD")


def test_get_quotes_preserves_requested_order(monkeypatch):
    """Position in the carousel must not depend on which quotes were cached."""
    quotes._cache.clear()
    monkeypatch.setattr(quotes, "fetch_quotes", lambda ts: [
        LiveQuote(ticker=t, price=1.0, change_pct=None, previous_close=None,
                  market_state="LIVE", fetched_at=FETCHED)
        for t in ts
    ])
    asked = ["ZZZ", "AAA", "MMM"]
    assert [q.ticker for q in quotes.get_quotes(asked, ttl_seconds=60)] == asked
    # Second call is served from cache — same order, not alphabetical.
    assert [q.ticker for q in quotes.get_quotes(asked, ttl_seconds=60)] == asked
