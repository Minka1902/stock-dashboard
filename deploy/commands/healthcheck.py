"""`signal healthcheck`, run every two minutes by the installed monitor (a
systemd timer, or a Scheduled Task on Windows). Restarts the service after
MAX_FAILURES health checks in a row that don't answer "ok" — a hung process, a
stuck refresh thread, a dead scheduler — which restart-on-exit alone can't
catch, because the process is still alive."""
from app import updatecore
from deploy.lib import health
from deploy.lib import paths as paths_lib
from deploy.platforms import current as current_platform

MAX_FAILURES = 3
HEALTH_TIMEOUT_SECONDS = 15


def _failures(state_file) -> int:
    try:
        return int(state_file.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        return 0


def _record(state_file, failures: int) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(str(failures), encoding="ascii")


def run() -> int:
    plat = current_platform()
    paths, env = paths_lib.current()
    # Stopped on purpose (or already being restarted): not our business.
    if plat.state() != "running":
        return 0
    # An update restarts the service itself and rolls back if it doesn't come up.
    if updatecore.is_apply_running(updatecore.read_status(paths.logs)):
        print("update in progress; skipping")
        return 0
    answer = health.get(paths_lib.port(env), HEALTH_TIMEOUT_SECONDS)
    status = answer["status"] if answer else "unreachable"
    if status == "ok":
        _record(paths.health_state, 0)
        return 0
    failures = _failures(paths.health_state) + 1
    print(f"health check failed ({failures}/{MAX_FAILURES}): {status}")
    if failures < MAX_FAILURES:
        _record(paths.health_state, failures)
        return 0
    print("restarting the service")
    _record(paths.health_state, 0)
    plat.restart(paths)
    return 0
