"""`signal update`, and the work behind the in-app Update button.

  1. pull      git pull --ff-only origin main
  2. deps      pip install -r requirements.txt into the service's virtualenv
  3. frontend  the web app CI built for the new commit (built here instead
               when that isn't published and Node is installed)
  4. restart   restart the service and wait until /api/health reports the new
               commit; in dev mode, nudge `uvicorn --reload` instead

Any failure after the pull rolls back: git reset --hard <previous>, the old
packages, the previous web app, restart. Progress goes to
<log dir>/update-status.json in the schema app/updatecore.py defines and the
UI reads, and a transcript to update.log next to it.

It always runs outside the server it restarts: as its own systemd unit, or as
a detached process that has relaunched itself once so that its parent is gone
(NSSM stops a service by killing its process tree, walked by parent pid).
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from app import host, updatecore
from deploy.lib import health, proc, webdist
from deploy.lib import paths as paths_lib
from deploy.platforms import current as current_platform

HEALTH_WAIT_SECONDS = 240
TOOL_TIMEOUT_SECONDS = 900
UNIT_TIMEOUT_SECONDS = 1900
LOG_NAME = "update.log"
ERROR_RE = re.compile(r"error|fatal|failed|unexpected|cannot|not found|denied|conflict|abort", re.I)


class Update:
    """One update run: its log, its status file, and the steps."""

    def __init__(self, log_dir: Path, previous: str, port: int, mode: str):
        self.log_dir, self.previous, self.port, self.mode = Path(log_dir), previous, port, mode
        self.python = paths_lib.venv_python(updatecore.REPO_ROOT)
        self.status = updatecore.initial_status(previous, None, mode)
        self.status["message"] = "updating"
        self.swapped = False
        self._save()

    # ---------- log and status ----------

    def log(self, message: str) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        with (self.log_dir / LOG_NAME).open("a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {message}\n")

    def _save(self) -> None:
        self.status["updated_at"] = updatecore.now_iso()
        updatecore.write_json(self.log_dir / updatecore.STATUS_FILE_NAME, self.status)

    def step(self, sid: str, state: str, detail: str = "") -> None:
        for step in self.status["steps"]:
            if step["id"] == sid:
                step["state"] = state
                if detail:
                    step["detail"] = detail
        self.log(f"step {sid} -> {state} {detail}")
        self._save()

    def finish(self, state: str, message: str) -> int:
        self.status.update(state=state, message=message, finished_at=updatecore.now_iso())
        self._save()
        self.log(f"finished: {state} - {message}")
        return 0 if state == "done" else 1

    # ---------- tools ----------

    def run(self, *cmd, cwd: Path | None = None) -> str:
        """Run a tool in the repo, log its output, return stdout; raise
        proc.Failed with the lines worth showing in the UI."""
        self.log("> " + " ".join(map(str, cmd)))
        try:
            done = subprocess.run(
                [str(c) for c in cmd], cwd=cwd or updatecore.REPO_ROOT, capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=TOOL_TIMEOUT_SECONDS,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"},
                creationflags=host.creationflags())
        except (OSError, subprocess.TimeoutExpired) as exc:
            self.log(f"    {exc}")
            raise proc.Failed(str(exc)) from exc
        output = (done.stdout or "") + (done.stderr or "")
        for line in output.splitlines():
            self.log(f"    {line}")
        if done.returncode != 0:
            lines = [ln.strip() for ln in output.splitlines() if ln.strip()]
            errors = [ln for ln in lines if ERROR_RE.search(ln)]
            raise proc.Failed(" | ".join(errors[:4] or lines[-3:]) or "no output")
        return done.stdout

    def git(self, *args) -> str:
        return self.run("git", "-c", f"safe.directory={updatecore.REPO_ROOT.as_posix()}", *args).strip()

    def install_deps(self) -> None:
        backend = updatecore.REPO_ROOT / "backend"
        pip = (self.python, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
               "-r", "requirements.txt")
        try:
            self.run(*pip, cwd=backend)
        except proc.Failed:
            if os.name != "nt" or self.mode != host.SERVICE:
                raise
            # Windows won't let pip replace a compiled extension the running
            # server has loaded. Stop it and retry; the restart step starts it.
            self.log("pip failed with the service running; stopping it and retrying")
            current_platform().stop(paths_lib.current()[0])
            self.run(*pip, cwd=backend)
        if os.name != "nt":
            # Byte-compile now: the hardened service can't write __pycache__.
            subprocess.run([str(self.python), "-m", "compileall", "-q", "app"], cwd=backend, check=False)

    def install_web_app(self, commit: str) -> str:
        how = webdist.install(commit)
        self.swapped = True
        return how

    def restart(self, expect: str) -> str:
        if self.mode != host.SERVICE:
            # uvicorn --reload watches backend/app. The pull already touched
            # files there, but that reload may have fired before pip finished;
            # touching version.py forces one more with the new packages in.
            (updatecore.REPO_ROOT / "backend" / "app" / "version.py").touch()
            return "reload the page once the dev server has restarted"
        paths, _ = paths_lib.current()
        current_platform().restart(paths)
        if not health.wait(self.port, HEALTH_WAIT_SECONDS, expect):
            raise proc.Failed(f"the service did not come back on port {self.port} with commit "
                              f"{expect} within {HEALTH_WAIT_SECONDS}s")
        return f"the service is back on {expect}"

    # ---------- the run ----------

    def rollback(self, failed: str, reason: str, previous_full: str) -> int:
        self.step(failed, "failed", reason)
        self.status["steps"].append({"id": "rollback", "label": "Roll back", "state": "running", "detail": ""})
        self._save()
        problems = []
        for what, action in (
            ("git reset", lambda: self.git("reset", "--hard", previous_full)),
            ("reinstalling the old packages", self.install_deps),
            # Only when this run replaced it: before that, dist.prev is an
            # older build than the one being served.
            ("restoring the previous web app", lambda: self.swapped and webdist.restore()),
            ("restarting", lambda: self.restart(self.previous)),
        ):
            try:
                action()
            except Exception as exc:  # noqa: BLE001 - every problem is reported, none aborts
                problems.append(f"{what} failed: {exc}")
        rolled = self.status["steps"][-1]
        if not problems:
            rolled.update(state="done", detail=f"back on {self.previous}")
            return self.finish("rolled_back", f"Update failed at '{failed}': {reason}. "
                                              f"Rolled back to {self.previous}.")
        rolled.update(state="failed", detail="; ".join(problems))
        return self.finish("failed", f"Update failed at '{failed}': {reason}. ROLLBACK INCOMPLETE - "
                                     f"{'; '.join(problems)}. See {self.log_dir / LOG_NAME}.")

    def apply(self) -> int:
        self.log(f"worker started: repo={updatecore.REPO_ROOT} previous={self.previous} mode={self.mode}")
        try:
            head = self.git("rev-parse", "HEAD")
            previous_full = self.git("rev-parse", "--verify", f"{self.previous}^{{commit}}")
        except proc.Failed as exc:
            self.step("pull", "failed", str(exc))
            return self.finish("failed", f"Nothing was changed: {exc}")
        if head != previous_full:
            self.step("pull", "failed", f"HEAD is {head[:7]}, expected {self.previous}")
            return self.finish("failed", "Nothing was changed: the checkout moved since the update "
                                         "was requested.")
        if not self.python.exists():
            self.step("pull", "failed", f"the backend virtualenv is missing ({self.python})")
            return self.finish("failed", "Nothing was changed: the backend virtualenv is missing.")

        self.step("pull", "running")
        try:
            self.git("pull", "--ff-only", updatecore.REMOTE, updatecore.BRANCH)
        except proc.Failed as exc:
            if self.git("rev-parse", "HEAD") == previous_full:
                self.step("pull", "failed", str(exc))
                return self.finish("failed", f"Nothing was changed: git pull failed ({exc}).")
            return self.rollback("pull", str(exc), previous_full)
        new_full = self.git("rev-parse", "HEAD")
        new = new_full[:7]
        self.status.update(new_commit=new, target_commit=new)
        self.step("pull", "done", f"{self.previous} -> {new}")

        for sid, action in (
            ("deps", self.install_deps),
            ("frontend", lambda: self.install_web_app(new_full)),
            ("restart", lambda: self.restart(new)),
        ):
            self.step(sid, "running")
            try:
                detail = action()
            except Exception as exc:  # noqa: BLE001 - anything after the pull rolls back
                return self.rollback(sid, str(exc) or type(exc).__name__, previous_full)
            self.step(sid, "done", detail or "")
        return self.finish("done", f"Updated {self.previous} -> {new}.")


def _relaunch_detached(argv: list[str]) -> None:
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    kwargs = dict(cwd=str(updatecore.REPO_ROOT), stdin=subprocess.DEVNULL,
                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    cmd = [sys.executable, str(Path(__file__).resolve().parents[1] / "manage.py"), *argv, "--detached"]
    try:
        subprocess.Popen(cmd, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kwargs)
    except OSError:
        subprocess.Popen(cmd, creationflags=flags, **kwargs)


def from_request(log_dir: Path | None, detached: bool, argv: list[str]) -> int:
    """Run the update a request file asks for (what the app hands off to)."""
    if os.name == "nt" and not detached:
        _relaunch_detached(argv)
        return 0
    log_dir = Path(log_dir or os.environ.get("STOCKS_LOG_DIR") or paths_lib.current()[0].logs)
    request_file = log_dir / updatecore.REQUEST_FILE_NAME
    try:
        request = json.loads(request_file.read_text(encoding="utf-8"))
        request_file.unlink()
    except (OSError, ValueError) as exc:
        print(f"no usable update request in {log_dir}: {exc}", file=sys.stderr)
        return 1
    return Update(log_dir, request["previous_commit"], int(request.get("port") or paths_lib.DEFAULT_PORT),
                  request.get("mode") or host.SERVICE).apply()


def run(opts) -> int:
    """`signal update` from a terminal: the same preconditions the app
    applies (on main, no local changes, can fast-forward), then the same run."""
    check = updatecore.run_check()
    if not check["can_apply"]:
        proc.say(check["blocked_reason"])
        return 0 if check["ok"] and not check["behind"] else 1
    plat = current_platform()
    paths, env = paths_lib.current()
    if updatecore.is_apply_running(updatecore.read_status(paths.logs)):
        raise proc.Failed("an update is already running")
    proc.say(f"{check['behind']} new commit(s): {check['current_commit']} -> {check['remote_commit']}")
    installed = plat.state() != "absent"
    request = {"previous_commit": check["current_commit"], "port": paths_lib.port(env),
               "mode": host.SERVICE if installed else host.DEV}
    log_dir = paths.logs if installed else updatecore.REPO_ROOT / "backend" / "logs"
    if installed and host.KIND != host.WINDOWS:
        # Through the unit, so the pull runs as the service account and owns
        # what it writes.
        updatecore.write_json(log_dir / updatecore.REQUEST_FILE_NAME, request)
        proc.run("systemctl", "start", host.UPDATE_UNIT, check=False)
        deadline = time.monotonic() + UNIT_TIMEOUT_SECONDS
        while updatecore.is_apply_running(updatecore.read_status(log_dir)) and time.monotonic() < deadline:
            time.sleep(2)
        status = updatecore.read_status(log_dir) or {}
    else:
        update = Update(log_dir, request["previous_commit"], request["port"], request["mode"])
        update.apply()
        status = update.status
    for step in status.get("steps", []):
        proc.note(step["label"], f"{step['state']}  {step['detail']}".rstrip())
    proc.say(status.get("message") or "no status was written; see the update log")
    return 0 if status.get("state") == "done" else 1
