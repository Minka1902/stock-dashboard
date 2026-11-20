"""The stdlib-only updater core: git parsing, blocked reasons, the status file."""
import subprocess

import pytest

from app import updatecore

SEP = "\x1f"


def test_parse_log_splits_fields_and_skips_malformed():
    text = (f"abc1234{SEP}feat: add thing{SEP}Minka{SEP}2026-09-25T10:00:00+03:00\n"
            "\n"
            "garbage line without separators\n"
            f"def5678{SEP}fix: a | pipe in the subject{SEP}Bot{SEP}2026-09-24T09:00:00Z\n")
    commits = updatecore.parse_log(text)
    assert [c["sha"] for c in commits] == ["abc1234", "def5678"]
    assert commits[1]["subject"] == "fix: a | pipe in the subject"
    assert commits[0]["author"] == "Minka"
    assert commits[0]["date"] == "2026-09-25T10:00:00+03:00"


def test_parse_porcelain_ignores_untracked():
    text = " M backend/app/main.py\nM  frontend/src/api.js\n?? scratch.log\n!! ignored\nR  a -> b\n"
    assert updatecore.parse_porcelain(text) == [
        "backend/app/main.py", "frontend/src/api.js", "a -> b"]


def test_parse_version_and_branch():
    assert updatecore.parse_version('"""doc"""\n\n__version__ = "0.2.0"\n') == "0.2.0"
    assert updatecore.parse_version("nothing here") is None
    assert updatecore.parse_branch("main\n") == "main"
    assert updatecore.parse_branch("HEAD\n") is None


def test_parse_count_rejects_non_numbers():
    assert updatecore.parse_count(" 12\n") == 12
    with pytest.raises(updatecore.GitError, match="unexpected git output"):
        updatecore.parse_count("fatal: bad revision")


def test_friendly_fetch_error_uses_last_line():
    msg = updatecore.friendly_fetch_error(
        "fatal: unable to access 'https://github.com/x.git/':\n"
        "Could not resolve host: github.com\n")
    assert msg == "could not reach GitHub: Could not resolve host: github.com"


def _check(**over):
    return {"ok": True, "error": None, "behind": 2, "ahead": 0, "branch": "main",
            "dirty_count": 0, **over}


@pytest.mark.parametrize("over,expected", [
    ({}, None),
    ({"ok": False, "error": "git unavailable: nope"}, "git unavailable: nope"),
    ({"behind": 0}, "already up to date"),
    ({"branch": "feature-x"}, "branch 'feature-x'"),
    ({"branch": None}, "a detached HEAD"),
    ({"dirty_count": 3}, "3 tracked file(s) have local changes"),
    ({"ahead": 1}, "can't fast-forward"),
])
def test_blocked_reason_reports_the_most_fundamental_problem(over, expected):
    reason = updatecore.blocked_reason(_check(**over))
    assert reason is None if expected is None else expected in reason


def test_real_git_missing_binary(monkeypatch):
    def boom(*a, **k):
        raise FileNotFoundError("git")
    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(updatecore.GitError, match="not installed"):
        updatecore.git("status")
    assert updatecore.head_short() is None


def test_status_file_round_trip_and_staleness(tmp_path):
    assert updatecore.read_status(tmp_path) is None
    assert updatecore.is_apply_running(None) is False
    status = updatecore.initial_status("aaaaaaa", "bbbbbbb", "service")
    assert [s["id"] for s in status["steps"]] == [sid for sid, _ in updatecore.STEPS]
    updatecore.write_json(tmp_path / updatecore.STATUS_FILE_NAME, status)
    assert updatecore.read_status(tmp_path) == status
    assert updatecore.is_apply_running(status) is True
    assert updatecore.is_apply_running({**status, "updated_at": "2020-01-01T00:00:00Z"}) is False
    assert updatecore.is_apply_running({**status, "state": "done"}) is False
    assert updatecore.is_apply_running({**status, "updated_at": "not a date"}) is False
    assert not list(tmp_path.glob("*.tmp"))
