"""Linux, Raspberry Pi included: a hardened systemd service under its own
account, a timer that restarts it when its health check keeps failing, and a
separate unit for updates."""
import json
import os
import shutil
import sys

from app import host
from deploy.lib import paths as paths_lib
from deploy.lib import proc
from deploy.platforms import pi

USER = paths_lib.SERVICE_USER
UNIT = host.SYSTEMD_UNIT
TIMER = "stocks-healthcheck.timer"
UNITS = (UNIT, host.UPDATE_UNIT, "stocks-healthcheck.service", TIMER)
UNIT_DIR = "/etc/systemd/system"
POLKIT_RULE = "50-stocks-dashboard.rules"
POLKIT_DIR = "/etc/polkit-1/rules.d"
TEMPLATES = paths_lib.REPO / "deploy" / "units"
COMMAND = "signal"

# apt name -> dnf name
PACKAGES = {"git": "git", "curl": "curl", "python3-venv": "python3", "poppler-utils": "poppler-utils",
            "polkitd": "polkit"}
BROWSER_PACKAGE = "chromium"


def preflight(opts) -> None:
    if os.geteuid() != 0:
        raise proc.Failed("run it with sudo")
    if host.KIND == host.PI:
        pi.preflight()
    if _uses_tailscale(opts) and not shutil.which("tailscale"):
        raise proc.Failed("Tailscale is not installed: curl -fsSL https://tailscale.com/install.sh | sh")


def _install_packages(names: list[str], required: bool) -> None:
    if shutil.which("apt-get"):
        cmd = ["apt-get", "install", "-y", "-qq", *names]
        env = {"DEBIAN_FRONTEND": "noninteractive"}
    elif shutil.which("dnf"):
        cmd, env = ["dnf", "install", "-y", "-q", *(PACKAGES.get(n, n) for n in names)], None
    else:
        proc.warn(f"no apt or dnf here: install these yourself: {' '.join(names)}")
        return
    result = proc.run(*cmd, env=env, check=required)
    if result.returncode != 0:
        proc.warn(f"could not install {' '.join(names)}; continuing without")


def packages(opts) -> None:
    if shutil.which("apt-get"):
        proc.run("apt-get", "update", "-qq")
    _install_packages(list(PACKAGES), required=True)
    if "browser" not in opts.without:
        # Only the margin-debt source's headless tier needs it; without it that
        # tier reports "headless browser not installed" in the source status.
        _install_packages([BROWSER_PACKAGE], required=False)


def prepare(paths, opts) -> None:
    if proc.query("id", "-u", USER).returncode != 0:
        proc.run("useradd", "--system", "--user-group", "--home-dir", paths.data,
                 "--shell", "/usr/sbin/nologin", USER)
    for directory in (paths.data, paths.db.parent, paths.backups, paths.logs, paths.app):
        proc.run("install", "-d", "-o", USER, "-g", USER, directory)
    proc.run("install", "-d", "-o", "root", "-g", USER, "-m", "750", paths.settings.parent)


def service_user() -> str:
    return USER


def user_env(paths) -> dict:
    # runuser keeps root's HOME, which the service account cannot write to.
    return {"HOME": str(paths.data)}


def _same_repo(a: str, b: str) -> bool:
    return a.strip().lower().removesuffix(".git").rstrip("/") == b.strip().lower().removesuffix(".git").rstrip("/")


def checkout(paths, opts, backup_first) -> None:
    """Clone the code, or leave an existing checkout where it is. One that
    still follows another repository (the retired stock-dashboard-PI) is
    re-pointed: its history is unrelated, so this is a deliberate checkout of
    the new branch, never a pull, and only with no local edits to lose."""
    app = paths.app
    git = ("git", "-C", app)
    if not (app / ".git").exists():
        proc.run("git", "clone", "--quiet", "--branch", opts.branch, opts.repo, app, user=USER)
        return
    origin = proc.query(*git, "remote", "get-url", "origin", user=USER).stdout
    if _same_repo(origin, opts.repo):
        if proc.run(*git, "fetch", "--quiet", "origin", user=USER, check=False).returncode != 0:
            proc.warn("could not fetch; keeping the current checkout")
        return
    proc.say(f"moving this install from {origin.strip()} to {opts.repo}")
    dirty = proc.query(*git, "status", "--porcelain", "--untracked-files=no", user=USER).stdout.strip()
    if dirty:
        raise proc.Failed(f"{app} has local edits; commit or discard them first:\n{dirty}")
    backup_first()
    proc.run(*git, "remote", "set-url", "origin", opts.repo, user=USER)
    proc.run(*git, "fetch", "--quiet", "origin", opts.branch, user=USER)
    proc.run(*git, "checkout", "--quiet", "-B", opts.branch, f"origin/{opts.branch}", user=USER)


def _uses_tailscale(opts) -> bool:
    return opts.tailscale or (host.KIND == host.PI and not opts.public_origin)


def origin(opts) -> str | None:
    """The address people reach the dashboard on, when the installer sets one
    up: the machine's tailnet name. None = local only (or --public-origin)."""
    if not _uses_tailscale(opts):
        return opts.public_origin
    try:
        name = json.loads(proc.query("tailscale", "status", "--json").stdout)["Self"]["DNSName"].rstrip(".")
    except (ValueError, KeyError, TypeError):
        name = ""
    if not name:
        if proc.DRY_RUN:
            return "https://<this-machine>.<tailnet>.ts.net"
        raise proc.Failed("Tailscale is not logged in, or MagicDNS is off: sudo tailscale up")
    return f"https://{name}"


def extra_env(paths) -> dict:
    return {}


def protect(paths) -> None:
    """Settings hold API keys: root writes, the service account reads."""
    for path in (paths.settings, paths.generated):
        proc.run("chown", f"root:{USER}", path)
        proc.run("chmod", "640", path)


def tune(paths, opts) -> None:
    opts.reboot = host.KIND == host.PI and pi.tune()


def render(template: str, paths, port: int) -> str:
    text = (TEMPLATES / template).read_text(encoding="utf-8")
    for key, value in {
        "@APP@": paths.app, "@DATA@": paths.data, "@LOGS@": paths.logs, "@BACKUPS@": paths.backups,
        "@SETTINGS@": paths.settings, "@GENERATED@": paths.generated, "@USER@": USER,
        "@PORT@": port, "@PYTHON@": sys.executable,
    }.items():
        text = text.replace(key, str(value))
    return text


def register(paths, env: dict, port: int, opts) -> None:
    for unit in UNITS:
        proc.write(f"{UNIT_DIR}/{unit}", render(unit, paths, port), 0o644)
    proc.write(f"{POLKIT_DIR}/{POLKIT_RULE}", render(POLKIT_RULE, paths, port), 0o644)
    proc.write(paths.bin / COMMAND,
               f'#!/bin/sh\nexec "{sys.executable}" "{paths.app}/deploy/manage.py" "$@"\n', 0o755)
    proc.run("systemctl", "daemon-reload")
    proc.run("systemctl", "enable", UNIT, TIMER)


def start(paths) -> None:
    proc.run("systemctl", "restart", UNIT)
    proc.run("systemctl", "start", TIMER)


def expose(port: int, opts) -> None:
    if _uses_tailscale(opts):
        result = proc.run("tailscale", "serve", "--bg", "--https=443", f"http://127.0.0.1:{port}",
                          check=False, capture=True)
        if result.returncode != 0:
            raise proc.Failed("tailscale serve failed: enable HTTPS certificates for the tailnet "
                              "(admin console -> DNS)")


def finish(paths, opts) -> None:
    proc.note("settings", f"sudo nano {paths.settings}, then: sudo {COMMAND} restart")
    if getattr(opts, "reboot", False):
        proc.warn("reboot once to enable the hardware watchdog: sudo reboot")


def state() -> str:
    if proc.query("systemctl", "is-active", "--quiet", UNIT).returncode == 0:
        return "running"
    return "stopped" if proc.query("systemctl", "cat", UNIT).returncode == 0 else "absent"


def stop(paths) -> None:
    proc.run("systemctl", "stop", UNIT)


def restart(paths) -> None:
    proc.run("systemctl", "restart", UNIT, capture=True)


def logs(paths, lines: int) -> None:
    proc.run("journalctl", "-u", UNIT, "-n", lines, "--no-pager", check=False)


def unregister(paths, purge: bool) -> None:
    proc.run("systemctl", "disable", "--now", TIMER, UNIT, check=False, capture=True)
    proc.remove(*(f"{UNIT_DIR}/{unit}" for unit in UNITS), f"{POLKIT_DIR}/{POLKIT_RULE}",
                paths.bin / COMMAND)
    proc.run("systemctl", "daemon-reload")
    if shutil.which("tailscale"):
        proc.run("tailscale", "serve", "--https=443", "off", check=False, capture=True)
    proc.remove(paths.app)
    if purge:
        proc.remove(paths.data, paths.logs, paths.settings.parent)
        proc.run("userdel", USER, check=False, capture=True)
