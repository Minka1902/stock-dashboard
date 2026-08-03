"""POST /api/refresh contract: queued, non-blocking, and admin-gated forcing.

The route used to run the fetch inline on the request thread. With 19 sources
refreshed at once and per-source timeouts up to 30s, that tied up the single
uvicorn worker for minutes — which reads to a user as a dead server.
"""
import importlib

import pytest
from fastapi.testclient import TestClient

from app import db, quotes as quotes_module
from app.models import ContractRecord
from tests.conftest import authenticate, drain_refresh


@pytest.fixture
def app_module(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "refresh.db"))
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)

    def stub_fetch(conn):
        return [
            ContractRecord(
                external_id="A", award_id="AWD-A", recipient_name="Acme",
                amount=10.0, awarding_agency="DoD", start_date="2026-06-01",
            )
        ]

    main_module.contracts_fetch = stub_fetch
    quotes_module._cache.clear()
    yield main_module
    quotes_module._cache.clear()


@pytest.fixture
def client(app_module):
    with TestClient(app_module.app) as c:
        authenticate(c)
        yield c


def test_refresh_returns_202_and_queues(client):
    resp = client.post("/api/refresh/usaspending")
    assert resp.status_code == 202
    body = resp.json()
    assert body["source"] == "usaspending"
    assert body["queued"] is True
    drain_refresh()
    assert len(client.get("/api/contracts").json()) == 1


def test_refresh_reports_null_status_for_a_never_run_source(client):
    """A source with no status row yet must not blow up the response.

    The handler builds its payload before the queued job runs, so on the very
    first call there is no source_status row to report — indexing it would 500.
    """
    resp = client.post("/api/refresh/margin_debt")
    assert resp.status_code == 202
    assert resp.json()["status"] is None


def test_refresh_unknown_source_is_404(client):
    assert client.post("/api/refresh/bogus").status_code == 404


def test_refresh_does_not_block_on_a_slow_source(client, app_module):
    """The request must return while the fetch is still running."""
    import threading

    release = threading.Event()
    started = threading.Event()

    def slow_fetch():
        started.set()
        release.wait(timeout=10)
        return []

    spec = app_module.SOURCES["usaspending"]
    app_module.SOURCES["usaspending"] = spec._replace(fetch=slow_fetch)
    try:
        resp = client.post("/api/refresh/usaspending")
        assert resp.status_code == 202
        assert started.wait(timeout=5), "job should have started on the executor"
        # The HTTP response already came back while the fetch is still blocked.
        assert not release.is_set()
    finally:
        release.set()
        drain_refresh()
        app_module.SOURCES["usaspending"] = spec


def test_force_requires_admin(client, app_module):
    """force=1 is the one path that can hammer a rate-limited upstream."""
    # `client` is the first registered account, which becomes admin.
    assert client.post("/api/refresh/usaspending?force=1").status_code == 202
    drain_refresh()

    # A second, non-admin account. Deliberately not a second `with TestClient`:
    # lifespan shutdown now closes both DB connections, so one app module can
    # only host a single lifespan. A bare TestClient shares the module state
    # without re-running startup.
    other = TestClient(app_module.app)
    authenticate(other, email="second@example.com")
    assert other.post("/api/refresh/usaspending?force=1").status_code == 403
    # ...but a normal queued refresh is still allowed.
    assert other.post("/api/refresh/usaspending").status_code == 202
    drain_refresh()


def test_force_bypasses_the_throttle(client, app_module):
    calls = 0

    def counting():
        nonlocal calls
        calls += 1
        return []

    spec = app_module.SOURCES["usaspending"]
    app_module.SOURCES["usaspending"] = spec._replace(
        fetch=counting, min_interval=3600)
    try:
        client.post("/api/refresh/usaspending")
        drain_refresh()
        assert calls == 1

        client.post("/api/refresh/usaspending")  # throttled
        drain_refresh()
        assert calls == 1

        client.post("/api/refresh/usaspending?force=1")  # admin force
        drain_refresh()
        assert calls == 2
    finally:
        app_module.SOURCES["usaspending"] = spec


def test_source_spec_defaults_preserve_tuple_shape(app_module):
    """Registry entries written as plain 3-tuples still normalize correctly."""
    spec = app_module.build_sources(app_module.conn)["usaspending"]
    assert spec.min_interval is None
    assert spec.retry_interval is None
    assert spec.force_on_daily is True


def test_health_is_public_and_reports_checks(app_module):
    with TestClient(app_module.app) as c:
        resp = c.get("/api/health")  # no authentication
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["checks"] == {"db": True, "scheduler": True}
    assert body["uptime_seconds"] >= 0


def test_scheduler_job_defaults_are_not_apscheduler_defaults(app_module):
    """APScheduler defaults to misfire_grace_time=1, which silently drops a job
    delayed by a sleeping machine or a busy pool."""
    defaults = app_module.scheduler._job_defaults
    assert defaults["misfire_grace_time"] >= 300
    assert defaults["coalesce"] is True
    assert defaults["max_instances"] == 1


def test_job_events_are_recorded(app_module):
    """Missed and max-instances events are the ones APScheduler only logs."""
    from apscheduler.events import EVENT_JOB_MISSED

    class _Event:
        code = EVENT_JOB_MISSED
        job_id = "refresh_all"
        exception = None

    app_module._on_job_event(_Event())
    runs = db.get_job_runs(app_module.refresh_conn)
    assert runs[0].job_id == "refresh_all"
    assert runs[0].event == "missed"
