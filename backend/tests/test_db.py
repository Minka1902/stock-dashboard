from app import db
from app.models import ContractRecord


def _contract(external_id="X1", amount=100.0):
    return ContractRecord(
        external_id=external_id,
        award_id="AWD-" + external_id,
        recipient_name="Acme Corp",
        amount=amount,
        awarding_agency="Dept of Defense",
        start_date="2026-06-01",
    )


def test_upsert_and_get_contracts(conn):
    db.upsert_contracts(conn, [_contract("A", 10.0), _contract("B", 20.0)])
    rows = db.get_contracts(conn)
    assert len(rows) == 2
    # Sorted by amount desc.
    assert rows[0].amount == 20.0


def test_upsert_is_idempotent(conn):
    db.upsert_contracts(conn, [_contract("A", 10.0)])
    db.upsert_contracts(conn, [_contract("A", 99.0)])  # same external_id
    rows = db.get_contracts(conn)
    assert len(rows) == 1
    assert rows[0].amount == 99.0  # updated, not duplicated


def test_source_status_roundtrip(conn):
    db.update_source_status(conn, "usaspending", "2026-06-22T12:00:00", "ok", 2)
    statuses = db.get_source_statuses(conn)
    assert len(statuses) == 1
    assert statuses[0].source == "usaspending"
    assert statuses[0].record_count == 2
    assert statuses[0].last_refreshed_at == "2026-06-22T12:00:00"
