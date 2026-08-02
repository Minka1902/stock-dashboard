"""Throttling behaviour: success cadence vs retry cadence, and the run log.

The bug these lock down: `min_interval` used to be measured from the last
*attempt*, and every attempt — including failures — stamped the clock. One
failed fetch therefore silenced a source for the whole interval, which is how
margin_debt sat at a stale error for days while looking "recently refreshed".
"""
from datetime import datetime, timedelta, timezone

from app import db, ingest
from app.models import ContractRecord


def _records():
    return [
        ContractRecord(
            external_id="x1", award_id="A1", recipient_name="Acme", amount=1.0,
            awarding_agency="DoD", start_date="2026-01-01", description="thing",
        )
    ]


def _ago(**kwargs):
    return (datetime.now(timezone.utc) - timedelta(**kwargs)).isoformat(timespec="seconds")


def _status(conn, name="usaspending"):
    return {s.source: s for s in db.get_source_statuses(conn)}[name]


def test_success_sets_last_success_at(conn):
    ingest.run_source(conn, "usaspending", _records, db.upsert_contracts)
    row = _status(conn)
    assert row.last_success_at is not None
    assert row.last_success_at == row.last_refreshed_at
    assert row.last_duration_ms is not None


def test_failure_does_not_advance_last_success_at(conn):
    def boom():
        raise RuntimeError("upstream 403")

    ingest.run_source(conn, "usaspending", _records, db.upsert_contracts)
    good = _status(conn).last_success_at
    assert good is not None

    ingest.run_source(conn, "usaspending", boom, db.upsert_contracts)
    row = _status(conn)
    assert row.status.startswith("error")
    # The attempt clock moved; the success clock did not.
    assert row.last_success_at == good
    assert row.last_refreshed_at >= good


def test_failed_source_retries_on_retry_interval_not_min_interval(conn):
    """A failure must not be frozen out for the full success cadence."""
    calls = 0

    def failing():
        nonlocal calls
        calls += 1
        raise RuntimeError("upstream 403")

    # Failed an hour ago, min_interval is 14 days, retry_interval is 30 minutes.
    db.update_source_status(
        conn, "usaspending", _ago(hours=1), "error: RuntimeError: nope", 0, success=False)

    ingest.run_source(
        conn, "usaspending", failing, db.upsert_contracts,
        min_interval_seconds=1209600, retry_interval_seconds=1800,
    )
    assert calls == 1, "retry gate elapsed, so the source should have been retried"


def test_failed_source_still_waits_out_the_retry_interval(conn):
    calls = 0

    def failing():
        nonlocal calls
        calls += 1
        raise RuntimeError("upstream 403")

    db.update_source_status(
        conn, "usaspending", _ago(minutes=5), "error: RuntimeError: nope", 0, success=False)

    ingest.run_source(
        conn, "usaspending", failing, db.upsert_contracts,
        min_interval_seconds=1209600, retry_interval_seconds=1800,
    )
    assert calls == 0


def test_successful_source_respects_min_interval_from_last_success(conn):
    calls = 0

    def counting():
        nonlocal calls
        calls += 1
        return _records()

    ingest.run_source(conn, "usaspending", counting, db.upsert_contracts)
    assert calls == 1
    ingest.run_source(
        conn, "usaspending", counting, db.upsert_contracts, min_interval_seconds=3600)
    assert calls == 1


def test_skip_is_recorded_as_a_run(conn):
    """A silently-throttled source is invisible in source_status — the run log
    is what makes 'it has not actually fetched in two weeks' observable."""
    ingest.run_source(conn, "usaspending", _records, db.upsert_contracts)
    ingest.run_source(
        conn, "usaspending", _records, db.upsert_contracts, min_interval_seconds=3600)

    runs = db.get_source_runs(conn, "usaspending")
    assert [r.outcome for r in runs] == ["skipped", "ok"]
    assert "min_interval" in runs[0].detail


def test_force_bypasses_both_gates(conn):
    calls = 0

    def counting():
        nonlocal calls
        calls += 1
        return _records()

    ingest.run_source(conn, "usaspending", counting, db.upsert_contracts)
    ingest.run_source(
        conn, "usaspending", counting, db.upsert_contracts,
        min_interval_seconds=1209600, retry_interval_seconds=1800, force=True,
    )
    assert calls == 2


def test_legacy_row_without_last_success_falls_back_to_last_refreshed(conn):
    """Rows written before last_success_at existed must not be hammered."""
    calls = 0

    def counting():
        nonlocal calls
        calls += 1
        return _records()

    conn.execute(
        "INSERT INTO source_status (source, last_refreshed_at, status, record_count) "
        "VALUES (?, ?, 'ok', 1)",
        ("usaspending", _ago(minutes=5)),
    )
    conn.commit()
    assert _status(conn).last_success_at is None

    ingest.run_source(
        conn, "usaspending", counting, db.upsert_contracts, min_interval_seconds=3600)
    assert calls == 0, "should fall back to last_refreshed_at rather than refetch"


def test_degraded_provenance_is_not_treated_as_success(conn):
    """A FetchResult warning stores real data but must keep retrying."""
    def degraded():
        return ingest.FetchResult(_records(), warning="unofficial mirror")

    ingest.run_source(conn, "usaspending", degraded, db.upsert_contracts)
    row = _status(conn)
    assert row.status.startswith("error")
    assert row.record_count == 1          # the real records were still stored
    assert row.last_success_at is None    # but it does not satisfy the cadence


def test_run_stats_aggregate_outcomes(conn):
    def boom():
        raise RuntimeError("nope")

    ingest.run_source(conn, "usaspending", _records, db.upsert_contracts)
    ingest.run_source(conn, "usaspending", boom, db.upsert_contracts)
    ingest.run_source(
        conn, "usaspending", _records, db.upsert_contracts, min_interval_seconds=3600)

    stats = db.get_source_run_stats(conn)["usaspending"]
    assert stats["runs_total"] == 3
    assert stats["runs_ok"] == 1
    assert stats["runs_error"] == 1
    assert stats["runs_skipped"] == 1


def test_prune_history_trims_old_rows(conn):
    db.record_source_run(conn, "usaspending", _ago(days=90), _ago(days=90), "ok", 5, 1)
    db.record_source_run(conn, "usaspending", _ago(days=1), _ago(days=1), "ok", 5, 1)
    db.record_job_run(conn, "refresh_all", "executed", _ago(days=200))
    db.record_job_run(conn, "refresh_all", "executed", _ago(days=1))

    deleted = db.prune_history(conn, source_run_days=30, job_run_days=90, boom_history_days=400)
    assert deleted["source_runs"] == 1
    assert deleted["job_runs"] == 1
    assert len(db.get_source_runs(conn)) == 1
    assert len(db.get_job_runs(conn)) == 1
