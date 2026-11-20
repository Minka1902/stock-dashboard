#!/usr/bin/env python3
"""signal: install, update, back up, restore and control the Stock Signal
Dashboard on Windows, a Raspberry Pi or any systemd Linux.

One tool, the same commands everywhere; it works out which machine it is on
(backend/app/host.py) and uses that platform's service manager. Standard
library only, so it runs before the virtualenv exists and when it is broken.
See deploy/README.md.
"""
import argparse
import sys
from pathlib import Path

if sys.version_info < (3, 11):
    sys.exit("Python 3.11 or newer is required")

REPO = Path(__file__).resolve().parents[1]
# Run as a script, sys.path[0] is deploy/ itself; the packages live one up.
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != REPO / "deploy"]
sys.path[:0] = [str(REPO), str(REPO / "backend")]

from app import updatecore  # noqa: E402
from deploy.commands import (  # noqa: E402
    backup, healthcheck, install, restore, service, status, uninstall, update)
from deploy.lib import paths, proc, webdist  # noqa: E402

COMPONENTS = ("desktop", "browser")
SERVICE_ACTIONS = ("start", "stop", "restart", "logs")


def _components(value: str) -> set[str]:
    chosen = {c.strip() for c in value.split(",") if c.strip()}
    unknown = chosen - set(COMPONENTS)
    if unknown:
        raise argparse.ArgumentTypeError(f"unknown component(s): {', '.join(sorted(unknown))}")
    return chosen


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="signal", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True, metavar="command")

    p = sub.add_parser("install", help="install or repair (safe to re-run)")
    p.add_argument("--admin-email", help="the account that is admin; turns on approval sign-up "
                                         "(required on a Raspberry Pi)")
    p.add_argument("--public-origin", help="the https:// address people reach it on, when you "
                                           "run your own tunnel")
    p.add_argument("--tailscale", action="store_true",
                   help="serve it on this machine's tailnet name (the default on a Raspberry Pi)")
    p.add_argument("--port", type=int, help=f"default {paths.DEFAULT_PORT}; bound to 127.0.0.1 only")
    p.add_argument("--without", type=_components, default=set(), metavar="LIST",
                   help=f"comma-separated parts to skip: {', '.join(COMPONENTS)}")
    p.add_argument("--web-dist", metavar="DIR", help="use this built web app instead of downloading one")
    p.add_argument("--nssm", metavar="EXE", help="Windows: an nssm.exe you already trust")
    p.add_argument("--import-existing-db", action="store_true",
                   help="Windows: copy backend\\stocks.db into the service's data directory")
    p.add_argument("--repo", default=paths.REPO_URL, help=argparse.SUPPRESS)
    p.add_argument("--branch", default=paths.BRANCH, help=argparse.SUPPRESS)
    p.add_argument("--resumed", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--dry-run", action="store_true", help="print every action; change nothing")

    p = sub.add_parser("uninstall", help="remove the service; data is kept unless --purge-data")
    p.add_argument("--purge-data", action="store_true", help="also delete the database, backups, "
                                                             "logs and settings")
    p.add_argument("--yes", action="store_true", help="don't ask for confirmation")
    p.add_argument("--dry-run", action="store_true", help="print every action; change nothing")

    p = sub.add_parser("update", help="pull the latest version, restart, roll back on failure")
    p.add_argument("--from-request", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--log-dir", help=argparse.SUPPRESS)
    p.add_argument("--detached", action="store_true", help=argparse.SUPPRESS)

    p = sub.add_parser("backup", help="write a verified archive of the database and settings")
    p.add_argument("--to", metavar="DIR", help="write it here instead of the backup directory")
    p.add_argument("--dry-run", action="store_true", help="say what would be backed up")

    p = sub.add_parser("restore", help="put a backup's database back")
    p.add_argument("archive")
    p.add_argument("--with-settings", action="store_true", help="also restore the settings file")
    p.add_argument("--yes", action="store_true", help="don't ask for confirmation")
    p.add_argument("--dry-run", action="store_true", help="verify the archive; change nothing")

    sub.add_parser("status", help="service, health, locations, last backup")
    for action in SERVICE_ACTIONS:
        p = sub.add_parser(action, help=f"{action} the service" if action != "logs"
                           else "show the service's recent log")
        if action == "logs":
            p.add_argument("-n", "--lines", type=int, default=40)
    # Run by the installed monitor and the installer, not by hand: no help line.
    sub.add_parser("healthcheck")
    sub.add_parser("fetch-dist")
    sub.metavar = "{" + ",".join(c for c in sub.choices if c not in ("healthcheck", "fetch-dist")) + "}"
    return parser


def main(argv: list[str]) -> int:
    opts = build_parser().parse_args(argv)
    proc.DRY_RUN = getattr(opts, "dry_run", False)
    command = opts.command
    if command == "install":
        return install.run(opts, [a for a in argv[1:] if a != "--resumed"])
    if command == "uninstall":
        return uninstall.run(opts)
    if command == "update":
        if opts.from_request:
            return update.from_request(opts.log_dir, opts.detached, argv)
        return update.run(opts)
    if command == "backup":
        return backup.run(opts.to)
    if command == "restore":
        return restore.run(opts.archive, opts.with_settings, opts.yes)
    if command == "status":
        return status.run()
    if command in SERVICE_ACTIONS:
        return service.run(command, getattr(opts, "lines", 0))
    if command == "healthcheck":
        return healthcheck.run()
    print(webdist.install(updatecore.git("rev-parse", "HEAD").strip()))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except proc.Failed as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
