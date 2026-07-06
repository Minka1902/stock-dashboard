from app import db, ingest
from app.models import ContractRecord


def _records():
    return [
        ContractRecord(
            external_id="A", award_id="AWD-A", recipient_name="Acme",
            amount=10.0, awarding_agency="DoD", start_date="2026-06-01",
        )
    ]


def test_run_source_stores_records_and_stamps_status(conn):
    def fake_fetch():
        return _records()

    ingest.run_source(conn, "usaspending", fake_fetch, db.upsert_contracts)

    assert len(db.get_contracts(conn)) == 1
    statuses = db.get_source_statuses(conn)
    assert statuses[0].source == "usaspending"
    assert statuses[0].status == "ok"
    assert statuses[0].record_count == 1
    assert statuses[0].last_refreshed_at is not None


def test_run_source_records_error_status(conn):
    def boom():
        raise RuntimeError("network down")

    ingest.run_source(conn, "usaspending", boom, db.upsert_contracts)

    statuses = db.get_source_statuses(conn)
    assert statuses[0].status.startswith("error:")
    assert statuses[0].record_count == 0
    # Failure still stamps a timestamp so the UI shows it tried.
    assert statuses[0].last_refreshed_at is not None


def test_run_source_skips_if_refreshed_too_recently(conn):
    call_count = 0

    def counting_fetch():
        nonlocal call_count
        call_count += 1
        return _records()

    # First run stamps the status as "just now".
    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts)
    assert call_count == 1

    # Second run with a 1-hour min_interval should be skipped.
    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts, min_interval_seconds=3600)
    assert call_count == 1  # still 1; the fetch was not called again


def test_run_source_runs_when_interval_has_elapsed(conn):
    from datetime import datetime, timezone, timedelta

    call_count = 0

    def counting_fetch():
        nonlocal call_count
        call_count += 1
        return _records()

    # Stamp a status as if it ran 2 hours ago.
    old_ts = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
    db.update_source_status(conn, "usaspending", old_ts, "ok", 1)

    # min_interval is 1 hour; 2 hours have elapsed → should run.
    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts, min_interval_seconds=3600)
    assert call_count == 1


def test_run_source_no_min_interval_always_runs(conn):
    call_count = 0

    def counting_fetch():
        nonlocal call_count
        call_count += 1
        return _records()

    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts)
    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts)
    assert call_count == 2


def test_run_source_force_bypasses_min_interval(conn):
    call_count = 0

    def counting_fetch():
        nonlocal call_count
        call_count += 1
        return _records()

    # First run stamps the status as "just now".
    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts)
    assert call_count == 1

    # Within the interval, a normal run skips but a forced run fetches.
    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts, min_interval_seconds=3600)
    assert call_count == 1
    ingest.run_source(conn, "usaspending", counting_fetch, db.upsert_contracts,
                      min_interval_seconds=3600, force=True)
    assert call_count == 2
