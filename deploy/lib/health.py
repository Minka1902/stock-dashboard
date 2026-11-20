"""/api/health, the one question every command asks the running service."""
import json
import time
import urllib.request


def get(port: int, timeout: float = 5) -> dict | None:
    """The health answer, or None when nothing answers on the port."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as resp:
            return json.load(resp)
    except (OSError, ValueError):
        return None


def same_commit(a: str | None, b: str | None) -> bool:
    return bool(a and b and (a.startswith(b) or b.startswith(a)))


def wait(port: int, seconds: float, commit: str | None = None) -> dict | None:
    """Poll until the service answers (on `commit`, when given). /api/health
    is 200 even when degraded, so any answer means "the process is up"."""
    deadline = time.monotonic() + seconds
    while True:
        answer = get(port)
        if answer and (commit is None or same_commit(answer.get("commit"), commit)):
            return answer
        if time.monotonic() >= deadline:
            return None
        time.sleep(2)
