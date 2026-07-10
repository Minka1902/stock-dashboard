"""Ingestion orchestration: run a source's fetch, store results, stamp status."""
import logging
import sqlite3
import traceback
from datetime import datetime, timezone
from typing import Callable

from app import db

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class FetchResult(list):
    """A list of records with an optional status note or warning.

    Sources with layered fallbacks return this so the status UI can show which
    tier produced the data (e.g. "ok (fallback: sentiment.xls)") — data is
    still real, never fabricated; the note just records its provenance.

    `warning` marks *degraded provenance*: the records are real and get stored,
    but the source is stamped as an error so the UI flags it (e.g. an X feed
    pulled from an unofficial mirror rather than the official API).
    """

    def __init__(self, records: list, note: str = "", warning: str = ""):
        super().__init__(records)
        self.note = note
        self.warning = warning


def run_source(
    conn: sqlite3.Connection,
    source_name: str,
    fetch: Callable[[], list],
    store: Callable[[sqlite3.Connection, list], None],
    min_interval_seconds: int | None = None,
    force: bool = False,
) -> None:
    """Run one source: fetch records, persist them via `store`, stamp status.

    When min_interval_seconds is set, skip silently if the source was refreshed
    more recently than that interval (used for slow sources like congress trades).
    `force=True` bypasses that guard (scheduled daily deep run, manual refresh).

    Never raises: any failure is recorded as the source's status (with a short
    `status` string and a full `error_detail` traceback for the Info page) so
    the UI can show that the source tried and failed. A `FetchResult.warning`
    on an otherwise-successful fetch is stamped as an error status *while still
    storing the real records* — the "degraded provenance" case.
    """
    if min_interval_seconds is not None and not force:
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
        warning = getattr(records, "warning", "")
        if warning:
            # Degraded provenance: real data stored, but flagged as an error so
            # the UI surfaces the caveat. Keep the real record count.
            status = f"error: {warning}"
            db.update_source_status(
                conn, source_name, _now_iso(), status, len(records), error_detail=None)
        else:
            note = getattr(records, "note", "")
            status = f"ok ({note})" if note else "ok"
            db.update_source_status(
                conn, source_name, _now_iso(), status, len(records), error_detail=None)
    except Exception as exc:  # noqa: BLE001 - we want to capture any failure
        logger.warning("source %s failed", source_name, exc_info=exc)
        # The status string is a UI feature, but raw exception text can leak
        # internals — keep it short and typed. The full traceback goes into
        # error_detail for the Info page's expandable diagnostics.
        brief = f"error: {type(exc).__name__}: {str(exc)[:120]}"
        detail = f"{type(exc).__name__}: {exc}\n\n" + traceback.format_exc()[-2000:]
        db.update_source_status(
            conn, source_name, _now_iso(), brief, 0, error_detail=detail)
