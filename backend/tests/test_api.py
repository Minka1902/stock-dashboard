import pytest
from fastapi.testclient import TestClient

from app import db
from app import quotes as quotes_module
from app.models import ContractRecord, LiveQuote


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Point the app at a temp DB and a stub fetch before importing the app.
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "api.db"))
    import importlib
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)

    # Replace the real contracts fetch with a stub (no network in tests).
    def stub_fetch():
        return [
            ContractRecord(
                external_id="A", award_id="AWD-A", recipient_name="Acme",
                amount=10.0, awarding_agency="DoD", start_date="2026-06-01",
            )
        ]
    main_module.contracts_fetch = stub_fetch

    quotes_module._cache.clear()
    with TestClient(main_module.app) as c:
        yield c
    quotes_module._cache.clear()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_contracts_empty_then_populated_after_refresh(client):
    assert client.get("/api/contracts").json() == []
    refreshed = client.post("/api/refresh/usaspending").json()
    assert refreshed["status"] == "ok"
    contracts = client.get("/api/contracts").json()
    assert len(contracts) == 1
    assert contracts[0]["recipient_name"] == "Acme"


def test_sources_reports_freshness(client):
    client.post("/api/refresh/usaspending")
    sources = client.get("/api/sources").json()
    assert sources[0]["source"] == "usaspending"
    assert sources[0]["last_refreshed_at"] is not None


def test_refresh_unknown_source_returns_404(client):
    assert client.post("/api/refresh/bogus").status_code == 404


def test_sentiment_endpoint_ok_on_empty_db(client):
    resp = client.get("/api/sentiment")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["indicators"]) == {"fear_greed", "vix", "aaii", "put_call"}
    assert body["overall"]["lean"] == "NEUTRAL"


def test_quotes_empty_watchlist_and_portfolio(client):
    resp = client.get("/api/quotes")
    assert resp.status_code == 200
    body = resp.json()
    assert body["quotes"] == []
    assert "as_of" in body


def test_quotes_union_of_watchlist_and_portfolio(client, monkeypatch):
    requested = []

    def stub_fetch_quotes(tickers):
        requested.append(list(tickers))
        return [
            LiveQuote(ticker=t, price=100.0, change_pct=1.5, previous_close=98.5,
                      market_state="PRE", fetched_at="2026-07-04T12:00:00+00:00")
            for t in tickers
        ]

    monkeypatch.setattr(quotes_module, "fetch_quotes", stub_fetch_quotes)
    client.post("/api/watchlist", json={"ticker": "LMT", "note": ""})
    client.post("/api/portfolio", json={"ticker": "NOC", "shares": 1, "avg_cost": 10})

    body = client.get("/api/quotes").json()
    assert requested == [["LMT", "NOC"]]
    tickers = {q["ticker"] for q in body["quotes"]}
    assert tickers == {"LMT", "NOC"}
    assert all("price" in q and "market_state" in q for q in body["quotes"])


def test_vix_aaii_put_call_endpoints_empty(client):
    assert client.get("/api/vix").json() == []
    assert client.get("/api/aaii").json() == []
    assert client.get("/api/put-call").json() == []
