import pytest
from fastapi.testclient import TestClient

from app import db
from app.models import ContractRecord


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

    with TestClient(main_module.app) as c:
        yield c


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
