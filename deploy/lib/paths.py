"""Where an install keeps things. The one place the locations are written
down: the systemd units are rendered from it, and the Windows service is
registered with it."""
import os
from pathlib import Path
from typing import NamedTuple

from app import host
from deploy.lib import envfile

REPO = Path(__file__).resolve().parents[2]
REPO_URL = "https://github.com/Minka1902/stock-dashboard.git"
BRANCH = "main"
DEFAULT_PORT = 8000
SERVICE_USER = "stocks"
PORT_KEY = "SIGNAL_PORT"


class Paths(NamedTuple):
    app: Path           # the checkout the service runs from
    data: Path
    db: Path
    backups: Path
    logs: Path
    settings: Path      # yours to edit (deploy/env.example is its template)
    generated: Path     # written by `install` on every run; settings win over it
    bin: Path           # where the `signal` command goes
    health_state: Path  # consecutive failed health checks


def installed(kind: str | None = None) -> Paths:
    """The locations an install uses on this kind of host."""
    if (kind or host.KIND) == host.WINDOWS:
        data = Path(os.environ.get("ProgramData") or r"C:\ProgramData") / "SignalDashboard"
        return Paths(
            app=REPO, data=data, db=data / "db" / "stocks.db", backups=data / "backups",
            logs=data / "logs", settings=data / "settings.env", generated=data / "install.env",
            bin=data / "bin", health_state=data / "logs" / "healthcheck.state")
    data, conf = Path("/var/lib/stocks-dashboard"), Path("/etc/stocks-dashboard")
    return Paths(
        app=Path("/opt/stocks-dashboard"), data=data, db=data / "db" / "stocks.db",
        backups=data / "backups", logs=Path("/var/log/stocks-dashboard"),
        settings=conf / "stocks.env", generated=conf / "install.env",
        bin=Path("/usr/local/bin"), health_state=Path("/run/stocks-healthcheck/failures"))


def service_env(paths: Paths) -> dict:
    """The environment the service runs with: the installer's values, then
    yours on top."""
    return {**envfile.read(paths.generated), **envfile.read(paths.settings)}


def current() -> tuple[Paths, dict]:
    """This install as it is configured now: the database, backup and log
    locations follow the service's environment, falling back to the rules the
    app itself uses (app/config.py), so the tool and the app always agree."""
    paths = installed()
    env = service_env(paths)
    db = Path(env.get("STOCKS_DB_PATH") or paths.db)
    return paths._replace(
        db=db,
        backups=Path(env.get("STOCKS_BACKUP_DIR") or db.parent / "backups"),
        logs=Path(env.get("STOCKS_LOG_DIR") or paths.logs)), env


def port(env: dict) -> int:
    return int(env.get(PORT_KEY) or DEFAULT_PORT)


def venv_python(app: Path) -> Path:
    return app / "backend" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
