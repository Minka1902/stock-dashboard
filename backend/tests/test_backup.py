import json
import sqlite3
import zipfile
from datetime import UTC, datetime, timedelta

import pytest

from app import backup, host
from app.version import __version__


def _seed(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS backup_probe (v TEXT)")
    conn.execute("INSERT INTO backup_probe VALUES ('kept')")
    conn.execute("INSERT INTO users (email, password_hash, created_at, is_admin) "
                 "VALUES ('admin@x.co', 'h', '2026-11-01', 1), ('u@x.co', 'h', '2026-11-01', 0)")
    conn.commit()


def test_archive_holds_a_verified_snapshot_the_settings_and_a_manifest(conn, tmp_path):
    _seed(conn)
    settings = tmp_path / "settings.env"
    settings.write_text("STOCKS_ADMIN_EMAIL=admin@x.co\n")
    path = backup.create(conn, tmp_path / "b", 3, settings, commit="abc1234",
                         now=datetime(2026, 11, 16, 3, 47, tzinfo=UTC))
    assert path.name == "stocks-20261116T034700Z.zip"
    assert sorted(p.name for p in (tmp_path / "b").iterdir()) == [path.name]

    manifest = backup.extract(path, tmp_path / "out")
    assert manifest["format"] == backup.FORMAT and manifest["settings"] is True
    assert manifest["app_version"] == __version__ and manifest["commit"] == "abc1234"
    assert manifest["host"] == host.KIND
    assert (manifest["users"], manifest["admins"]) == (2, 1)
    assert (tmp_path / "out" / backup.SETTINGS_NAME).read_text() == settings.read_text()
    copy = sqlite3.connect(tmp_path / "out" / backup.DB_NAME)
    try:
        assert copy.execute("SELECT v FROM backup_probe").fetchone() == ("kept",)
    finally:
        copy.close()


def test_a_missing_settings_file_is_recorded_not_invented(conn, tmp_path):
    _seed(conn)
    path = backup.create(conn, tmp_path / "b", 3, tmp_path / "no-such.env")
    assert backup.verify(path)["settings"] is False
    with zipfile.ZipFile(path) as zf:
        assert sorted(zf.namelist()) == [backup.MANIFEST_NAME, backup.DB_NAME]


def test_only_the_newest_archives_are_kept_and_legacy_copies_age_out(conn, tmp_path):
    _seed(conn)
    target = tmp_path / "b"
    target.mkdir()
    legacy = target / "stocks-20261001T034700Z.db"
    legacy.write_bytes(b"old nightly copy")
    start = datetime(2026, 11, 1, 3, 47, tzinfo=UTC)
    made = [backup.create(conn, target, 2, now=start + timedelta(days=i)) for i in range(4)]
    assert sorted(target.iterdir()) == made[-2:]


def test_a_snapshot_failing_integrity_check_is_not_kept(conn, tmp_path, monkeypatch):
    _seed(conn)
    monkeypatch.setattr(backup, "_integrity", lambda path: "row 3 missing from index")
    with pytest.raises(backup.BackupError, match="integrity_check"):
        backup.create(conn, tmp_path / "b", 3)
    assert list((tmp_path / "b").iterdir()) == []


def test_a_tampered_or_truncated_archive_is_refused(conn, tmp_path):
    _seed(conn)
    path = backup.create(conn, tmp_path / "b", 3)

    swapped = tmp_path / "swapped.zip"
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(swapped, "w") as dst:
        dst.writestr(backup.MANIFEST_NAME, src.read(backup.MANIFEST_NAME))
        dst.writestr(backup.DB_NAME, src.read(backup.DB_NAME) + b"\0" * 4096)
    with pytest.raises(backup.BackupError, match="recorded checksum"):
        backup.verify(swapped)

    truncated = tmp_path / "truncated.zip"
    truncated.write_bytes(path.read_bytes()[:200])
    with pytest.raises(backup.BackupError, match="not a usable backup archive"):
        backup.verify(truncated)

    no_manifest = tmp_path / "no-manifest.zip"
    with zipfile.ZipFile(no_manifest, "w") as zf:
        zf.writestr(backup.DB_NAME, b"")
    with pytest.raises(backup.BackupError, match="not a usable backup archive"):
        backup.verify(no_manifest)


def test_a_legacy_nightly_copy_is_still_restorable(conn, tmp_path):
    _seed(conn)
    legacy = tmp_path / "stocks-20261001T034700Z.db"
    dest = sqlite3.connect(legacy)
    conn.backup(dest)
    dest.close()
    manifest = backup.extract(legacy, tmp_path / "out")
    assert manifest["format"] == 0 and manifest["settings"] is False
    assert (manifest["users"], manifest["admins"]) == (2, 1)

    legacy.write_bytes(b"not a database at all")
    with pytest.raises(backup.BackupError, match="integrity_check"):
        backup.verify(legacy)


def test_latest_describes_the_newest_archive(conn, tmp_path):
    target = tmp_path / "b"
    assert backup.latest(target) is None
    _seed(conn)
    backup.create(conn, target, 7, now=datetime(2026, 11, 1, tzinfo=UTC))
    newest = backup.create(conn, target, 7, now=datetime(2026, 11, 2, tzinfo=UTC))
    info = backup.latest(target)
    assert info["path"] == str(newest) and info["count"] == 2 and info["size_bytes"] > 0


def test_manifest_is_plain_json(conn, tmp_path):
    _seed(conn)
    with zipfile.ZipFile(backup.create(conn, tmp_path / "b", 1)) as zf:
        manifest = json.loads(zf.read(backup.MANIFEST_NAME))
    assert set(manifest) == {"format", "created_at", "app_version", "commit", "host",
                             "db", "settings", "users", "admins"}
    assert set(manifest["db"]) == {"sha256", "size_bytes"}
