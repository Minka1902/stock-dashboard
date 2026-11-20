"""The stdlib-only half of the updater: git inspection and the status file.

app/updater.py (the check cache, the scheduler job, the hand-off) and
deploy/commands/update.py (the work itself) both build on this, so "can this
checkout fast-forward?" and "is an update running?" have one implementation.
Stdlib only: deploy/ runs without the virtualenv.

Nothing here ever invents a status. If git is missing, or GitHub can't be
reached, the check says exactly that and reports no update.

Every git call passes `-c safe.directory=<repo>`: git refuses ("dubious
ownership") to touch a tree owned by another account than the one running it,
which is the normal case for a LocalSystem service.
"""
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from app import host

# backend/app/updatecore.py -> repo root is three levels up.
REPO_ROOT = Path(__file__).resolve().parents[2]
REMOTE = "origin"
BRANCH = "main"

FETCH_TIMEOUT_SECONDS = 30
GIT_TIMEOUT_SECONDS = 10
MAX_COMMITS = 50
MAX_DIRTY_FILES = 20
# A "running" status file older than this is treated as a dead updater (the
# machine rebooted mid-update, say) rather than blocking updates forever.
STALE_RUN_SECONDS = 30 * 60

STATUS_FILE_NAME = "update-status.json"
REQUEST_FILE_NAME = "update-request.json"

STEPS = [
    ("pull", "Pull from GitHub"),
    ("deps", "Install Python packages"),
    ("frontend", "Update the web app"),
    ("restart", "Restart"),
]

_FIELD_SEP = "\x1f"
_LOG_FORMAT = "%h%x1f%s%x1f%an%x1f%cI"
_VERSION_RE = re.compile(r"""^__version__\s*=\s*["']([^"']+)["']""", re.MULTILINE)


class GitError(RuntimeError):
    """A git invocation failed; the message is safe to show to the user."""


# ---------- pure helpers (unit-tested directly) ----------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_log(text: str) -> list[dict]:
    """Parse `git log --format=%h%x1f%s%x1f%an%x1f%cI` output."""
    out = []
    for line in text.splitlines():
        parts = line.split(_FIELD_SEP)
        if len(parts) != 4:
            continue  # never guess at a malformed record
        sha, subject, author, date = (p.strip() for p in parts)
        out.append({"sha": sha, "subject": subject, "author": author, "date": date})
    return out


def parse_count(text: str) -> int:
    try:
        return max(0, int(text.strip()))
    except ValueError as exc:
        raise GitError(f"unexpected git output: {text.strip()[:80]!r}") from exc


def parse_porcelain(text: str) -> list[str]:
    """Paths with tracked modifications from `git status --porcelain=v1`.

    Untracked files (`??`) and ignored (`!!`) are skipped: they don't stop a
    fast-forward unless a pulled file collides with one, and in that case
    `git pull --ff-only` refuses on its own and the updater rolls back.
    """
    return [line[3:].strip() for line in text.splitlines()
            if len(line) >= 4 and not line.startswith(("??", "!!"))]


def parse_version(source: str) -> str | None:
    match = _VERSION_RE.search(source or "")
    return match.group(1) if match else None


def parse_branch(text: str) -> str | None:
    name = text.strip()
    return None if not name or name == "HEAD" else name


def blocked_reason(check: dict) -> str | None:
    """Why a one-click update can't run right now, or None if it can.

    Ordered so the most fundamental problem is the one reported.
    """
    if not check["ok"]:
        return check["error"] or "the update check failed"
    if check["behind"] == 0:
        return "already up to date"
    if check["branch"] != BRANCH:
        where = f"branch '{check['branch']}'" if check["branch"] else "a detached HEAD"
        return f"the server is on {where}, not '{BRANCH}' — switch branches by hand to update"
    if check["dirty_count"]:
        return (f"{check['dirty_count']} tracked file(s) have local changes — "
                "commit or discard them first")
    if check["ahead"]:
        return (f"this checkout has {check['ahead']} local commit(s) not on {REMOTE}/{BRANCH}, "
                "so it can't fast-forward — merge by hand")
    return None


def friendly_fetch_error(stderr: str) -> str:
    lines = [ln.strip() for ln in (stderr or "").splitlines() if ln.strip()]
    return f"could not reach GitHub: {lines[-1] if lines else 'no output from git'}"


# ---------- git ----------

def git(*args: str, timeout: int = GIT_TIMEOUT_SECONDS) -> str:
    cmd = ["git", "-c", f"safe.directory={REPO_ROOT.as_posix()}", *args]
    # Never block on a credential prompt.
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    try:
        proc = subprocess.run(
            cmd, cwd=str(REPO_ROOT), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout, env=env,
            creationflags=host.creationflags(),
        )
    except FileNotFoundError as exc:
        raise GitError("git is not installed or not on the server's PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git {args[0]} timed out after {timeout}s") from exc
    if proc.returncode != 0:
        err = GitError((proc.stderr or proc.stdout or "").strip() or f"git {args[0]} failed")
        err.stderr = proc.stderr or ""
        raise err
    return proc.stdout


def head_short() -> str | None:
    try:
        return git("rev-parse", "--short", "HEAD").strip() or None
    except GitError:
        return None


def run_check() -> dict:
    """Compare HEAD with origin/main. Every key is always present."""
    check = {
        "checked_at": now_iso(), "ok": False, "error": None,
        "current_commit": None, "branch": None, "remote": f"{REMOTE}/{BRANCH}",
        "remote_commit": None, "behind": 0, "ahead": 0,
        "commits": [], "commits_truncated": False, "latest_version": None,
        "dirty_files": [], "dirty_count": 0,
        "update_available": False, "can_apply": False, "blocked_reason": None,
    }
    try:
        check["current_commit"] = git("rev-parse", "--short", "HEAD").strip()
        check["branch"] = parse_branch(git("rev-parse", "--abbrev-ref", "HEAD"))
        dirty = parse_porcelain(git("status", "--porcelain=v1", "--untracked-files=no"))
    except GitError as exc:
        check["error"] = check["blocked_reason"] = f"git unavailable: {exc}"
        return check
    check["dirty_count"] = len(dirty)
    check["dirty_files"] = dirty[:MAX_DIRTY_FILES]

    try:
        git("fetch", "--quiet", REMOTE, BRANCH, timeout=FETCH_TIMEOUT_SECONDS)
    except GitError as exc:
        msg = str(exc)
        if "not installed" in msg:
            check["error"] = msg
        elif "timed out" in msg:
            check["error"] = f"could not reach GitHub: {msg}"
        else:
            check["error"] = friendly_fetch_error(getattr(exc, "stderr", "") or msg)
        check["blocked_reason"] = check["error"]
        return check

    upstream = f"{REMOTE}/{BRANCH}"
    try:
        check["remote_commit"] = git("rev-parse", "--short", upstream).strip()
        check["behind"] = parse_count(git("rev-list", "--count", f"HEAD..{upstream}"))
        check["ahead"] = parse_count(git("rev-list", "--count", f"{upstream}..HEAD"))
        if check["behind"]:
            check["commits"] = parse_log(git(
                "log", f"--max-count={MAX_COMMITS}", f"--format={_LOG_FORMAT}",
                f"HEAD..{upstream}"))
            check["commits_truncated"] = check["behind"] > len(check["commits"])
        try:
            check["latest_version"] = parse_version(
                git("show", f"{upstream}:backend/app/version.py"))
        except GitError:
            pass  # file moved/absent upstream: say nothing
    except GitError as exc:
        check["error"] = check["blocked_reason"] = f"git failed: {exc}"
        return check

    check["ok"] = True
    check["update_available"] = check["behind"] > 0
    check["blocked_reason"] = blocked_reason(check)
    check["can_apply"] = check["blocked_reason"] is None
    return check


# ---------- the status and request files ----------

def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def read_status(log_dir: Path) -> dict | None:
    path = Path(log_dir) / STATUS_FILE_NAME
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        return {"state": "unknown", "message": f"status file unreadable: {exc}"}


def _parse_iso(value) -> datetime | None:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_apply_running(status: dict | None) -> bool:
    if not status or status.get("state") != "running":
        return False
    updated = _parse_iso(status.get("updated_at") or status.get("started_at"))
    if updated is None:
        return False
    return (datetime.now(timezone.utc) - updated).total_seconds() < STALE_RUN_SECONDS


def initial_status(previous: str, target: str | None, mode: str) -> dict:
    now = now_iso()
    return {
        "state": "running",
        "mode": mode,
        "started_at": now,
        "updated_at": now,
        "finished_at": None,
        "previous_commit": previous,
        "target_commit": target,
        "new_commit": None,
        "message": "starting the updater",
        "steps": [{"id": sid, "label": label, "state": "pending", "detail": ""}
                  for sid, label in STEPS],
    }
