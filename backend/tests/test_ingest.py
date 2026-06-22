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

    ingest.run_source(conn, "usaspending", fake_fetch)

    assert len(db.get_contracts(conn)) == 1
    statuses = db.get_source_statuses(conn)
    assert statuses[0].source == "usaspending"
    assert statuses[0].status == "ok"
    assert statuses[0].record_count == 1
    assert statuses[0].last_refreshed_at is not None


def test_run_source_records_error_status(conn):
    def boom():
        raise RuntimeError("network down")

    ingest.run_source(conn, "usaspending", boom)

    statuses = db.get_source_statuses(conn)
    assert statuses[0].status.startswith("error:")
    assert statuses[0].record_count == 0
    # Failure still stamps a timestamp so the UI shows it tried.
    assert statuses[0].last_refreshed_at is not None
