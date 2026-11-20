"""`signal restore <archive>`: put a backup's database (and, when asked, its
settings file) back. The archive is verified before anything is touched, the
database it replaces is kept beside the new one, and a service that does not
come back up afterwards is given its old database again."""
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from app import backup
from deploy.lib import health, proc
from deploy.lib import paths as paths_lib
from deploy.platforms import current as current_platform

HEALTH_WAIT_SECONDS = 180
SIDECARS = ("", "-wal", "-shm")


def _set_aside(db: Path, stamp: str) -> Path:
    """Move the live database and its WAL files out of the way; return where."""
    kept = db.with_name(f"{db.name}.before-restore-{stamp}")
    for suffix in SIDECARS:
        source = Path(f"{db}{suffix}")
        if source.exists():
            source.rename(f"{kept}{suffix}")
    return kept


def _put_back(db: Path, kept: Path) -> None:
    for suffix in SIDECARS:
        Path(f"{db}{suffix}").unlink(missing_ok=True)
        if Path(f"{kept}{suffix}").exists():
            Path(f"{kept}{suffix}").rename(f"{db}{suffix}")


def _own_like(path: Path, reference: Path) -> None:
    if os.name != "nt":
        owner = reference.stat()
        shutil.chown(path, owner.st_uid, owner.st_gid)


def run(archive: Path, with_settings: bool, yes: bool) -> int:
    plat = current_platform()
    paths, env = paths_lib.current()
    port = paths_lib.port(env)
    archive = Path(archive)
    with tempfile.TemporaryDirectory() as tmp:
        try:
            manifest = backup.extract(archive, Path(tmp))
        except backup.BackupError as exc:
            raise proc.Failed(str(exc)) from exc
        proc.say(f"{archive.name} is a valid backup")
        proc.note("made", manifest["created_at"] or "unknown (a nightly copy from before archives)")
        proc.note("app version", f"{manifest['app_version'] or 'unknown'} ({manifest['commit'] or 'no commit'})")
        proc.note("accounts", f"{manifest['users']} ({manifest['admins']} admin)")
        proc.note("settings", "in the archive" if manifest["settings"] else "not in the archive")
        if with_settings and not manifest["settings"]:
            raise proc.Failed("--with-settings was asked for, but this archive has no settings file")
        if proc.DRY_RUN:
            proc.say(f"would stop the service, replace {paths.db} and start it again")
            return 0
        if not yes and input(f"Replace {paths.db} with this backup? [y/N] ").strip().lower() != "y":
            proc.say("nothing was changed")
            return 1

        installed = plat.state() != "absent"
        if installed:
            proc.say("stopping the service")
            plat.stop(paths)
        paths.db.parent.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        kept = _set_aside(paths.db, stamp)
        shutil.copyfile(Path(tmp) / backup.DB_NAME, paths.db)
        _own_like(paths.db, paths.db.parent)
        if with_settings:
            if paths.settings.exists():
                shutil.copyfile(paths.settings, paths.settings.with_name(f"{paths.settings.name}.before-restore-{stamp}"))
            shutil.copyfile(Path(tmp) / backup.SETTINGS_NAME, paths.settings)
            plat.protect(paths)

    if installed:
        proc.say("starting the service")
        try:
            plat.restart(paths)
            came_up = health.wait(port, HEALTH_WAIT_SECONDS)
        except proc.Failed:
            came_up = None
        if not came_up:
            plat.stop(paths)
            _put_back(paths.db, kept)
            plat.restart(paths)
            raise proc.Failed("the service did not come back up on the restored database, so the "
                              "previous one was put back")
    proc.say(f"restored: {manifest['users']} account(s)")
    if Path(kept).exists():
        proc.note("previous db", f"kept at {kept}")
    return 0
