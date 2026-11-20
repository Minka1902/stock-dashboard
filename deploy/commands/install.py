"""`signal install`: idempotent install or repair, the same steps in the same
order on every host. What differs per platform is behind deploy/platforms."""
import os
import secrets
import shutil
import sys
from pathlib import Path

from app import host
from deploy.commands import backup as backup_command
from deploy.lib import envfile, health, proc
from deploy.lib import paths as paths_lib
from deploy.platforms import current as current_platform

TEMPLATE = paths_lib.REPO / "deploy" / "env.example"
MANAGE = Path("deploy") / "manage.py"
HEALTH_WAIT_SECONDS = 180
INVITE_BYTES = 18
PUBLIC_ENV = {
    # TLS is terminated in front of us, so the cookie can and must be Secure.
    "STOCKS_COOKIE_SECURE": "1",
    "STOCKS_HSTS_SECONDS": "31536000",
    # The tunnel dials loopback; only its X-Forwarded-For is believed.
    "STOCKS_TRUSTED_PROXY_IPS": "127.0.0.1,::1",
}


def _local_origin(port: int) -> str:
    # 127.0.0.1, never "localhost": uvicorn binds IPv4 only, and they are
    # separate cookie jars.
    return f"http://127.0.0.1:{port}"


def _previous_origin(previous: dict, port: int) -> str | None:
    base = previous.get("STOCKS_OAUTH_REDIRECT_BASE")
    return base if base and base != _local_origin(port) else None


def generated_env(paths, plat, port: int, origin: str | None) -> dict:
    """What the installer derives from where things live and how the app is
    reached. STOCKS_CORS_ORIGINS[0] doubles as the OAuth post-login redirect
    target (routes_oauth._frontend_origin), so the address people actually use
    goes first; the loopback origin stays for the desktop app."""
    local = _local_origin(port)
    env = {
        "STOCKS_DB_PATH": paths.db,
        "STOCKS_BACKUP_DIR": paths.backups,
        "STOCKS_LOG_DIR": paths.logs,
        "STOCKS_SETTINGS_FILE": paths.settings,
        "STOCKS_CORS_ORIGINS": f"{origin},{local}" if origin else local,
        "STOCKS_OAUTH_REDIRECT_BASE": origin or local,
        paths_lib.PORT_KEY: port,
        **(PUBLIC_ENV if origin else {}),
        **plat.extra_env(paths),
    }
    return {key: str(value) for key, value in env.items()}


def _settings(paths, opts, origin: str | None) -> str | None:
    """Create the settings file from the template (never overwrite yours) and
    decide who may sign up. Returns a freshly generated invite code, if any."""
    text = (paths.settings if paths.settings.exists() else TEMPLATE).read_text(encoding="utf-8")
    env = envfile.read(paths.settings)
    invite = None
    if opts.admin_email:
        text = envfile.with_key(text, "STOCKS_REGISTRATION", "approval")
        text = envfile.with_key(text, "STOCKS_ADMIN_EMAIL", opts.admin_email.lower())
    elif host.KIND == host.PI and not env.get("STOCKS_ADMIN_EMAIL"):
        raise proc.Failed("no admin email yet: re-run with --admin-email you@example.com")
    elif origin and "STOCKS_REGISTRATION" not in env:
        # Reachable by anyone with the URL: creating an account needs a code.
        invite = secrets.token_urlsafe(INVITE_BYTES)
        text = envfile.with_key(text, "STOCKS_REGISTRATION", "invite")
        text = envfile.with_key(text, "STOCKS_INVITE_CODE", invite)
    proc.write(paths.settings, text)
    return invite


def _move_stray_backups(paths) -> None:
    """Before STOCKS_BACKUP_DIR was set, the app wrote next to the database."""
    stray = paths.db.parent / "backups"
    if stray != paths.backups and stray.is_dir():
        for archive in stray.iterdir():
            proc.move(archive, paths.backups / archive.name)
        proc.remove(stray)


def _dependencies(paths, plat) -> None:
    user, env = plat.service_user(), plat.user_env(paths)
    python = paths_lib.venv_python(paths.app)
    if not python.exists():
        proc.run(sys.executable, "-m", "venv", python.parents[1], user=user, env=env)
    proc.run(python, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
             "-r", paths.app / "backend" / "requirements.txt", user=user, env=env)
    if os.name != "nt":
        # The hardened service can't write __pycache__ itself, and a Pi 3 would
        # otherwise recompile every module on every start.
        proc.run(python, "-m", "compileall", "-q", paths.app / "backend" / "app", user=user, env=env)


def _web_app(paths, plat, opts) -> None:
    dist = paths.app / "frontend" / "dist"
    if opts.web_dist:
        source = Path(opts.web_dist).resolve()
        if not (source / "index.html").is_file():
            raise proc.Failed(f"--web-dist {source} has no index.html")
        if source != dist.resolve():
            proc.remove(dist)
            if not proc.DRY_RUN:
                shutil.copytree(source, dist)
                if plat.service_user():
                    proc.chown(dist, plat.service_user(), recursive=True)
        return
    proc.run(sys.executable, paths.app / MANAGE, "fetch-dist",
             user=plat.service_user(), env=plat.user_env(paths))


def _resume_from(paths, argv: list[str]) -> None:
    """Carry on from the installed checkout, so every later step (and every
    later command) runs the code that is actually installed."""
    command = [sys.executable, str(paths.app / MANAGE), "install", "--resumed", *argv]
    if proc.DRY_RUN:
        proc.say(f"would continue as: {' '.join(command)}")
        return
    sys.stdout.flush()
    os.execv(sys.executable, command)


def run(opts, argv: list[str]) -> int:
    if sys.platform == "darwin":
        raise proc.Failed("macOS is not supported yet (Windows, Raspberry Pi and Linux are)")
    plat = current_platform()
    paths = paths_lib.installed()
    previous = envfile.read(paths.generated)
    port = opts.port or paths_lib.port(previous)
    proc.say(f"{host.LABELS[host.KIND]}: installing into {paths.app}")

    if not opts.resumed:
        plat.preflight(opts)
        proc.say("prerequisites")
        plat.packages(opts)
        proc.say("account, directories")
        plat.prepare(paths, opts)
        proc.say(f"code: {paths.app}")
        plat.checkout(paths, opts, lambda: backup_command.run(None))
        if paths.app.resolve() != paths_lib.REPO.resolve():
            _resume_from(paths, argv)

    proc.say("Python environment")
    _dependencies(paths, plat)

    proc.say(f"configuration: {paths.settings.parent}")
    origin = plat.origin(opts) or _previous_origin(previous, port)
    if origin and not origin.startswith("https://"):
        raise proc.Failed(f"a public origin must be https:// (got {origin})")
    invite = _settings(paths, opts, origin)
    proc.write(paths.generated, envfile.render(
        generated_env(paths, plat, port, origin),
        "Written by `signal install` on every run. Your settings file wins over it."))
    plat.protect(paths)
    _move_stray_backups(paths)

    proc.say("this machine")
    plat.tune(paths, opts)

    proc.say("web app")
    _web_app(paths, plat, opts)

    proc.say("service")
    resolved, env = paths_lib.current()
    plat.register(resolved, env, port, opts)
    plat.start(resolved)
    plat.expose(port, opts)

    proc.say("waiting for the dashboard to answer")
    answer = None if proc.DRY_RUN else health.wait(port, HEALTH_WAIT_SECONDS)
    if not answer and not proc.DRY_RUN:
        plat.logs(resolved, 40)
        raise proc.Failed("the service was registered but never answered /api/health; "
                          "the log above says why")

    proc.say(f"done: {origin or _local_origin(port)}")
    if answer:
        proc.note("health", f"{answer['status']} (version {answer.get('version')}, commit {answer.get('commit')})")
    proc.note("database", resolved.db)
    proc.note("backups", resolved.backups)
    proc.note("logs", resolved.logs)
    if invite:
        proc.note("invite code", f"{invite}  (shown once; also in the settings file)")
    plat.finish(resolved, opts)
    return 0
