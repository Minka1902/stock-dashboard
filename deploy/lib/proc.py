"""Console output and every side effect the tool has. With DRY_RUN on, each
change is printed instead of made, so `install --dry-run` is the full list of
what an install would do."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

DRY_RUN = False
TIMEOUT_SECONDS = 1800

_COLOR = sys.stdout.isatty() and os.name != "nt"


class Failed(RuntimeError):
    """A step failed; the message is what the user should read."""


def _paint(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text


def say(message: str) -> None:
    print(f"{_paint('1;36', '==>')} {message}", flush=True)


def note(label: str, value) -> None:
    print(f"  {label:<14}{value}", flush=True)


def warn(message: str) -> None:
    print(f"{_paint('1;33', 'warning:')} {message}", file=sys.stderr, flush=True)


def _would(what: str) -> None:
    print(f"    would {what}", flush=True)


def _as_user(cmd: tuple, user: str | None) -> list[str]:
    cmd = [str(c) for c in cmd]
    return ["runuser", "-u", user, "--", *cmd] if user and os.name != "nt" else cmd


def run(*cmd, user: str | None = None, cwd=None, env: dict | None = None,
        check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    """Run a command that changes something. Output goes to the console unless
    `capture`; a non-zero exit raises Failed unless `check` is off."""
    argv = _as_user(cmd, user)
    if DRY_RUN:
        _would("run: " + " ".join(argv))
        return subprocess.CompletedProcess(argv, 0, "", "")
    try:
        proc = subprocess.run(
            argv, cwd=cwd, env={**os.environ, **env} if env else None, text=True,
            capture_output=capture, timeout=TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Failed(f"{argv[0]}: {exc}") from exc
    if check and proc.returncode != 0:
        detail = ((proc.stderr or proc.stdout or "").strip().splitlines() or [""])[-1] if capture else ""
        raise Failed(f"{' '.join(argv)} failed (exit {proc.returncode})" + (f": {detail}" if detail else ""))
    return proc


def query(*cmd, user: str | None = None, cwd=None) -> subprocess.CompletedProcess:
    """Run a read-only command (also in a dry run). Never raises: a missing
    tool reads as exit 127 with empty output."""
    argv = _as_user(cmd, user)
    try:
        return subprocess.run(argv, cwd=cwd, text=True, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return subprocess.CompletedProcess(argv, 127, "", str(exc))


def write(path: Path, text: str, mode: int | None = None) -> None:
    if DRY_RUN:
        _would(f"write {path} ({len(text.splitlines())} lines)")
        return
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    if mode is not None:
        os.chmod(path, mode)


def makedirs(*paths: Path) -> None:
    for path in paths:
        if DRY_RUN:
            _would(f"create directory {path}")
        else:
            Path(path).mkdir(parents=True, exist_ok=True)


def copy(src: Path, dst: Path) -> None:
    if DRY_RUN:
        _would(f"copy {src} -> {dst}")
        return
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def move(src: Path, dst: Path) -> None:
    if DRY_RUN:
        _would(f"move {src} -> {dst}")
        return
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def remove(*paths: Path) -> None:
    """Delete files or whole directories; missing ones are fine."""
    for path in map(Path, paths):
        if DRY_RUN:
            _would(f"delete {path}")
        elif path.is_dir() and not path.is_symlink():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)


def chown(path: Path, user: str, recursive: bool = False) -> None:
    if os.name != "nt":
        run("chown", *(["-R"] if recursive else []), f"{user}:{user}", path)
