"""`signal status`: the service, its health, where things are, the last backup."""
from app import backup, host, updatecore
from deploy.lib import health
from deploy.lib import paths as paths_lib
from deploy.lib import proc
from deploy.platforms import current as current_platform


def run() -> int:
    paths, env = paths_lib.current()
    port = paths_lib.port(env)
    state = current_platform().state()
    answer = health.get(port)
    proc.note("host", host.LABELS[host.KIND])
    proc.note("service", state)
    if answer:
        proc.note("health", answer["status"])
        proc.note("version", f"{answer.get('version')} ({answer.get('commit')})")
        proc.note("uptime", f"{answer.get('uptime_seconds', 0):,.0f}s")
        for name, ok in (answer.get("checks") or {}).items():
            proc.note(f"  {name}", "ok" if ok else "FAILING")
    else:
        proc.note("health", f"no response on 127.0.0.1:{port}")
    proc.note("address", env.get("STOCKS_OAUTH_REDIRECT_BASE") or f"http://127.0.0.1:{port}")
    proc.note("code", paths.app)
    proc.note("database", paths.db if paths.db.exists() else f"{paths.db} (not created yet)")
    proc.note("settings", paths.settings)
    proc.note("logs", paths.logs)
    last = backup.latest(paths.backups)
    proc.note("last backup", f"{last['at']} ({last['count']} kept in {paths.backups})" if last
              else f"none in {paths.backups}")
    update = updatecore.read_status(paths.logs)
    if update:
        proc.note("last update", f"{update.get('state')}: {update.get('message')}")
    return 0 if state == "running" and answer and answer["status"] == "ok" else 1
