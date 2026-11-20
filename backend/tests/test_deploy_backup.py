"""signal backup / restore against a real database and settings file."""
import sqlite3

import pytest

from app import backup
from deploy.commands import backup as backup_command
from deploy.commands import restore as restore_command
from deploy.lib import paths as paths_lib
from deploy.lib import proc


class FakeService:
    def __init__(self, healthy=True):
        self.healthy, self.calls = healthy, []

    def state(self):
        return "running"

    def stop(self, paths):
        self.calls.append("stop")

    def restart(self, paths):
        self.calls.append("restart")

    def protect(self, paths):
        self.calls.append("protect")


@pytest.fixture
def install(tmp_path, monkeypatch, conn):
    conn.execute("INSERT INTO users (email, password_hash, created_at, is_admin) "
                 "VALUES ('a@x.co', 'h', '2026-11-01', 1)")
    conn.commit()
    db_file = tmp_path / "data" / "db" / "stocks.db"
    db_file.parent.mkdir(parents=True)
    dest = sqlite3.connect(db_file)
    conn.backup(dest)
    dest.close()
    settings = tmp_path / "conf" / "stocks.env"
    settings.parent.mkdir()
    settings.write_text("STOCKS_TELEGRAM_BOT_TOKEN=abc\n")
    paths = paths_lib.Paths(
        app=tmp_path / "app", data=tmp_path / "data", db=db_file, backups=tmp_path / "data" / "backups",
        logs=tmp_path / "logs", settings=settings, generated=tmp_path / "conf" / "install.env",
        bin=tmp_path / "bin", health_state=tmp_path / "state")
    monkeypatch.setattr(paths_lib, "current", lambda: (paths, {}))
    service = FakeService()
    monkeypatch.setattr(restore_command, "current_platform", lambda: service)
    monkeypatch.setattr(restore_command.health, "wait",
                        lambda port, seconds, commit=None: {"status": "ok"} if service.healthy else None)
    monkeypatch.setattr(backup_command.shutil, "chown", lambda *a: None)
    monkeypatch.setattr(restore_command.shutil, "chown", lambda *a: None)
    return paths, service


def _users(db_file):
    db = sqlite3.connect(db_file)
    try:
        return [r[0] for r in db.execute("SELECT email FROM users ORDER BY id")]
    finally:
        db.close()


def _archive(paths):
    assert backup_command.run(None) == 0
    archive, = paths.backups.glob("stocks-*.zip")
    return archive


def test_backup_then_restore_brings_the_users_back(install):
    paths, service = install
    archive = _archive(paths)
    db = sqlite3.connect(paths.db)
    db.execute("INSERT INTO users (email, password_hash, created_at) VALUES ('late@x.co', 'h', 'x')")
    db.commit()
    db.close()
    assert _users(paths.db) == ["a@x.co", "late@x.co"]

    assert restore_command.run(archive, with_settings=False, yes=True) == 0
    assert _users(paths.db) == ["a@x.co"]
    assert service.calls == ["stop", "restart"]
    kept, = paths.db.parent.glob("stocks.db.before-restore-*")
    assert _users(kept) == ["a@x.co", "late@x.co"]


def test_settings_come_back_only_when_asked(install):
    paths, service = install
    archive = _archive(paths)
    paths.settings.write_text("STOCKS_TELEGRAM_BOT_TOKEN=changed\n")
    restore_command.run(archive, with_settings=False, yes=True)
    assert "changed" in paths.settings.read_text()
    restore_command.run(archive, with_settings=True, yes=True)
    assert paths.settings.read_text() == "STOCKS_TELEGRAM_BOT_TOKEN=abc\n"
    assert "protect" in service.calls
    assert list(paths.settings.parent.glob("stocks.env.before-restore-*"))


def test_a_restore_that_does_not_come_up_puts_the_old_database_back(install):
    paths, service = install
    archive = _archive(paths)
    db = sqlite3.connect(paths.db)
    db.execute("INSERT INTO users (email, password_hash, created_at) VALUES ('late@x.co', 'h', 'x')")
    db.commit()
    db.close()
    service.healthy = False
    with pytest.raises(proc.Failed, match="previous one was put back"):
        restore_command.run(archive, with_settings=False, yes=True)
    assert _users(paths.db) == ["a@x.co", "late@x.co"]


def test_a_bad_archive_touches_nothing(install, tmp_path):
    paths, service = install
    bad = tmp_path / "stocks-20261116T000000Z.zip"
    bad.write_bytes(b"PK not really")
    with pytest.raises(proc.Failed, match="not a usable backup archive"):
        restore_command.run(bad, with_settings=False, yes=True)
    assert service.calls == [] and _users(paths.db) == ["a@x.co"]


def test_backup_to_a_directory_of_your_own_prunes_nothing(install, tmp_path):
    paths, _ = install
    mine = tmp_path / "usb"
    mine.mkdir()
    (mine / "stocks-20200101T000000Z.zip").write_bytes(b"older archive of yours")
    assert backup_command.run(mine) == 0
    assert len(list(mine.glob("stocks-*.zip"))) == 2
    assert backup.verify(sorted(mine.glob("stocks-*.zip"))[-1])["settings"] is True
