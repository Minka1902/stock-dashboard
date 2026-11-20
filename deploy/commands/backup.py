"""`signal backup`: one verified archive of the database, the settings file
and a manifest, written by the same code the nightly job runs (app/backup.py)."""
import os
import shutil
import sqlite3
from pathlib import Path

from app import backup, updatecore
from deploy.lib import paths as paths_lib
from deploy.lib import proc

DEFAULT_KEEP = 7
# An explicit destination is yours: nothing already there is pruned.
KEEP_EVERYTHING = 10 ** 9


def run(to: Path | None) -> int:
    paths, env = paths_lib.current()
    if not paths.db.exists():
        proc.say(f"no database at {paths.db} yet: nothing to back up")
        return 0
    directory = Path(to) if to else paths.backups
    keep = KEEP_EVERYTHING if to else int(env.get("STOCKS_BACKUP_KEEP") or DEFAULT_KEEP)
    if proc.DRY_RUN:
        proc.say(f"would back up {paths.db} and {paths.settings} into {directory}")
        return 0
    conn = sqlite3.connect(paths.db)
    try:
        archive = backup.create(conn, directory, keep, paths.settings, updatecore.head_short())
    finally:
        conn.close()
    if os.name != "nt" and not to:
        # Made as root: hand it to the account that prunes this directory.
        owner = directory.stat()
        shutil.chown(archive, owner.st_uid, owner.st_gid)
    manifest = backup.verify(archive)
    proc.say(f"backup written: {archive}")
    proc.note("size", f"{archive.stat().st_size / 1024 ** 2:.1f} MB")
    proc.note("accounts", f"{manifest['users']} ({manifest['admins']} admin)")
    proc.note("settings", "included" if manifest["settings"] else f"not included (no {paths.settings})")
    return 0
