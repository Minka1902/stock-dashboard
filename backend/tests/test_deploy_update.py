"""deploy/commands/update.py against real git repos: a bare 'GitHub', a dev
clone that pushes main and the CI-built web-dist branch, and the installed
checkout it updates. pip and the restart are stubbed; git, the status file
and the web-app swap are real."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app import updatecore
from deploy.commands import update
from deploy.lib import paths as paths_lib
from deploy.lib import webdist

NO_NODE = None


def _git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True,
                          text=True).stdout.strip()


def _commit(repo, path, text, message):
    (repo / path).parent.mkdir(parents=True, exist_ok=True)
    (repo / path).write_text(text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


def _publish_web_dist(dev, source_sha, html):
    """What the CI job does: one orphan-branch commit per main commit."""
    work = dev.parent / f"dist-{source_sha[:7]}"
    _git(dev.parent, "clone", "-q", str(dev.parent / "remote.git"), str(work))
    try:
        _git(work, "fetch", "-q", "origin", "web-dist")
        _git(work, "checkout", "-q", "-B", "web-dist", "origin/web-dist")
    except subprocess.CalledProcessError:
        _git(work, "checkout", "-q", "--orphan", "web-dist")
        _git(work, "rm", "-rqf", ".")
    for f in work.iterdir():
        if f.name != ".git":
            shutil.rmtree(f) if f.is_dir() else f.unlink()
    (work / "index.html").write_text(html)
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", f"source: {source_sha}")
    _git(work, "push", "-q", "origin", "web-dist")


@pytest.fixture
def world(tmp_path, monkeypatch):
    for key in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{key}_NAME", "t")
        monkeypatch.setenv(f"GIT_{key}_EMAIL", "t@x.co")
    _git(tmp_path, "init", "-q", "--bare", "-b", "main", "remote.git")
    dev = tmp_path / "dev"
    _git(tmp_path, "clone", "-q", str(tmp_path / "remote.git"), str(dev))
    v1 = _commit(dev, "backend/requirements.txt", "fastapi\n", "v1")
    _git(dev, "push", "-q", "origin", "HEAD:main")
    _publish_web_dist(dev, v1, "<p>v1</p>")

    installed = tmp_path / "installed"
    _git(tmp_path, "clone", "-q", "-b", "main", str(tmp_path / "remote.git"), str(installed))
    monkeypatch.setattr(updatecore, "REPO_ROOT", installed)
    monkeypatch.setattr(paths_lib, "venv_python", lambda app: Path(sys.executable))
    monkeypatch.setattr(webdist.shutil, "which", lambda name: NO_NODE)
    monkeypatch.setattr(webdist, "WAIT_SECONDS", 0)
    restarts = []
    monkeypatch.setattr(update.Update, "install_deps", lambda self: None)

    def restart(self, expect):
        restarts.append(expect)
        return f"back on {expect}"

    monkeypatch.setattr(update.Update, "restart", restart)
    assert webdist.install(v1) == webdist.PREBUILT
    logs = tmp_path / "logs"
    return {"dev": dev, "installed": installed, "v1": v1, "logs": logs, "restarts": restarts}


def _request(world, previous=None):
    world["logs"].mkdir(exist_ok=True)
    (world["logs"] / updatecore.REQUEST_FILE_NAME).write_text(json.dumps(
        {"previous_commit": previous or world["v1"][:7], "port": 8000, "mode": "service"}))


def _apply(world, previous=None):
    _request(world, previous)
    return update.from_request(world["logs"], detached=True, argv=[])


def _status(world):
    return json.loads((world["logs"] / updatecore.STATUS_FILE_NAME).read_text())


def _push_v2(world, with_web_dist=True):
    v2 = _commit(world["dev"], "backend/app.py", "print('v2')\n", "v2")
    _git(world["dev"], "push", "-q", "origin", "HEAD:main")
    if with_web_dist:
        _publish_web_dist(world["dev"], v2, "<p>v2</p>")
    return v2


def _dist(world, name="dist"):
    return (world["installed"] / "frontend" / name / "index.html").read_text()


def test_the_ci_build_is_installed_for_its_commit(world):
    assert _dist(world) == "<p>v1</p>"


def test_apply_pulls_installs_swaps_the_web_app_and_restarts(world):
    v2 = _push_v2(world)
    assert _apply(world) == 0
    status = _status(world)
    assert status["state"] == "done", status
    assert [s["state"] for s in status["steps"]] == ["done"] * 4
    assert next(s for s in status["steps"] if s["id"] == "frontend")["detail"] == webdist.PREBUILT
    assert _git(world["installed"], "rev-parse", "HEAD") == v2
    assert _dist(world) == "<p>v2</p>" and _dist(world, "dist.prev") == "<p>v1</p>"
    assert world["restarts"] == [v2[:7]]
    assert not (world["logs"] / updatecore.REQUEST_FILE_NAME).exists()
    assert (world["logs"] / update.LOG_NAME).read_text().count("step ") >= 8


def test_a_failed_restart_rolls_everything_back(world, monkeypatch):
    v2 = _push_v2(world)

    def restart(self, expect):
        world["restarts"].append(expect)
        if expect == v2[:7]:
            raise update.proc.Failed("did not come back")
        return "back"

    monkeypatch.setattr(update.Update, "restart", restart)
    assert _apply(world) == 1
    status = _status(world)
    assert status["state"] == "rolled_back"
    assert status["steps"][-1] == {"id": "rollback", "label": "Roll back",
                                   "state": "done", "detail": f"back on {world['v1'][:7]}"}
    assert _git(world["installed"], "rev-parse", "HEAD") == world["v1"]
    assert _dist(world) == "<p>v1</p>"
    assert world["restarts"] == [v2[:7], world["v1"][:7]]


def test_no_ci_build_and_no_node_rolls_back_and_keeps_the_live_web_app(world):
    _push_v2(world, with_web_dist=False)
    # An older build sitting in dist.prev must not replace the live one.
    stale = world["installed"] / "frontend" / "dist.prev"
    stale.mkdir(exist_ok=True)
    (stale / "index.html").write_text("<p>v0</p>")
    assert _apply(world) == 1
    status = _status(world)
    assert status["state"] == "rolled_back"
    frontend = next(s for s in status["steps"] if s["id"] == "frontend")
    assert frontend["state"] == "failed" and "no web app built" in frontend["detail"]
    assert _git(world["installed"], "rev-parse", "HEAD") == world["v1"]
    assert _dist(world) == "<p>v1</p>"


def test_without_a_ci_build_node_builds_it_here(world, monkeypatch):
    v2 = _push_v2(world, with_web_dist=False)
    monkeypatch.setattr(webdist.shutil, "which", lambda name: "/usr/bin/npm")
    built = []

    def fake_npm(*cmd, cwd=None, **kw):
        built.append(cmd[1])
        if cmd[1:] == ("run", "build"):
            (Path(cwd) / "dist").mkdir(exist_ok=True)
            (Path(cwd) / "dist" / "index.html").write_text("<p>local</p>")

    monkeypatch.setattr(webdist.proc, "run", fake_npm)
    assert _apply(world) == 0
    assert built == ["ci", "run"]
    assert next(s for s in _status(world)["steps"] if s["id"] == "frontend")["detail"] == webdist.BUILT
    assert _dist(world) == "<p>local</p>" and _dist(world, "dist.prev") == "<p>v1</p>"
    assert world["restarts"] == [v2[:7]]


def test_a_failed_local_build_puts_the_live_web_app_back(world, monkeypatch):
    _push_v2(world, with_web_dist=False)
    monkeypatch.setattr(webdist.shutil, "which", lambda name: "/usr/bin/npm")

    def broken_npm(*cmd, cwd=None, **kw):
        if cmd[1:] == ("run", "build"):
            raise update.proc.Failed("vite exploded")

    monkeypatch.setattr(webdist.proc, "run", broken_npm)
    assert _apply(world) == 1
    assert _status(world)["state"] == "rolled_back"
    assert _dist(world) == "<p>v1</p>"


def test_a_moved_checkout_changes_nothing(world):
    _push_v2(world)
    assert _apply(world, previous="0000000") == 1
    status = _status(world)
    assert status["state"] == "failed" and status["message"].startswith("Nothing was changed")
    assert _git(world["installed"], "rev-parse", "HEAD") == world["v1"]
    assert world["restarts"] == []


def test_no_request_file_is_an_error_not_a_guess(world):
    assert update.from_request(world["logs"], detached=True, argv=[]) == 1
    assert not (world["logs"] / updatecore.STATUS_FILE_NAME).exists()


def test_dev_mode_nudges_the_reloader_instead_of_restarting(world, monkeypatch, tmp_path):
    monkeypatch.undo()
    version = tmp_path / "backend" / "app" / "version.py"
    version.parent.mkdir(parents=True)
    version.write_text("")
    monkeypatch.setattr(updatecore, "REPO_ROOT", tmp_path)
    before = version.stat().st_mtime_ns
    run = update.Update(tmp_path / "logs", "aaaaaaa", 8000, "dev")
    assert "reload the page" in run.restart("bbbbbbb")
    assert version.stat().st_mtime_ns >= before
