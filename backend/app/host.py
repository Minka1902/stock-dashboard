"""Which machine this is, and whether this process is its installed service.

Stdlib only at import time: deploy/ imports it without the virtualenv, so the
installer and the app agree on one answer.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

WINDOWS, PI, LINUX = "windows", "pi", "linux"
LABELS = {WINDOWS: "Windows", PI: "Raspberry Pi", LINUX: "Linux"}

WINDOWS_SERVICE = "SignalDashboard"
SYSTEMD_UNIT = "stocks-dashboard.service"
UPDATE_UNIT = "stocks-update.service"

SERVICE, DEV = "service", "dev"

_MODEL_PATHS = (Path("/proc/device-tree/model"), Path("/sys/firmware/devicetree/base/model"))
_SC_TIMEOUT_SECONDS = 5


def detect_kind() -> str:
    """STOCKS_HOST_KIND overrides; else Windows, a Raspberry Pi (by its
    device-tree model), or any other POSIX machine as plain Linux."""
    override = os.environ.get("STOCKS_HOST_KIND", "").strip().lower()
    if override in LABELS:
        return override
    if sys.platform == "win32":
        return WINDOWS
    for path in _MODEL_PATHS:
        try:
            if "raspberry pi" in path.read_text(encoding="ascii", errors="ignore").lower():
                return PI
        except OSError:
            continue
    return LINUX


KIND = detect_kind()


def creationflags() -> int:
    # No console window flashing up under the service or the desktop shell.
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0


def _windows_service_pid() -> int | None:
    try:
        out = subprocess.run(
            ["sc", "queryex", WINDOWS_SERVICE], capture_output=True, text=True,
            timeout=_SC_TIMEOUT_SECONDS, creationflags=creationflags()).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"PID\s*:\s*(\d+)", out)
    return int(match.group(1)) or None if match else None  # 0 = service stopped


def _ancestor_pids() -> list[int]:
    pids = [os.getppid()]
    try:
        import psutil
        pids += [p.pid for p in psutil.Process().parents()]
    except Exception:  # noqa: BLE001 - psutil is optional; the parent pid alone suffices
        pass
    return pids


def _cgroup() -> str:
    try:
        return Path("/proc/self/cgroup").read_text(encoding="utf-8")
    except OSError:
        return ""


def service_mode() -> str:
    """'service' when this process is the installed service, else 'dev'.

    Structural, not a flag someone has to remember to set. Windows: NSSM is
    the service's process and runs python as its child, so the service's PID
    is one of our ancestors exactly when we are the service. systemd: it
    exports INVOCATION_ID to every unit it starts and puts the unit's
    processes in a cgroup named after it. STOCKS_UPDATE_MODE overrides both.
    """
    override = os.environ.get("STOCKS_UPDATE_MODE", "").strip().lower()
    if override in (SERVICE, DEV):
        return override
    if KIND == WINDOWS:
        pid = _windows_service_pid()
        return SERVICE if pid and pid in _ancestor_pids() else DEV
    return SERVICE if os.environ.get("INVOCATION_ID") and SYSTEMD_UNIT in _cgroup() else DEV
