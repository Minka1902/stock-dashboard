"""In-app updater: the check state machine, the hand-off, and the routes.

Git is never actually run here: `updatecore.git` is replaced by a fake that
answers from a table, so every scenario (behind, dirty, diverged, offline,
no git at all) is deterministic.
"""
import importlib
import json
import subprocess

import pytest
from fastapi.testclient import TestClient

from app import host, updatecore, updater
from tests.conftest import authenticate

SEP = "\x1f"


# ---------- check() against a fake git ----------

class FakeGit:
    def __init__(self, *, branch="main", behind=0, ahead=0, dirty="", log="",
                 version='__version__ = "0.2.0"\n', fetch_error=None, missing=False):
        self.branch, self.behind, self.ahead = branch, behind, ahead
        self.dirty, self.log, self.version = dirty, log, version
        self.fetch_error, self.missing = fetch_error, missing
        self.calls = []

    def __call__(self, *args, timeout=updatecore.GIT_TIMEOUT_SECONDS):
        self.calls.append(args)
        if self.missing:
            raise updatecore.GitError("git is not installed or not on the server's PATH")
        cmd = args[0]
        if args[:2] == ("rev-parse", "--short"):
            return "aaaaaaa\n" if args[2] == "HEAD" else "bbbbbbb\n"
        if args[:2] == ("rev-parse", "--abbrev-ref"):
            return self.branch + "\n"
        if cmd == "status":
            return self.dirty
        if cmd == "fetch":
            if self.fetch_error:
                err = updatecore.GitError(self.fetch_error)
                err.stderr = self.fetch_error
                raise err
            return ""
        if cmd == "rev-list":
            return f"{self.behind if args[2].startswith('HEAD..') else self.ahead}\n"
        if cmd == "log":
            return self.log
        if cmd == "show":
            return self.version
        raise AssertionError(f"unexpected git call {args}")


@pytest.fixture
def fake_git(monkeypatch):
    def install(**kw):
        fake = FakeGit(**kw)
        monkeypatch.setattr(updatecore, "git", fake)
        updater.clear_cache()
        return fake
    yield install
    updater.clear_cache()


def _log(n):
    return "".join(f"c{i:06d}{SEP}commit {i}{SEP}Dev{SEP}2026-09-2{i % 10}T00:00:00Z\n"
                   for i in range(n))


def test_up_to_date(fake_git):
    fake_git()
    c = updater.check(force=True)
    assert c.ok and c.behind == 0 and not c.update_available
    assert not c.can_apply and c.blocked_reason == "already up to date"
    assert c.current_commit == "aaaaaaa" and c.remote_commit == "bbbbbbb"


def test_behind_parses_commits_and_version(fake_git):
    fake_git(behind=3, log=_log(3))
    c = updater.check(force=True)
    assert c.ok and c.update_available and c.can_apply
    assert c.blocked_reason is None
    assert [x.subject for x in c.commits] == ["commit 0", "commit 1", "commit 2"]
    assert c.latest_version == "0.2.0"
    assert c.commits_truncated is False


def test_behind_more_than_cap_is_marked_truncated(fake_git):
    fake_git(behind=80, log=_log(updatecore.MAX_COMMITS))
    c = updater.check(force=True)
    assert len(c.commits) == updatecore.MAX_COMMITS and c.commits_truncated


def test_dirty_tree_blocks(fake_git):
    fake_git(behind=2, log=_log(2), dirty=" M backend/app/main.py\n?? notes.txt\n")
    c = updater.check(force=True)
    assert c.update_available and not c.can_apply
    assert c.dirty_files == ["backend/app/main.py"] and c.dirty_count == 1
    assert "local changes" in c.blocked_reason


def test_not_on_main_blocks(fake_git):
    fake_git(branch="feature-x", behind=1, log=_log(1))
    c = updater.check(force=True)
    assert c.branch == "feature-x" and not c.can_apply
    assert "feature-x" in c.blocked_reason


def test_detached_head_blocks(fake_git):
    fake_git(branch="HEAD", behind=1, log=_log(1))
    c = updater.check(force=True)
    assert c.branch is None and "detached" in c.blocked_reason


def test_ahead_means_diverged_and_blocks(fake_git):
    fake_git(behind=2, ahead=1, log=_log(2))
    c = updater.check(force=True)
    assert c.ahead == 1 and not c.can_apply
    assert "fast-forward" in c.blocked_reason


def test_git_missing_is_reported_not_invented(fake_git):
    fake_git(missing=True)
    c = updater.check(force=True)
    assert not c.ok and not c.update_available and not c.can_apply
    assert "not installed" in c.error
    assert c.current_commit is None


def test_fetch_failure_reports_github_unreachable(fake_git):
    fake = fake_git(behind=5, fetch_error="fatal: unable to access\nCould not resolve host: github.com")
    c = updater.check(force=True)
    assert not c.ok and not c.update_available
    assert c.error == "could not reach GitHub: Could not resolve host: github.com"
    # Stops at the fetch: never reports counts from stale refs as fresh.
    assert not any(call[0] == "rev-list" for call in fake.calls)


def test_check_is_cached_until_forced(fake_git):
    fake = fake_git()
    updater.check()
    n = len(fake.calls)
    updater.check()
    assert len(fake.calls) == n
    updater.check(force=True)
    assert len(fake.calls) > n


# ---------- apply status file ----------

def test_is_apply_running_ignores_stale(tmp_path, monkeypatch):
    monkeypatch.setattr(updater.config, "LOG_DIR", tmp_path)
    assert updater.is_apply_running() is False
    status = updatecore.initial_status("aaaaaaa", "bbbbbbb", "dev")
    updater.write_status(status)
    assert updater.is_apply_running() is True
    status["updated_at"] = "2020-01-01T00:00:00Z"
    updater.write_status(status)
    assert updater.is_apply_running() is False
    (tmp_path / updatecore.STATUS_FILE_NAME).write_text("{not json", encoding="utf-8")
    assert updater.read_apply_status()["state"] == "unknown"


# ---------- hand-off ----------

@pytest.fixture
def handoff(tmp_path, monkeypatch):
    """Record what spawn_update would start, without starting it."""
    monkeypatch.setattr(updater.config, "LOG_DIR", tmp_path)
    started = {"run": [], "popen": []}
    monkeypatch.setattr(subprocess, "run", lambda cmd, **k: started["run"].append(cmd) or
                        subprocess.CompletedProcess(cmd, 0, "", ""))
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **k: started["popen"].append((cmd, k)))
    return started


def _request():
    return json.loads(updater.request_path().read_text(encoding="utf-8"))


def test_systemd_service_starts_the_update_unit(handoff, monkeypatch):
    monkeypatch.setattr(host, "KIND", host.PI)
    updater.spawn_update("aaaaaaa", "service", 8000)
    assert handoff["run"] == [["systemctl", "start", "--no-block", "stocks-update.service"]]
    assert handoff["popen"] == []
    assert _request() == {"previous_commit": "aaaaaaa", "port": 8000, "mode": "service"}


def test_systemd_refusal_is_reported(handoff, monkeypatch):
    monkeypatch.setattr(host, "KIND", host.LINUX)
    monkeypatch.setattr(subprocess, "run", lambda cmd, **k: subprocess.CompletedProcess(
        cmd, 4, "", "Failed to start stocks-update.service: Access denied"))
    with pytest.raises(RuntimeError, match="Access denied"):
        updater.spawn_update("aaaaaaa", "service", 8000)


@pytest.mark.parametrize("kind,mode", [
    (host.WINDOWS, "service"), (host.WINDOWS, "dev"), (host.PI, "dev"), (host.LINUX, "dev")])
def test_everything_else_spawns_the_deploy_tool_detached(handoff, monkeypatch, tmp_path, kind, mode):
    monkeypatch.setattr(host, "KIND", kind)
    updater.spawn_update("aaaaaaa", mode, 8123)
    assert handoff["run"] == []
    (cmd, kwargs), = handoff["popen"]
    assert cmd[1:] == [str(updater.MANAGE_SCRIPT), "update", "--from-request",
                       "--log-dir", str(tmp_path)]
    assert kwargs["start_new_session"] is True and kwargs["stdin"] == subprocess.DEVNULL
    assert _request() == {"previous_commit": "aaaaaaa", "port": 8123, "mode": mode}


def test_a_missing_deploy_tool_changes_nothing(handoff, monkeypatch, tmp_path):
    monkeypatch.setattr(updater, "MANAGE_SCRIPT", tmp_path / "nope.py")
    with pytest.raises(RuntimeError, match="is missing"):
        updater.spawn_update("aaaaaaa", "service", 8000)
    assert not updater.request_path().exists() and handoff["popen"] == []


# ---------- routes ----------

@pytest.fixture
def app_module(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "update.db"))
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)
    monkeypatch.setattr(updater.config, "LOG_DIR", tmp_path / "logs")
    yield main_module


@pytest.fixture
def client(app_module):
    with TestClient(app_module.app) as c:
        yield c


def _second_user(client):
    from app import security
    authenticate(client, email="first@x.co")
    client.post("/api/auth/logout")
    security.limiter.reset()
    authenticate(client, email="second@x.co")


def test_status_requires_auth(client):
    assert client.get("/api/update/status").status_code == 401
    assert client.post("/api/update/apply").status_code == 401


def test_status_reports_check_and_viewer(client, fake_git):
    fake_git(behind=2, log=_log(2))
    authenticate(client)
    body = client.get("/api/update/status").json()
    assert body["check"]["behind"] == 2
    assert body["viewer_is_admin"] is True
    assert body["current"]["version"] == updater.__version__
    assert body["apply"] is None


def test_health_and_overview_carry_commit(client):
    assert client.get("/api/health").json()["commit"] == updater.STARTUP_COMMIT
    authenticate(client)
    assert client.get("/api/server/overview").json()["commit"] == updater.STARTUP_COMMIT


def test_apply_non_admin_forbidden(client, fake_git, monkeypatch):
    fake_git(behind=1, log=_log(1))
    spawned = []
    monkeypatch.setattr(updater, "spawn_update", lambda *a: spawned.append(a))
    _second_user(client)
    assert client.get("/api/update/status").json()["viewer_is_admin"] is False
    assert client.post("/api/update/apply").status_code == 403
    assert spawned == []


def test_apply_precondition_409(client, fake_git, monkeypatch):
    fake_git(behind=1, log=_log(1), dirty=" M backend/app/db.py\n")
    spawned = []
    monkeypatch.setattr(updater, "spawn_update", lambda *a: spawned.append(a))
    authenticate(client)
    r = client.post("/api/update/apply")
    assert r.status_code == 409
    assert "local changes" in r.json()["detail"]
    assert spawned == []


def test_apply_spawns_and_returns_202(client, fake_git, monkeypatch):
    fake_git(behind=2, log=_log(2))
    spawned = []
    monkeypatch.setattr(updater, "spawn_update", lambda *a: spawned.append(a))
    monkeypatch.setattr(host, "service_mode", lambda: "service")
    authenticate(client)
    r = client.post("/api/update/apply")
    assert r.status_code == 202, r.text
    assert spawned and spawned[0][0] == "aaaaaaa" and spawned[0][1] == "service"
    status = json.loads(updater.status_path().read_text(encoding="utf-8"))
    assert status["state"] == "running" and status["target_commit"] == "bbbbbbb"
    assert r.json()["apply"]["state"] == "running"
    # A second click while it runs is refused rather than starting another.
    again = client.post("/api/update/apply")
    assert again.status_code == 409 and "already running" in again.json()["detail"]
