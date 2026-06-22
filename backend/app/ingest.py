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
    min_interval_seconds: int | None = None,
) -> None:
    """Run one source: fetch records, persist them via `store`, stamp status.

    When min_interval_seconds is set, skip silently if the source was refreshed
    more recently than that interval (used for slow sources like congress trades).

    Never raises: any failure is recorded as the source's status so the UI can
    show that the source tried and failed.
    """
    if min_interval_seconds is not None:
        statuses = {s.source: s for s in db.get_source_statuses(conn)}
        existing = statuses.get(source_name)
        if existing and existing.last_refreshed_at:
            try:
                last = datetime.fromisoformat(existing.last_refreshed_at)
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                elapsed = (datetime.now(timezone.utc) - last).total_seconds()
                if elapsed < min_interval_seconds:
                    return
            except (ValueError, TypeError):
                pass  # unparseable timestamp — proceed with fetch

    try:
        records = fetch()
        store(conn, records)
        db.update_source_status(conn, source_name, _now_iso(), "ok", len(records))
    except Exception as exc:  # noqa: BLE001 - we want to capture any failure
        db.update_source_status(conn, source_name, _now_iso(), f"error: {exc}", 0)
