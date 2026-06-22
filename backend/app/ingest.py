"""Ingestion orchestration: run a source's fetch, store results, stamp status."""
import sqlite3
from datetime import datetime, timezone
from typing import Callable

from app import db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run_source(
    conn: sqlite3.Connection,
    source_name: str,
    fetch: Callable[[], list],
    store: Callable[[sqlite3.Connection, list], None],
) -> None:
    """Run one source: fetch records, persist them via `store`, stamp status.

    Never raises: any failure is recorded as the source's status so the UI can
    show that the source tried and failed.
    """
    try:
        records = fetch()
        store(conn, records)
        db.update_source_status(conn, source_name, _now_iso(), "ok", len(records))
    except Exception as exc:  # noqa: BLE001 - we want to capture any failure
        db.update_source_status(conn, source_name, _now_iso(), f"error: {exc}", 0)
