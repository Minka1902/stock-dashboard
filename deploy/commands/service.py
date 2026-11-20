"""`signal start | stop | restart | logs`."""
from deploy.lib import health, proc
from deploy.lib import paths as paths_lib
from deploy.platforms import current as current_platform

HEALTH_WAIT_SECONDS = 120


def run(action: str, lines: int) -> int:
    plat = current_platform()
    paths, env = paths_lib.current()
    if action == "logs":
        plat.logs(paths, lines)
        return 0
    if plat.state() == "absent":
        raise proc.Failed("the service is not installed: run `signal install`")
    if action == "stop":
        plat.stop(paths)
        proc.say("stopped")
        return 0
    # `start` and `restart` are one thing: both end with the service running
    # on the settings file as it is now.
    plat.restart(paths)
    answer = None if proc.DRY_RUN else health.wait(paths_lib.port(env), HEALTH_WAIT_SECONDS)
    if not answer and not proc.DRY_RUN:
        plat.logs(paths, 40)
        raise proc.Failed("the service started but never answered /api/health")
    proc.say(f"running ({answer['status']})" if answer else "would restart the service")
    return 0
