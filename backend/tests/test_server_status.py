"""The admin-only /api/server/* introspection surface."""
import importlib

import pytest
from fastapi.testclient import TestClient

from app import db, quotes as quotes_module
from tests.conftest import authenticate


@pytest.fixture
def app_module(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "server.db"))
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)
    quotes_module._cache.clear()
    yield main_module
    quotes_module._cache.clear()


@pytest.fixture
def client(app_module):
    with TestClient(app_module.app) as c:
        authenticate(c)  # first account registered becomes admin
        yield c


def test_overview_reports_uptime_scheduler_and_db(client):
    body = client.get("/api/server/overview").json()
    assert body["uptime_seconds"] >= 0
    assert body["scheduler"]["running"] is True
    assert {j["id"] for j in body["scheduler"]["jobs"]} >= {"refresh_all", "daily_analysis"}
    assert body["db"]["size_bytes"] > 0
    assert "version" in body and "python" in body
    assert isinstance(body["running_sources"], dict)


def test_process_stats_degrade_honestly_without_psutil(app_module, monkeypatch):
    """Zeros would be indistinguishable from an idle machine, so an absent
    dependency has to say so."""
    monkeypatch.setattr(app_module, "psutil", None)
    stats = app_module._process_stats()
    assert stats["available"] is False
    assert "psutil" in stats["reason"]
    # ...and no fabricated numbers alongside it.
    assert "rss_bytes" not in stats and "cpu_percent" not in stats


def test_process_stats_present_when_psutil_is(app_module):
    stats = app_module._process_stats()
    if stats["available"]:
        assert stats["rss_bytes"] > 0
        assert stats["num_threads"] >= 1


def test_server_routes_are_admin_only(app_module):
    with TestClient(app_module.app) as admin:
        authenticate(admin)
        assert admin.get("/api/server/overview").status_code == 200

        other = TestClient(app_module.app)
        authenticate(other, email="notadmin@example.com")
        for path in ("/api/server/overview", "/api/server/sources", "/api/server/events"):
            assert other.get(path).status_code == 403, path


def test_sources_expose_both_clocks_and_the_next_gate(client, app_module):
    now = "2026-08-01T10:00:00+00:00"
    db.update_source_status(
        app_module.conn, "margin_debt", now, "error: RuntimeError: 401", 0, success=False)

    rows = {r["source"]: r for r in client.get("/api/server/sources").json()}
    md = rows["margin_debt"]
    assert md["last_refreshed_at"] == now
    assert md["last_success_at"] is None      # never succeeded
    assert md["min_interval_seconds"] is not None
    # A failed source is gated by the retry clock, and the page can say when.
    assert md["next_eligible_at"] is not None


def test_events_interleave_source_runs_and_job_runs(client, app_module):
    c = app_module.conn
    db.record_source_run(c, "gdelt", "2026-08-01T10:00:00+00:00",
                         "2026-08-01T10:00:02+00:00", "error", 2000, 0, "429")
    db.record_source_run(c, "vix", "2026-08-01T10:01:00+00:00",
                         "2026-08-01T10:01:01+00:00", "ok", 1000, 126)
    db.record_job_run(c, "refresh_all", "missed", "2026-08-01T10:02:00+00:00")

    events = client.get("/api/server/events?limit=10").json()
    assert [e["at"] for e in events] == sorted((e["at"] for e in events), reverse=True)
    kinds = {e["kind"] for e in events}
    assert kinds == {"source", "job"}
    missed = next(e for e in events if e["outcome"] == "missed")
    assert missed["kind"] == "job" and missed["id"] == "refresh_all"


def test_events_limit_is_bounded(client):
    assert len(client.get("/api/server/events?limit=99999").json()) <= 300


def test_skipped_runs_are_visible_as_events(client, app_module):
    """The whole point: a throttled source looks healthy in source_status."""
    db.record_source_run(app_module.conn, "margin_debt", "2026-08-01T10:00:00+00:00",
                         "2026-08-01T10:00:00+00:00", "skipped", 0, 0,
                         "retry_interval: 300s elapsed of 21600s")
    events = client.get("/api/server/events").json()
    skipped = [e for e in events if e["outcome"] == "skipped"]
    assert skipped and "retry_interval" in skipped[0]["detail"]
