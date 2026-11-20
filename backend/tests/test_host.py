"""Host detection: which machine this is, and whether we run as its service."""
import sys

import pytest

from app import host


def test_kind_override_wins(monkeypatch):
    for kind in (host.WINDOWS, host.PI, host.LINUX):
        monkeypatch.setenv("STOCKS_HOST_KIND", kind.upper())
        assert host.detect_kind() == kind
    monkeypatch.setenv("STOCKS_HOST_KIND", "amiga")
    assert host.detect_kind() in host.LABELS


def test_windows_is_detected_by_platform(monkeypatch):
    monkeypatch.delenv("STOCKS_HOST_KIND", raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    assert host.detect_kind() == host.WINDOWS


@pytest.mark.parametrize("model,expected", [
    ("Raspberry Pi 3 Model B Plus Rev 1.3\x00", host.PI),
    ("Raspberry Pi 5 Model B Rev 1.0\x00", host.PI),
    ("Radxa ROCK 5B\x00", host.LINUX),
])
def test_a_pi_is_recognised_by_its_device_tree_model(tmp_path, monkeypatch, model, expected):
    monkeypatch.delenv("STOCKS_HOST_KIND", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    path = tmp_path / "model"
    path.write_text(model)
    monkeypatch.setattr(host, "_MODEL_PATHS", (tmp_path / "missing", path))
    assert host.detect_kind() == expected


def test_no_device_tree_is_plain_linux(tmp_path, monkeypatch):
    monkeypatch.delenv("STOCKS_HOST_KIND", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(host, "_MODEL_PATHS", (tmp_path / "missing",))
    assert host.detect_kind() == host.LINUX


def test_service_mode_override(monkeypatch):
    monkeypatch.setenv("STOCKS_UPDATE_MODE", "service")
    assert host.service_mode() == "service"
    monkeypatch.setenv("STOCKS_UPDATE_MODE", "dev")
    assert host.service_mode() == "dev"


def test_service_mode_reads_the_systemd_unit(monkeypatch):
    monkeypatch.delenv("STOCKS_UPDATE_MODE", raising=False)
    monkeypatch.setattr(host, "KIND", host.PI)
    monkeypatch.setenv("INVOCATION_ID", "0123abcd")
    monkeypatch.setattr(host, "_cgroup", lambda: "0::/system.slice/stocks-dashboard.service\n")
    assert host.service_mode() == "service"
    monkeypatch.setattr(host, "_cgroup", lambda: "0::/user.slice/user-1000.slice/session-2.scope\n")
    assert host.service_mode() == "dev"
    monkeypatch.delenv("INVOCATION_ID")
    monkeypatch.setattr(host, "_cgroup", lambda: "0::/system.slice/stocks-dashboard.service\n")
    assert host.service_mode() == "dev"


def test_service_mode_reads_the_nssm_ancestor(monkeypatch):
    monkeypatch.delenv("STOCKS_UPDATE_MODE", raising=False)
    monkeypatch.setattr(host, "KIND", host.WINDOWS)
    monkeypatch.setattr(host, "_ancestor_pids", lambda: [4321, 900])
    monkeypatch.setattr(host, "_windows_service_pid", lambda: 900)
    assert host.service_mode() == "service"
    monkeypatch.setattr(host, "_windows_service_pid", lambda: 77)
    assert host.service_mode() == "dev"
    monkeypatch.setattr(host, "_windows_service_pid", lambda: None)
    assert host.service_mode() == "dev"
