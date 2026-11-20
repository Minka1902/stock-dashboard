"""Verified backups: the database, the settings file and a manifest in one archive.

    stocks-<UTC>.zip
      stocks.db       an online-backup snapshot that passed PRAGMA integrity_check
      settings.env    the instance's settings file, when there is one
      manifest.json   app version, commit, host kind, the snapshot's sha256, account counts

Accounts (password hashes, TOTP enrolments, recovery codes) and every per-user
table live in the database, so the snapshot carries the users.

SQLite's online backup API copies a consistent snapshot while the app keeps
writing. An archive is kept only after its snapshot passes integrity_check; a
bad one is deleted and `create` raises, which the Server page shows as an error.

Stdlib only and config-free: the nightly db_backup job passes the app's
settings, deploy/ passes the platform's paths.
"""
import hashlib
import json
import os
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app import host
from app.version import __version__

PREFIX = "stocks-"
SUFFIX = ".zip"
# The Pi fork's nightly copies, before archives: still listed, pruned and restorable.
LEGACY_SUFFIX = ".db"
DB_NAME = "stocks.db"
SETTINGS_NAME = "settings.env"
MANIFEST_NAME = "manifest.json"
FORMAT = 1
# Fast deflate: SQLite pages compress well at any level, and the nightly run
# holds the single refresh thread while it writes.
COMPRESS_LEVEL = 1
_CHUNK = 1024 * 1024


class BackupError(RuntimeError):
    """The archive is unusable; the message says why."""


def _files(directory: Path) -> list[Path]:
    # The UTC timestamp in the name sorts chronologically across both suffixes.
    return sorted(p for p in directory.glob(f"{PREFIX}*") if p.suffix in (SUFFIX, LEGACY_SUFFIX))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _integrity(path: Path) -> str:
    db = sqlite3.connect(path)
    try:
        return db.execute("PRAGMA integrity_check").fetchone()[0]
    except sqlite3.DatabaseError as exc:
        return str(exc)
    finally:
        db.close()


def _accounts(path: Path) -> tuple[int | None, int | None]:
    """(users, admins), or (None, None) for a database that has no users table."""
    db = sqlite3.connect(path)
    try:
        users, admins = db.execute("SELECT COUNT(*), COALESCE(SUM(is_admin), 0) FROM users").fetchone()
        return users, admins
    except sqlite3.DatabaseError:
        return None, None
    finally:
        db.close()


def create(conn: sqlite3.Connection, directory: Path, keep: int,
           settings_file: Path | None = None, commit: str | None = None,
           now: datetime | None = None) -> Path:
    """Write one archive into `directory` and keep the newest `keep`."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    now = now or datetime.now(timezone.utc)
    target = directory / f"{PREFIX}{now.strftime('%Y%m%dT%H%M%SZ')}{SUFFIX}"
    snapshot = target.with_suffix(".db.part")
    part = target.with_suffix(".zip.part")
    try:
        snapshot.unlink(missing_ok=True)
        dest = sqlite3.connect(snapshot)
        try:
            conn.backup(dest)
        finally:
            dest.close()
        verdict = _integrity(snapshot)
        if verdict != "ok":
            raise BackupError(f"backup copy failed integrity_check: {verdict}")
        users, admins = _accounts(snapshot)
        settings = Path(settings_file) if settings_file and Path(settings_file).is_file() else None
        manifest = {
            "format": FORMAT,
            "created_at": now.isoformat(timespec="seconds"),
            "app_version": __version__,
            "commit": commit,
            "host": host.KIND,
            "db": {"sha256": _sha256(snapshot), "size_bytes": snapshot.stat().st_size},
            "settings": settings is not None,
            "users": users,
            "admins": admins,
        }
        with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED, compresslevel=COMPRESS_LEVEL) as zf:
            zf.write(snapshot, DB_NAME)
            if settings:
                zf.write(settings, SETTINGS_NAME)
            zf.writestr(MANIFEST_NAME, json.dumps(manifest, indent=2))
        # The archive holds password hashes, TOTP secrets and API keys.
        os.chmod(part, 0o600)
        os.replace(part, target)
    finally:
        snapshot.unlink(missing_ok=True)
        part.unlink(missing_ok=True)
    for old in _files(directory)[:-max(1, keep)]:
        old.unlink()
    return target


def extract(archive: Path, into: Path) -> dict:
    """Unpack `archive` into `into` (DB_NAME, and SETTINGS_NAME when it has
    one) and return its manifest. Raises BackupError unless the snapshot
    matches its recorded sha256 and passes integrity_check."""
    archive, into = Path(archive), Path(into)
    into.mkdir(parents=True, exist_ok=True)
    db = into / DB_NAME
    if archive.suffix == LEGACY_SUFFIX:
        try:
            db.write_bytes(archive.read_bytes())
        except OSError as exc:
            raise BackupError(f"cannot read {archive}: {exc}") from exc
        manifest = {"format": 0, "settings": False, "created_at": None,
                    "app_version": None, "commit": None, "host": None}
    else:
        try:
            with zipfile.ZipFile(archive) as zf:
                manifest = json.loads(zf.read(MANIFEST_NAME))
                names = [DB_NAME] + ([SETTINGS_NAME] if manifest.get("settings") else [])
                for name in names:
                    (into / name).write_bytes(zf.read(name))
        except (OSError, KeyError, ValueError, zipfile.BadZipFile) as exc:
            raise BackupError(f"{archive.name} is not a usable backup archive: {exc}") from exc
        if _sha256(db) != (manifest.get("db") or {}).get("sha256"):
            raise BackupError(f"{archive.name}: the database does not match its recorded checksum")
    verdict = _integrity(db)
    if verdict != "ok":
        raise BackupError(f"{archive.name}: the database failed integrity_check: {verdict}")
    manifest["users"], manifest["admins"] = _accounts(db)
    return manifest


def verify(archive: Path) -> dict:
    """The manifest of a usable archive; raises BackupError otherwise."""
    with tempfile.TemporaryDirectory() as tmp:
        return extract(archive, Path(tmp))


def latest(directory: Path) -> dict | None:
    """The newest backup, for the Server page; None when there is none."""
    try:
        files = _files(Path(directory))
    except OSError:
        return None
    if not files:
        return None
    stat = files[-1].stat()
    return {
        "path": str(files[-1]),
        "size_bytes": stat.st_size,
        "at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds"),
        "count": len(files),
    }
