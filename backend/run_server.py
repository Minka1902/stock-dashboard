"""Supervised uvicorn launcher.

Runs the API as a child process, logs how it exited, and restarts it with
backoff. The app is a single in-process worker holding the scheduler, the TTL
caches, the rate limiter and the SQLite connections, so if it dies there is
nothing else to take over — previously it just stopped, silently, and the only
evidence went to a console window that had already been closed.

Usage:
    python run_server.py [--port 8000] [--host 127.0.0.1] [--reload]
                         [--max-restarts N] [--no-supervise]
"""
import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

BACKOFF_SECONDS = [2, 5, 10, 30, 60]
# A crash within this many seconds of starting counts as "failed to start"
# rather than "ran and later died", and escalates the backoff.
FAST_FAIL_SECONDS = 20

logger = logging.getLogger("supervisor")


def _uvicorn_command(args) -> list[str]:
    cmd = [
        sys.executable, "-m", "uvicorn", "app.main:app",
        "--host", args.host, "--port", str(args.port),
    ]
    if args.reload:
        # --reload-dir keeps the watcher off .venv and the SQLite files.
        cmd += ["--reload", "--reload-dir", "app"]
    return cmd


def _setup_logging(log_dir: Path) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_dir / "supervisor.log", encoding="utf-8"))
    except OSError:
        pass  # console-only is better than refusing to start
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s supervisor: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--max-restarts", type=int, default=10)
    parser.add_argument(
        "--no-supervise", action="store_true",
        help="exec uvicorn directly, without the restart loop")
    args = parser.parse_args()

    # Run from backend/ so the relative default STOCKS_DB_PATH resolves the same
    # way it does when uvicorn is started by hand.
    os.chdir(Path(__file__).resolve().parent)

    log_dir = Path(os.environ.get("STOCKS_LOG_DIR") or (Path.cwd() / "logs"))
    _setup_logging(log_dir)

    cmd = _uvicorn_command(args)

    if args.no_supervise:
        return subprocess.call(cmd)

    restarts = 0
    while True:
        started = time.monotonic()
        logger.info("starting: %s", " ".join(cmd))
        try:
            code = subprocess.call(cmd)
        except KeyboardInterrupt:
            logger.info("interrupted; shutting down")
            return 0
        uptime = time.monotonic() - started

        if code == 0:
            logger.info("exited cleanly after %.1fs", uptime)
            return 0

        # A long-running process that dies gets a fresh restart budget; one that
        # dies immediately is almost certainly misconfigured, and retrying it
        # ten times in a row just fills the log.
        if uptime >= FAST_FAIL_SECONDS:
            restarts = 0
        logger.error("exited with code %s after %.1fs", code, uptime)

        if restarts >= args.max_restarts:
            logger.critical(
                "giving up after %s consecutive fast failures — see backend.log",
                restarts)
            return code

        delay = BACKOFF_SECONDS[min(restarts, len(BACKOFF_SECONDS) - 1)]
        restarts += 1
        logger.info("restarting in %ss (attempt %s)", delay, restarts)
        try:
            time.sleep(delay)
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    sys.exit(main())
