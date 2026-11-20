import importlib

import pytest
from fastapi.testclient import TestClient

from app import host, hosthealth
from tests.conftest import authenticate


def test_decode_throttled_names_every_set_flag():
    assert hosthealth.decode_throttled(0) == []
    assert hosthealth.decode_throttled(0x50005) == [
        "under-voltage now", "throttled now",
        "under-voltage has occurred since boot", "throttling has occurred since boot",
    ]


def test_snapshot_reads_the_firmware_and_thermal_files(tmp_path, monkeypatch):
    throttled = tmp_path / "get_throttled"
    throttled.write_text("50000\n")
    thermal = tmp_path / "temp"
    thermal.write_text("61234\n")
    monkeypatch.setattr(hosthealth.config, "PI_THROTTLED_PATH", str(throttled))
    monkeypatch.setattr(hosthealth, "THERMAL_PATH", thermal)
    monkeypatch.setattr(hosthealth.config, "BACKUP_DIR", tmp_path / "none")
    monkeypatch.setattr(host, "KIND", host.PI)
    snap = hosthealth.snapshot()
    assert (snap["kind"], snap["label"]) == ("pi", "Raspberry Pi")
    assert snap["throttled"] == {"raw": "0x50000", "ok": False,
                                 "flags": ["under-voltage has occurred since boot",
                                           "throttling has occurred since boot"]}
    assert snap["cpu_temp_c"] == 61.2
    assert snap["disk"]["total_bytes"] > 0 and snap["memory"]["percent"] is not None
    assert snap["backup"] is None


def test_snapshot_off_a_pi_reports_nothing_rather_than_guessing(tmp_path, monkeypatch):
    monkeypatch.setattr(hosthealth.config, "PI_THROTTLED_PATH", str(tmp_path / "missing"))
    monkeypatch.setattr(hosthealth, "THERMAL_PATH", tmp_path / "missing-too")
    monkeypatch.setattr(host, "KIND", host.WINDOWS)
    snap = hosthealth.snapshot()
    assert snap["throttled"] is None and snap["cpu_temp_c"] is None
    assert snap["label"] == "Windows"


# ------------------------------------------------------------ app wiring
@pytest.fixture
def app_module(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "host.db"))
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)
    yield main_module


def test_health_degrades_when_the_refresh_thread_is_stuck(app_module, monkeypatch):
    with TestClient(app_module.app) as client:
        assert client.get("/api/health").json()["checks"]["refresh_thread"] is True
        monkeypatch.setattr(app_module.ingest, "running_sources", lambda: {"ohlc": 4000.0})
        body = client.get("/api/health").json()
        assert body["status"] == "degraded" and body["checks"]["refresh_thread"] is False


def test_backup_job_and_overview_card(app_module):
    with TestClient(app_module.app) as client:
        job = app_module.scheduler.get_job("db_backup")
        assert job.executor == "refresh"
        authenticate(client)
        overview = client.get("/api/server/overview").json()
        assert (overview["registration"], overview["signups_pending"]) == ("open", 0)
        machine = overview["machine"]
        assert set(machine) == {"kind", "label", "throttled", "cpu_temp_c",
                                "memory", "swap", "disk", "backup"}
