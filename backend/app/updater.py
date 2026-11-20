"""In-app update: compare this working tree against GitHub, and hand off an update.

The app runs straight from a git checkout on every platform, so "is there a
newer version?" is a git question (app/updatecore.py asks it):

    git fetch origin main
    git rev-list --count HEAD..origin/main     -> how far behind
    git rev-list --count origin/main..HEAD     -> local commits (blocks a fast-forward)
    git log HEAD..origin/main                  -> what the new commits are

Applying is deliberately NOT done in this process: the update restarts the very
server that would be running it. `spawn_update` writes the request to
`<LOG_DIR>/update-request.json` and hands off to deploy/manage.py, which pulls,
installs, updates the web app, restarts and rolls back on failure, writing its
progress to `<LOG_DIR>/update-status.json` for the UI. How it is started is the
only platform difference: a separate systemd unit under systemd, a detached
process everywhere else.
"""
from __future__ import annotations

import logging
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pydantic import BaseModel

from app import config, host, updatecore
from app.version import __version__

logger = logging.getLogger(__name__)

MANAGE_SCRIPT = updatecore.REPO_ROOT / "deploy" / "manage.py"
SYSTEMCTL_TIMEOUT_SECONDS = 10
CACHE_TTL_SECONDS = 3600
CHECK_INTERVAL_HOURS = 6


class Commit(BaseModel):
    sha: str
    subject: str
    author: str
    date: str  # ISO-8601 committer date, as git reports it


class UpdateCheck(BaseModel):
    checked_at: str
    ok: bool                       # the check itself ran (git + network worked)
    error: str | None = None
    current_version: str = __version__
    current_commit: str | None = None
    branch: str | None = None      # None when HEAD is detached
    remote: str = f"{updatecore.REMOTE}/{updatecore.BRANCH}"
    remote_commit: str | None = None
    behind: int = 0
    ahead: int = 0
    commits: list[Commit] = []
    commits_truncated: bool = False
    latest_version: str | None = None
    dirty_files: list[str] = []    # tracked modifications only
    dirty_count: int = 0
    update_available: bool = False
    can_apply: bool = False
    blocked_reason: str | None = None


# The commit this process started from — what /api/health reports. Cached for
# the process lifetime on purpose: after an update, a *changed* value is the
# signal that the restarted server is actually running the new code.
STARTUP_COMMIT: str | None = updatecore.head_short()

_lock = threading.Lock()
_cache: tuple[float, UpdateCheck] | None = None


# ---------- the check ----------

def check(force: bool = False) -> UpdateCheck:
    """The latest check, re-running it when forced or older than an hour.

    Serialized: two concurrent `git fetch`es in one repo fight over
    `.git/FETCH_HEAD` and the ref locks.
    """
    global _cache
    with _lock:
        if not force and _cache and time.monotonic() - _cache[0] < CACHE_TTL_SECONDS:
            return _cache[1]
        result = UpdateCheck(**updatecore.run_check())
        _cache = (time.monotonic(), result)
        return result


def cached() -> UpdateCheck | None:
    return _cache[1] if _cache else None


def clear_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def scheduled_check() -> None:
    """Scheduler entry point. Skips while an update is running — a fetch in
    the middle of the updater's `git pull` would contend for the same locks."""
    if is_apply_running():
        return
    result = check(force=True)
    if result.ok and result.update_available:
        logger.info("update available: %s commit(s) behind %s", result.behind, result.remote)
    elif not result.ok:
        logger.warning("update check failed: %s", result.error)


def schedule(scheduler) -> None:
    """Register the 6-hourly check. First run ~2 min after start so a boot
    doesn't stack a network fetch on top of the first ingest cycle."""
    scheduler.add_job(
        scheduled_check,
        "interval",
        hours=CHECK_INTERVAL_HOURS,
        id="update_check",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc) + timedelta(minutes=2),
    )


# ---------- apply progress (written by deploy/commands/update.py) ----------

def status_path() -> Path:
    return Path(config.LOG_DIR) / updatecore.STATUS_FILE_NAME


def request_path() -> Path:
    return Path(config.LOG_DIR) / updatecore.REQUEST_FILE_NAME


def read_apply_status() -> dict | None:
    return updatecore.read_status(config.LOG_DIR)


def is_apply_running() -> bool:
    return updatecore.is_apply_running(read_apply_status())


def write_status(status: dict) -> None:
    updatecore.write_json(status_path(), status)


# ---------- hand-off ----------

def update_command() -> list[str]:
    return [sys.executable, str(MANAGE_SCRIPT), "update", "--from-request",
            "--log-dir", str(Path(config.LOG_DIR))]


def _spawn_detached(cmd: list[str]) -> None:
    kwargs = dict(cwd=str(updatecore.REPO_ROOT), stdin=subprocess.DEVNULL,
                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    if sys.platform != "win32":
        subprocess.Popen(cmd, start_new_session=True, **kwargs)
        return
    # DETACHED_PROCESS: no console at all (so no window, and no Ctrl-C shared
    # with the server's console group when NSSM stops it).
    base = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(cmd, creationflags=base | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kwargs)
    except OSError:
        # The job we run in (if any) forbids breakaway; the updater's own
        # relaunch still orphans the real worker from our process tree.
        subprocess.Popen(cmd, creationflags=base, **kwargs)


def spawn_update(previous: str, mode: str, port: int) -> None:
    """Hand the update to deploy/manage.py, outside this process.

    It has to outlive us: its last step restarts this server. Under systemd it
    is its own unit (its own cgroup, so restarting the dashboard never takes it
    down; the installer's polkit rule lets the service user start it). On
    Windows, and in dev mode anywhere, it is a detached process; there the
    updater relaunches itself once so its parent pid is a process that has
    already exited — NSSM's stop kills the service's process tree by parent pid.
    """
    if not MANAGE_SCRIPT.exists():
        raise RuntimeError(f"{MANAGE_SCRIPT} is missing")
    updatecore.write_json(request_path(), {"previous_commit": previous, "port": port, "mode": mode})
    if mode != host.SERVICE or host.KIND == host.WINDOWS:
        _spawn_detached(update_command())
        return
    try:
        proc = subprocess.run(
            ["systemctl", "start", "--no-block", host.UPDATE_UNIT],
            capture_output=True, text=True, timeout=SYSTEMCTL_TIMEOUT_SECONDS)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"systemctl failed: {exc}") from exc
    if proc.returncode != 0:
        raise RuntimeError(
            (proc.stderr or proc.stdout).strip() or f"could not start {host.UPDATE_UNIT}")
