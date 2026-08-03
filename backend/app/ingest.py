"""Ingestion orchestration: run a source's fetch, store results, stamp status."""
import logging
import sqlite3
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Callable

from app import db

logger = logging.getLogger(__name__)

# Sources currently inside fetch(), name -> monotonic start time. Read by the
# Server page to show what the worker is doing right now.
_RUNNING: dict[str, float] = {}
_RUNNING_LOCK = threading.Lock()


def running_sources() -> dict[str, float]:
    """Snapshot of in-flight sources -> seconds elapsed so far."""
    now = time.monotonic()
    with _RUNNING_LOCK:
        return {name: round(now - started, 3) for name, started in _RUNNING.items()}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


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


def _should_skip(
    existing,
    min_interval_seconds: int | None,
    retry_interval_seconds: int | None,
) -> tuple[bool, str]:
    """Decide whether to skip this run, and say why.

    The gate depends on how the source last *ended*, not just when it last ran:

    - last run succeeded -> wait `min_interval` from the last SUCCESS.
    - last run failed    -> wait `retry_interval` from the last ATTEMPT.

    Keying the success cadence off last_success_at is the fix for the bug that
    made margin_debt look dead: stamping every attempt (including failures) into
    the throttle clock meant one failure froze the source for the entire
    min_interval, so it never retried and never reported anything new.
    """
    if existing is None:
        return False, ""

    failed = (existing.status or "").startswith("error")
    now = datetime.now(timezone.utc)

    if failed:
        gate = retry_interval_seconds if retry_interval_seconds is not None else min_interval_seconds
        reference = _parse_iso(existing.last_refreshed_at)
        label = "retry_interval"
    else:
        gate = min_interval_seconds
        # Old rows predate last_success_at; fall back so they aren't hammered.
        reference = _parse_iso(existing.last_success_at) or _parse_iso(existing.last_refreshed_at)
        label = "min_interval"

    if gate is None or reference is None:
        return False, ""

    elapsed = (now - reference).total_seconds()
    if elapsed < gate:
        return True, f"{label}: {int(elapsed)}s elapsed of {int(gate)}s"
    return False, ""


def run_source(
    conn: sqlite3.Connection,
    source_name: str,
    fetch: Callable[[], list],
    store: Callable[[sqlite3.Connection, list], None],
    min_interval_seconds: int | None = None,
    force: bool = False,
    retry_interval_seconds: int | None = None,
) -> None:
    """Run one source: fetch records, persist them via `store`, stamp status.

    `min_interval_seconds` throttles successful refreshes (measured from the last
    success); `retry_interval_seconds` throttles retries after a failure
    (measured from the last attempt). `force=True` bypasses both.

    Never raises: any failure is recorded as the source's status (with a short
    `status` string and a full `error_detail` traceback for the Info page) so
    the UI can show that the source tried and failed. A `FetchResult.warning`
    on an otherwise-successful fetch is stamped as an error status *while still
    storing the real records* — the "degraded provenance" case.

    Every outcome, skips included, appends a `source_runs` row.
    """
    started_at = _now_iso()
    started = time.perf_counter()

    if not force and (min_interval_seconds is not None or retry_interval_seconds is not None):
        statuses = {s.source: s for s in db.get_source_statuses(conn)}
        skip, why = _should_skip(
            statuses.get(source_name), min_interval_seconds, retry_interval_seconds)
        if skip:
            db.record_source_run(
                conn, source_name, started_at, _now_iso(), "skipped",
                int((time.perf_counter() - started) * 1000), 0, why)
            return

    with _RUNNING_LOCK:
        _RUNNING[source_name] = time.monotonic()
    try:
        records = fetch()
        store(conn, records)
        duration_ms = int((time.perf_counter() - started) * 1000)
        warning = getattr(records, "warning", "")
        if warning:
            # Degraded provenance: real data stored, but flagged as an error so
            # the UI surfaces the caveat. Keep the real record count.
            # It is *not* a success for throttling purposes — we want to keep
            # retrying until the source is back on its official tier.
            status = f"error: {warning}"
            db.update_source_status(
                conn, source_name, _now_iso(), status, len(records),
                error_detail=None, success=False, duration_ms=duration_ms)
            db.record_source_run(
                conn, source_name, started_at, _now_iso(), "error",
                duration_ms, len(records), warning)
        else:
            note = getattr(records, "note", "")
            status = f"ok ({note})" if note else "ok"
            db.update_source_status(
                conn, source_name, _now_iso(), status, len(records),
                error_detail=None, success=True, duration_ms=duration_ms)
            db.record_source_run(
                conn, source_name, started_at, _now_iso(), "ok",
                duration_ms, len(records), note or None)
    except Exception as exc:  # noqa: BLE001 - we want to capture any failure
        duration_ms = int((time.perf_counter() - started) * 1000)
        logger.warning("source %s failed", source_name, exc_info=exc)
        # The status string is a UI feature, but raw exception text can leak
        # internals — keep it short and typed. The full traceback goes into
        # error_detail for the Info page's expandable diagnostics.
        brief = f"error: {type(exc).__name__}: {str(exc)[:120]}"
        detail = f"{type(exc).__name__}: {exc}\n\n" + traceback.format_exc()[-2000:]
        db.update_source_status(
            conn, source_name, _now_iso(), brief, 0,
            error_detail=detail, success=False, duration_ms=duration_ms)
        db.record_source_run(
            conn, source_name, started_at, _now_iso(), "error", duration_ms, 0, brief)
    finally:
        with _RUNNING_LOCK:
            _RUNNING.pop(source_name, None)
