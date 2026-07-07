"""Yahoo search parsing + caching."""
from app import search

PAYLOAD = {
    "quotes": [
        {"symbol": "MSFT", "longname": "Microsoft Corporation", "shortname": "Microsoft",
         "exchDisp": "NASDAQ", "quoteType": "EQUITY"},
        {"symbol": "msft.mx", "shortname": "Microsoft (Mexico)", "exchange": "MEX",
         "quoteType": "EQUITY"},
        {"symbol": "MSFT230C", "shortname": "some option", "quoteType": "OPTION"},
        {"symbol": "", "shortname": "broken row", "quoteType": "EQUITY"},
        {"symbol": "SPY", "shortname": "SPDR S&P 500", "exchDisp": "NYSEArca",
         "quoteType": "ETF"},
        {"symbol": "^GSPC", "shortname": "S&P 500", "quoteType": "INDEX"},
        {"symbol": "BTC-USD", "shortname": "Bitcoin", "quoteType": "CRYPTOCURRENCY"},
    ]
}


def test_parse_results_filters_and_shapes():
    rows = search.parse_results(PAYLOAD)
    symbols = [r["symbol"] for r in rows]
    assert symbols == ["MSFT", "MSFT.MX", "SPY", "^GSPC"]  # options/crypto/empty dropped
    assert rows[0] == {
        "symbol": "MSFT", "name": "Microsoft Corporation",
        "exchange": "NASDAQ", "type": "EQUITY",
    }
    # longname preferred, shortname fallback, exchange fallback
    assert rows[1]["name"] == "Microsoft (Mexico)"
    assert rows[1]["exchange"] == "MEX"


def test_parse_results_respects_limit_and_empty():
    assert search.parse_results(PAYLOAD, limit=1) == [{
        "symbol": "MSFT", "name": "Microsoft Corporation",
        "exchange": "NASDAQ", "type": "EQUITY",
    }]
    assert search.parse_results({}) == []


def test_search_caches_per_query(monkeypatch):
    calls = []

    def stub_fetch(query, limit=8):
        calls.append(query)
        return [{"symbol": "MSFT", "name": "Microsoft", "exchange": "", "type": "EQUITY"}]

    monkeypatch.setattr(search, "fetch", stub_fetch)
    search._cache.clear()
    assert search.search("micro")[0]["symbol"] == "MSFT"
    assert search.search("  MICRO ")[0]["symbol"] == "MSFT"  # normalized key hits cache
    assert calls == ["micro"]
    search._cache.clear()


def test_search_does_not_cache_empty(monkeypatch):
    calls = []

    def stub_fetch(query, limit=8):
        calls.append(query)
        return []

    monkeypatch.setattr(search, "fetch", stub_fetch)
    search._cache.clear()
    assert search.search("zzz") == []
    assert search.search("zzz") == []
    assert len(calls) == 2  # transient failures don't stick
