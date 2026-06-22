"""Ingestion orchestration: run a source's fetch, store results, stamp status."""
import sqlite3
from datetime import datetime, timezone
from typing import Callable

from app import db
from app.models import ContractRecord


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run_source(
    conn: sqlite3.Connection,
    source_name: str,
    fetch: Callable[[], list[ContractRecord]],
) -> None:
    """Run one source. Never raises: failures are recorded as status."""
    try:
        records = fetch()
        db.upsert_contracts(conn, records)
        db.update_source_status(conn, source_name, _now_iso(), "ok", len(records))
    except Exception as exc:  # noqa: BLE001 - we want to capture any failure
        db.update_source_status(conn, source_name, _now_iso(), f"error: {exc}", 0)
