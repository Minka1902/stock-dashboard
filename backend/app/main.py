"""FastAPI surface + scheduler wiring."""
import itertools
import json
import logging
import platform
import re
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo

from apscheduler.events import (
    EVENT_JOB_ERROR,
    EVENT_JOB_EXECUTED,
    EVENT_JOB_MAX_INSTANCES,
    EVENT_JOB_MISSED,
)
from apscheduler.executors.pool import BasePoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from app import analysis, analyze, auth, backtest, chart_data, config, db, ingest, notify, quotes, report, routes_auth, routes_oauth, schedules, search, sentiment, suggestion_history, suggestions, themes
from app import alerts as alerts_source
from app.logging_config import setup_logging
from app.version import __version__
from app import routes_update, updater

# Optional: the Server page degrades to "unavailable" rather than reporting
# zeros, which would look identical to a genuinely idle machine.
try:
    import psutil
except ImportError:  # pragma: no cover - exercised by monkeypatching psutil=None
    psutil = None
from app.security import SecurityHeadersMiddleware, rate_limit
from app.validation import clean_ticker
from app.market_calendar import is_trading_day, market_status, next_trading_day
from app.models import AppSettings, Holding, NotifyProfile, WatchItem
from app.sources import edgar, gdelt, usaspending
import app.sources.yield_curve as yield_curve_source
import app.sources.econ_calendar as econ_calendar_source
import app.sources.technical as technical_source
import app.sources.fear_greed as fear_greed_source
import app.sources.vix as vix_source
import app.sources.aaii as aaii_source
import app.sources.put_call as put_call_source
import app.sources.margin_debt as margin_debt_source
import app.sources.congress as congress_source
import app.sources.short_interest as short_interest_source
import app.sources.social as social_source
import app.sources.analyst as analyst_source
import app.sources.fundamentals as fundamentals_source
import app.sources.seasonality as seasonality_source
import app.sources.boom_score as boom_score_source
import app.sources.ohlc as ohlc_source
import app.sources.x_posts as x_posts_source
import app.sources.earnings as earnings_source

setup_logging()
logger = logging.getLogger(__name__)


# Module-level fetchers so tests can monkeypatch them with stubs. Each takes the
# connection to read from — the scheduler passes its own (refresh_conn) so an
# ingestion cycle never contends with request reads on the request connection.
def contracts_fetch(conn):
    start, end = config.contracts_date_window()
    return usaspending.fetch(start, end, config.CONTRACTS_LIMIT)


def news_fetch(conn):
    """Macro headlines plus per-ticker news for every portfolio/watchlist
    symbol (union across all users). Tagged articles come last so their
    ticker wins the url upsert."""
    macro = gdelt.fetch(config.NEWS_QUERY, config.NEWS_LIMIT)
    tickers = sorted(
        set(db.get_all_portfolio_tickers(conn)) | set(db.get_all_watched_tickers(conn))
    )
    if not tickers:
        return macro
    # Cap the per-ticker fan-out: each is a blocking GDELT call, so an unbounded
    # watchlist could make the news step outlast the whole refresh interval.
    tickers = tickers[: config.NEWS_MAX_TICKERS]
    names = db.get_company_names(conn, tickers)
    tagged = gdelt.fetch_for_tickers(tickers, names, config.NEWS_PER_TICKER_LIMIT)
    if gdelt._in_cooldown():
        # Real articles, but the per-ticker pass stopped early on a 429: say so
        # rather than letting a partial run read as a complete one.
        return ingest.FetchResult(
            macro + tagged, note="partial: GDELT rate-limited the per-ticker pass")
    return macro + tagged


def trades_fetch(conn):
    return edgar.fetch(config.EDGAR_LIMIT, config.SEC_USER_AGENT)


def signals_fetch(conn):
    tickers = db.get_all_watched_tickers(conn)
    if not tickers:
        return []
    return technical_source.fetch(tickers, config.ALPHA_VANTAGE_KEY)


def fundamentals_fetch(conn):
    # Universe = watchlist ∪ portfolio, so held-but-unwatched tickers still get
    # a sector/industry row for theme classification (Task 11).
    tickers = sorted(set(db.get_all_watched_tickers(conn)) | set(db.get_all_portfolio_tickers(conn)))
    if not tickers:
        return []
    return fundamentals_source.fetch(tickers)


def _store_fundamentals(conn, records) -> None:
    """Persist the valuation/profile rows plus the institutional holders that
    rode along on the same responses (see sources/fundamentals.fetch)."""
    db.upsert_fundamentals(conn, records)
    holders = getattr(records, "holders", None)
    if holders:
        db.upsert_company_holders(conn, holders)


def x_posts_fetch(conn):
    """Monitor configured X accounts. known_tickers = watchlist ∪ portfolio, so
    posts get their cashtags/matches tagged against symbols the user tracks.
    Accounts come from app settings (admin-editable), falling back to the env
    default when none are configured."""
    known = set(db.get_all_watched_tickers(conn)) | set(db.get_all_portfolio_tickers(conn))
    accounts = db.get_app_settings(conn).x_accounts or config.X_ACCOUNTS
    return x_posts_source.fetch(accounts, known)


def earnings_fetch(conn):
    """Earnings dates for what the user tracks, plus a curated large-cap list.

    "Big companies" has to be defined somewhere; app/data/majors.py states it
    explicitly as configuration rather than inferring it. Capped and rotated
    stalest-first so a large universe spreads across successive runs instead of
    making one run outlast the refresh interval.
    """
    from app.data.majors import MAJORS

    majors = config.EARNINGS_UNIVERSE or MAJORS
    universe = sorted(
        set(db.get_all_watched_tickers(conn))
        | set(db.get_all_portfolio_tickers(conn))
        | set(majors)
    )
    if not universe:
        return []
    seen = {e.ticker: e.fetched_at for e in db.get_earnings(conn)}
    universe.sort(key=lambda t: seen.get(t, ""))  # "" (never fetched) first
    return earnings_source.fetch(universe[: config.EARNINGS_MAX_TICKERS])


def seasonality_fetch(conn):
    tickers = db.get_all_watched_tickers(conn)
    if not tickers:
        return []
    return seasonality_source.fetch(tickers, config.SEASONALITY_RANGE)


def score_fetch(conn):
    tickers = db.get_all_watched_tickers(conn)
    if not tickers:
        return []
    return boom_score_source.compute_all(tickers, conn)


def econ_calendar_fetch(conn):
    """Upcoming macro releases. FMP path (official impact) when a key is set,
    otherwise the keyless Nasdaq path (curated impact)."""
    return econ_calendar_source.fetch(
        config.ECON_CALENDAR_DAYS_AHEAD,
        config.ECON_CALENDAR_DAYS_BACK,
        config.FMP_KEY,
        config.ECON_CALENDAR_COUNTRIES,
    )


def ohlc_fetch(conn):
    """Pull OHLC history for the whole analysis universe (portfolio ∪ watchlist ∪
    signal candidates), stalest-first and capped at OHLC_MAX_TICKERS so the Yahoo
    fan-out stays bounded on the single worker — large universes rotate across
    successive hourly runs."""
    universe = db.get_analysis_universe(conn, config.OPPORTUNITY_CANDIDATES)
    if not universe:
        return []
    fetched = db.get_ohlc_fetched_at(conn)
    universe.sort(key=lambda t: fetched.get(t, ""))  # "" (never fetched) sorts first
    return ohlc_source.fetch(universe[: config.OHLC_MAX_TICKERS])


def analysis_fetch(conn):
    """Background technical analysis over the whole universe from stored OHLC +
    live price. Produces a Buy/Sell/Hold recommendation per ticker.

    Computed once per ticker across all users and stored UNSIZED; each user's
    account size / risk % is applied at read time (analysis.apply_sizing)."""
    tickers = db.get_analysis_universe(conn, config.OPPORTUNITY_CANDIDATES)
    if not tickers:
        return []
    quote_map = {q.ticker: q.price for q in quotes.get_quotes(tickers)}
    out = []
    for t in tickers:
        daily = db.get_ohlc(conn, t, "daily")
        if len(daily) < 30:
            continue  # not enough history yet; skip rather than fabricate
        price = quote_map.get(t) or daily[-1].close
        out.append(analysis.build(t, daily, price, None, None))
    # Drop analyses for tickers that have dropped out of the universe entirely.
    db.prune_analyses(conn, tickers)
    return out


# Request connection: used by all API route handlers. SQLite in WAL mode
# (check_same_thread=False), so it serves reads concurrently with writes on the
# separate refresh connection below.
conn = db.connect(config.DB_PATH)
db.init_schema(conn)

# Refresh connection: used exclusively by the scheduler jobs and the manual
# /api/refresh route. Keeping ingestion writes off the request connection means
# a 3-minute refresh cycle can't block dashboard reads on the shared DB lock.
refresh_conn = db.connect(config.DB_PATH)


class SourceSpec(NamedTuple):
    """How one source is wired into the pipeline.

    The first three fields keep the original ``(fetch, store, min_interval)``
    positional shape, so plain 3-tuples in the registry below still work and are
    normalized into a SourceSpec by ``build_sources``.

    min_interval / retry_interval: the *default* cadence and error-retry for
    this source. They only seed its `source_schedules` row (app/schedules.py);
    from then on the row — editable on the Server page — is what the scheduler
    follows. min_interval None means "the fast default"
    (config.REFRESH_INTERVAL_SECONDS). A source with a min_interval also
    declines non-forced manual refreshes while it is fresh (politeness).
    force_on_daily: whether the daily deep run re-runs it. False for sources
    whose upstream publishes slowly or rate-limits us hard — hitting those an
    extra time daily just burns the quota and re-records the same error.
    """

    fetch: object
    store: object
    min_interval: int | None = None
    retry_interval: int | None = None
    force_on_daily: bool = True


def build_sources(conn):
    """Registry bound to a connection: name -> SourceSpec.

    Fetch closures reference the module-global fetcher names (so tests can still
    monkeypatch them) and pass in `conn`; store fns take the connection from
    ingest.run_source. Order is the startup run order. boom_score and alerts are
    not scheduled on their own: they run together, in that order, as the
    "derived" step after upstream sources succeed (schedules.DERIVED).
    """
    raw = {
        "usaspending": (lambda: contracts_fetch(conn), db.upsert_contracts, None),
        # GDELT rate-limits hard (429s) and the daily gate is the point, so the
        # deep run must not force it; a failure retries on its own shorter clock.
        "gdelt":       SourceSpec(lambda: news_fetch(conn), db.upsert_news,
                                  config.GDELT_MIN_INTERVAL_SECONDS,
                                  retry_interval=config.GDELT_RETRY_INTERVAL_SECONDS,
                                  force_on_daily=False),
        "edgar":       (lambda: trades_fetch(conn), db.upsert_trades, None),
        "yield_curve": (lambda: yield_curve_source.fetch(config.YIELD_CURVE_MONTHS), db.upsert_yield_curve, None),
        "econ_calendar": (lambda: econ_calendar_fetch(conn), db.upsert_econ_events, config.ECON_CALENDAR_MIN_INTERVAL_SECONDS),
        "technical":   (lambda: signals_fetch(conn), db.upsert_technical_signals, None),
        "fear_greed":  (lambda: fear_greed_source.fetch(), db.upsert_fear_greed, None),
        "vix":         (lambda: vix_source.fetch(config.VIX_RANGE), db.upsert_vix, None),
        "aaii":        (lambda: aaii_source.fetch(), db.upsert_aaii, config.AAII_MIN_INTERVAL_SECONDS),
        "put_call":    (lambda: put_call_source.fetch(), db.upsert_put_call, config.PUT_CALL_MIN_INTERVAL_SECONDS),
        # FINRA publishes monthly; a fortnightly success cadence with a 6h retry
        # keeps a 401/403 from freezing the source for the whole fortnight.
        "margin_debt": SourceSpec(lambda: margin_debt_source.fetch(), db.upsert_margin_debt,
                                  config.MARGIN_DEBT_MIN_INTERVAL_SECONDS,
                                  retry_interval=config.MARGIN_DEBT_RETRY_INTERVAL_SECONDS,
                                  force_on_daily=False),
        "congress":       (lambda: congress_source.fetch(config.CONGRESS_LOOKBACK_DAYS), db.upsert_congress_trades, config.CONGRESS_MIN_INTERVAL_SECONDS),
        "short_interest": (lambda: short_interest_source.fetch(db.get_all_watched_tickers(conn)), db.upsert_short_interest, None),
        "social":         (lambda: social_source.fetch(db.get_all_watched_tickers(conn)), db.upsert_social_sentiment, None),
        "analyst":        (lambda: analyst_source.fetch(db.get_all_watched_tickers(conn)), db.upsert_analyst_signals, None),
        "fundamentals":   (lambda: fundamentals_fetch(conn), _store_fundamentals, None),
        "x_posts":        (lambda: x_posts_fetch(conn), db.upsert_x_posts, config.X_MIN_INTERVAL_SECONDS),
        "earnings":       SourceSpec(lambda: earnings_fetch(conn), db.upsert_earnings,
                                     config.EARNINGS_MIN_INTERVAL_SECONDS,
                                     retry_interval=config.EARNINGS_RETRY_INTERVAL_SECONDS),
        "seasonality":    (lambda: seasonality_fetch(conn), db.upsert_seasonality, config.SEASONALITY_MIN_INTERVAL_SECONDS),
        "boom_score":     (lambda: score_fetch(conn), db.upsert_boom_scores, None),
        "ohlc":           (lambda: ohlc_fetch(conn), db.upsert_ohlc, config.OHLC_MIN_INTERVAL_SECONDS),  # 2y history barely moves intraday
        "analysis":       (lambda: analysis_fetch(conn), db.upsert_analyses, config.ANALYSIS_MIN_INTERVAL_SECONDS),  # after ohlc; cheap DB+quote read
        "alerts":         (lambda: alerts_source.detect(conn), db.upsert_alerts, None),  # derived: after boom_score
    }
    return {
        name: spec if isinstance(spec, SourceSpec) else SourceSpec(*spec)
        for name, spec in raw.items()
    }


# The scheduler and the manual-refresh route drive ingestion through the refresh
# connection; API read routes use `conn`.
SOURCES = build_sources(refresh_conn)

# ---------- scheduling: one job per source on one serial refresh thread ----------
#
# Every source has its own APScheduler job (`src:<name>`) driven by its row in
# `source_schedules` (app/schedules.py). The schedule is the only gate: a job
# that fires always fetches, and every non-run is visible —
#   * queued: all jobs share ONE refresh thread, so a job due while another is
#     fetching waits its turn and runs late (misfire_grace_time=None: never
#     dropped). The Server page lists what is waiting.
#   * coalesced: a job that fires while its previous run is still queued or
#     running is merged into it (max_instances=1) and recorded as such.
#   * deferred: the source asked to be retried later (GDELT's 429 cooldown);
#     its next run moves to the time it named.
#   * error: recorded with the full traceback; the next run moves to
#     now + the schedule's retry.
# boom_score -> alerts run as one "derived" job, pulled forward (debounced)
# after any upstream success, and on their own schedule row as well.

# Manual work (POST /api/refresh, run-now) is submitted straight to this pool,
# which is also the scheduler's "refresh" executor — so scheduled and manual
# runs are serialized on the same single thread and never write refresh_conn
# concurrently.
_refresh_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="refresh")

# Work waiting for the refresh thread: key -> {id, source, trigger, queued_at,
# scheduled_for}. Scheduled jobs are keyed by job id, manual ones uniquely.
_QUEUED: dict[str, dict] = {}
# Last finished scheduled run per job id -> (duration_ms, started_late_seconds).
_JOB_TIMING: dict[str, tuple[int, float | None]] = {}
_JOB_LOCK = threading.Lock()
_MANUAL_SEQ = itertools.count(1)

# A job that starts this much later than it was scheduled gets a note saying so.
_LATE_NOTE_SECONDS = 60


class _RefreshPoolExecutor(BasePoolExecutor):
    """APScheduler executor over `_refresh_executor`.

    Sharing the pool is what serializes scheduled and manual runs. Hooking the
    submit step records a job as queued *before* the pool can start it, which
    the scheduler's own SUBMITTED event (dispatched afterwards) cannot do.
    """

    def __init__(self, pool):
        super().__init__(pool)

    def _do_submit_job(self, job, run_times):
        with _JOB_LOCK:
            _QUEUED[job.id] = {
                "id": job.id,
                "source": job.name,
                "trigger": "scheduled",
                "queued_at": datetime.now(timezone.utc),
                "scheduled_for": run_times[-1] if run_times else None,
            }
        super()._do_submit_job(job, run_times)


scheduler = BackgroundScheduler(
    executors={"refresh": _RefreshPoolExecutor(_refresh_executor)},
    job_defaults={
        "coalesce": True,
        "max_instances": 1,
        # None = a late job runs late instead of being dropped. APScheduler's
        # default of 1 second silently dropped any job delayed by a busy pool
        # or a sleeping laptop.
        "misfire_grace_time": None,
    },
)

_STARTED_AT = time.time()


def _job_id(name: str) -> str:
    return f"src:{name}"


def _schedule_names() -> list[str]:
    """Schedule rows in run order: every source except the derived members,
    then the derived step itself."""
    names = [n for n in SOURCES if n not in schedules.DERIVED_MEMBERS]
    return names + [schedules.DERIVED]


def _status_for(name: str, statuses: dict):
    """The status row that drives a schedule's clock (derived -> boom_score)."""
    return statuses.get(schedules.DERIVED_MEMBERS[0] if name == schedules.DERIVED else name)


def _timed_job(job_id: str, fn, *args):
    """Wrapper every scheduled job runs through: marks it started (no longer
    queued) and records its duration and lateness for the job event."""
    started_wall = datetime.now(timezone.utc)
    started = time.monotonic()
    with _JOB_LOCK:
        entry = _QUEUED.pop(job_id, None)
    scheduled_for = entry.get("scheduled_for") if entry else None
    late = (started_wall - scheduled_for).total_seconds() if scheduled_for else None
    try:
        return fn(*args)
    finally:
        with _JOB_LOCK:
            _JOB_TIMING[job_id] = (int((time.monotonic() - started) * 1000), late)


def _run_derived() -> None:
    """boom_score reads every other source; alerts diffs boom_score. In order."""
    for name in schedules.DERIVED_MEMBERS:
        spec = SOURCES[name]
        ingest.run_source(refresh_conn, name, spec.fetch, spec.store)


def _run_source_now(name: str) -> None:
    """Run one source (or the derived step) and let its outcome set its clock."""
    if name == schedules.DERIVED:
        _run_derived()
        return
    spec = SOURCES[name]
    result = ingest.run_source(refresh_conn, name, spec.fetch, spec.store)
    try:
        _after_run(name, result)
    except Exception:  # noqa: BLE001 - bookkeeping must never fail the run
        logger.exception("post-run scheduling for %s failed", name)


def _set_next_run(job_id: str, when: datetime) -> None:
    """Move an enabled job's next run. A paused (disabled) job stays paused."""
    job = scheduler.get_job(job_id)
    if job is None or getattr(job, "next_run_time", None) is None:
        return
    scheduler.modify_job(job_id, next_run_time=when)


def _after_run(name: str, result: "ingest.RunResult", request_derived: bool = True) -> None:
    """Outcome drives the clock: ok -> one interval (or the next time slot)
    after this success; error -> now + retry; deferred -> the time the source
    asked for. Errors and deferrals get that time written onto their run row,
    so the page can say when the next attempt is."""
    if name in schedules.DERIVED_MEMBERS:
        return
    if request_derived and (result.outcome == "ok" or result.record_count):
        _request_derived()
    sched = db.get_source_schedule(refresh_conn, name)
    if sched is None:
        return
    statuses = {s.source: s for s in db.get_source_statuses(refresh_conn)}
    due = schedules.next_due(sched, statuses.get(name), datetime.now(timezone.utc))
    if result.outcome in ("error", "deferred"):
        db.set_source_next_attempt(
            refresh_conn, name, result.run_id, due.isoformat(timespec="seconds"))
    _set_next_run(_job_id(name), due)


def _request_derived() -> None:
    """Pull the derived step forward to run shortly after fresh upstream data.

    Debounced: it only ever moves *earlier*, to now + DERIVED_DEBOUNCE_SECONDS,
    so a burst of sources finishing together coalesces into one recompute. If a
    derived run is already waiting on the refresh thread it will run after this
    source anyway, so nothing needs to move.
    """
    job_id = _job_id(schedules.DERIVED)
    with _JOB_LOCK:
        if any(e["source"] == schedules.DERIVED for e in _QUEUED.values()):
            return
    job = scheduler.get_job(job_id)
    current = getattr(job, "next_run_time", None) if job else None
    if current is None:
        return  # not installed yet, or disabled by an admin
    target = datetime.now(timezone.utc) + timedelta(seconds=config.DERIVED_DEBOUNCE_SECONDS)
    if current > target:
        scheduler.modify_job(job_id, next_run_time=target)


def _enqueue(name: str, trigger: str = "manual"):
    """Queue a one-off run of `name` on the refresh thread (not via the
    scheduler, so a disabled schedule stays disabled)."""
    key = f"{trigger}:{name}:{next(_MANUAL_SEQ)}"
    with _JOB_LOCK:
        _QUEUED[key] = {
            "id": key, "source": name, "trigger": trigger,
            "queued_at": datetime.now(timezone.utc), "scheduled_for": None,
        }

    def body():
        with _JOB_LOCK:
            _QUEUED.pop(key, None)
        _run_source_now(name)

    return _refresh_executor.submit(body)


def _queued_snapshot() -> list[dict]:
    now = datetime.now(timezone.utc)
    with _JOB_LOCK:
        entries = list(_QUEUED.values())
    out = []
    for e in sorted(entries, key=lambda x: x["queued_at"]):
        out.append({
            "id": e["id"],
            "source": e["source"],
            "trigger": e["trigger"],
            "queued_at": e["queued_at"].isoformat(timespec="seconds"),
            "scheduled_for": e["scheduled_for"].isoformat(timespec="seconds")
            if e["scheduled_for"] else None,
            "waiting_seconds": round((now - e["queued_at"]).total_seconds(), 1),
        })
    return out


def _first_run_time(sched, status, now: datetime, stagger: int = 0) -> datetime:
    """When an (enabled) schedule should next fire, honouring its history, but
    never sooner than the startup floor — staggered so startup keeps the
    registry's order on the single refresh thread."""
    floor = now + timedelta(seconds=config.SCHEDULER_STARTUP_DELAY_SECONDS + stagger)
    return max(schedules.next_due(sched, status, now), floor)


def _load_schedules() -> dict:
    """Seed missing rows from the registry, then read them back. A row that no
    longer validates (hand-edited DB) falls back to its default, loudly."""
    defaults = {
        s.source: s for s in schedules.defaults_from_specs(
            SOURCES, config.REFRESH_INTERVAL_SECONDS, config.SCHEDULE_DEFAULT_TZ)
    }
    db.seed_source_schedules(conn, list(defaults.values()))
    rows = db.get_source_schedules(conn)
    out = {}
    for name in _schedule_names():
        row = rows.get(name) or defaults[name]
        try:
            out[name] = schedules.validate(row)
        except ValueError as exc:
            logger.error("schedule for %s is invalid (%s); using the default", name, exc)
            out[name] = defaults[name]
    return out


def _install_source_jobs() -> None:
    scheds = _load_schedules()
    statuses = {s.source: s for s in db.get_source_statuses(conn)}
    now = datetime.now(timezone.utc)
    for i, name in enumerate(_schedule_names()):
        sched = scheds[name]
        first = _first_run_time(sched, _status_for(name, statuses), now, stagger=i) \
            if sched.enabled else None
        scheduler.add_job(
            _timed_job,
            schedules.build_trigger(sched),
            args=[_job_id(name), _run_source_now, name],
            id=_job_id(name),
            name=name,
            executor="refresh",
            next_run_time=first,
            replace_existing=True,
        )


def _apply_schedule(sched) -> None:
    """Re-arm a source's job after an edit (no-op before the scheduler has jobs)."""
    job_id = _job_id(sched.source)
    if scheduler.get_job(job_id) is None:
        return
    trigger = schedules.build_trigger(sched)
    if not sched.enabled:
        scheduler.modify_job(job_id, trigger=trigger, next_run_time=None)
        return
    statuses = {s.source: s for s in db.get_source_statuses(conn)}
    nxt = _first_run_time(sched, _status_for(sched.source, statuses), datetime.now(timezone.utc))
    scheduler.modify_job(job_id, trigger=trigger, next_run_time=nxt)


def _snapshot_suggestion_history(for_date: str) -> None:
    """Record every user's suggestions for `for_date`, so the history calendar
    has a row per trading day whether or not anyone opened the app."""
    for user in db.get_users(refresh_conn):
        try:
            digest = suggestions.build_digest(refresh_conn, for_date, user_id=user.id)
            suggestion_history.record(refresh_conn, digest, user.id)
        except Exception:
            logger.exception("suggestion history snapshot failed for user %s", user.id)


def _send_daily_digest():
    """Scheduled pre-market: deliver the next trading day's suggestions."""
    target = next_trading_day()
    if not is_trading_day(target):
        return
    _snapshot_suggestion_history(target.isoformat())
    try:
        notify.send_digest(refresh_conn, target.isoformat())
    except Exception:
        # Delivery is already resilient; never let the job crash the scheduler.
        logger.exception("daily digest delivery failed")


# Kept under its old name: the settings route and tests validate with it.
parse_analysis_time = schedules.parse_hhmm


def analysis_trigger(settings: AppSettings) -> CronTrigger:
    """Weekday cron trigger for the daily deep-analysis run."""
    hour, minute = parse_analysis_time(settings.analysis_time)
    return CronTrigger(
        day_of_week="mon-fri", hour=hour, minute=minute,
        timezone=ZoneInfo(settings.analysis_tz),
    )


def _run_daily_analysis():
    """Scheduled deep run: refresh the sources, recompute analyses, boom scores
    and alerts, then deliver the digest for the relevant trading session.

    Runs on the refresh thread, so it queues behind (never interleaves with)
    the per-source jobs. Sources marked ``force_on_daily=False`` (slowly
    published or hard rate-limited upstreams) are left to their own schedule
    rather than being hit an extra time; a disabled schedule stays disabled.
    """
    scheds = db.get_source_schedules(refresh_conn)
    for name, spec in SOURCES.items():
        if name in schedules.DERIVED_MEMBERS or not spec.force_on_daily:
            continue
        sched = scheds.get(name)
        if sched is not None and not sched.enabled:
            continue
        result = ingest.run_source(refresh_conn, name, spec.fetch, spec.store)
        try:
            _after_run(name, result, request_derived=False)
        except Exception:  # noqa: BLE001
            logger.exception("post-run scheduling for %s failed", name)
    derived = scheds.get(schedules.DERIVED)
    if derived is None or derived.enabled:
        _run_derived()
    settings = db.get_app_settings(refresh_conn)
    try:
        today = datetime.now(ZoneInfo(settings.analysis_tz)).date()
        target = today if is_trading_day(today) else next_trading_day(today)
        _snapshot_suggestion_history(target.isoformat())
        notify.send_digest(refresh_conn, target.isoformat())
    except Exception:
        # Delivery is already resilient; never let the job crash the scheduler.
        logger.exception("post-analysis digest delivery failed")


_JOB_EVENT_NAMES = {
    EVENT_JOB_EXECUTED: "executed",
    EVENT_JOB_ERROR: "error",
    # Cannot happen with misfire_grace_time=None; mapped so old rows still read.
    EVENT_JOB_MISSED: "missed",
    # Not a drop: the fire is merged into the run already queued/running.
    EVENT_JOB_MAX_INSTANCES: "coalesced",
}


def _on_job_event(event):
    """Persist every scheduler outcome that is not already a source_runs row.

    A per-source job's normal execution is recorded by its source_runs row, so
    only its exceptional events (error, coalesced, started late) are written
    here; every other job's execution is written with its duration.
    """
    name = _JOB_EVENT_NAMES.get(event.code, str(event.code))
    duration_ms = late = None
    if event.code in (EVENT_JOB_EXECUTED, EVENT_JOB_ERROR):
        with _JOB_LOCK:
            timing = _JOB_TIMING.pop(event.job_id, None)
            _QUEUED.pop(event.job_id, None)
        if timing:
            duration_ms, late = timing

    detail = None
    if getattr(event, "exception", None) is not None:
        detail = "".join(
            traceback.format_exception(
                type(event.exception), event.exception, event.exception.__traceback__)
        )[-4000:]
        logger.error("job %s raised", event.job_id, exc_info=event.exception)
    elif name == "coalesced":
        detail = ("fired while this job's previous run was still queued or running "
                  "on the refresh thread; merged into that run rather than started twice")
        logger.info("job %s coalesced", event.job_id)
    elif name == "missed":
        logger.warning("job %s missed", event.job_id)
    elif late is not None and late >= _LATE_NOTE_SECONDS:
        detail = f"started {int(late)}s after its scheduled time (queued behind other work)"

    if name == "executed" and str(event.job_id).startswith("src:") and detail is None:
        return
    try:
        db.record_job_run(
            refresh_conn, event.job_id, name, _now_iso(), duration_ms=duration_ms, detail=detail)
    except Exception:  # noqa: BLE001 - diagnostics must never break the scheduler
        logger.exception("failed to record job run for %s", event.job_id)


def _prune_history():
    """Trim append-only history so the DB doesn't grow without bound.

    boom_score_history alone accumulates one row per watched ticker every
    refresh cycle — ~4k rows/day.
    """
    try:
        deleted = db.prune_history(
            refresh_conn,
            config.SOURCE_RUN_RETENTION_DAYS,
            config.JOB_RUN_RETENTION_DAYS,
            config.BOOM_HISTORY_RETENTION_DAYS,
        )
        if any(deleted.values()):
            logger.info("pruned history: %s", deleted)
    except Exception:  # noqa: BLE001
        logger.exception("history prune failed")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _add_timed_job(fn, trigger, job_id: str) -> None:
    scheduler.add_job(
        _timed_job, trigger, args=[job_id, fn], id=job_id, name=job_id,
        executor="refresh", replace_existing=True,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_listener(
        _on_job_event,
        EVENT_JOB_EXECUTED | EVENT_JOB_ERROR | EVENT_JOB_MISSED | EVENT_JOB_MAX_INSTANCES,
    )
    _install_source_jobs()
    # Everything that writes through refresh_conn runs on the refresh thread.
    _add_timed_job(_prune_history, CronTrigger(hour=3, minute=17), "prune_history")
    _add_timed_job(
        _send_daily_digest,
        CronTrigger(
            day_of_week="mon-fri",
            hour=config.DIGEST_HOUR,
            minute=config.DIGEST_MINUTE,
            timezone=ZoneInfo(config.DIGEST_TZ),
        ),
        "daily_digest",
    )
    _add_timed_job(
        _run_daily_analysis, analysis_trigger(db.get_app_settings(conn)), "daily_analysis")
    # 6-hourly GitHub update check. Runs on the default executor, not the
    # serial "refresh" one: it only shells out to git and never touches SQLite.
    updater.schedule(scheduler)
    scheduler.start()
    yield
    # Stop firing, drop work that has not started yet (a restart re-derives
    # every source's next run from its history, so nothing is lost), then drain
    # the run in progress: an ingestion job killed mid-write leaves the WAL to
    # grow unchecked (it was 7.5 MB uncheckpointed before this).
    #
    # The drain must happen BEFORE scheduler.shutdown(): that call holds the
    # scheduler's job-store lock while it waits for executors, and a finishing
    # run re-arms its own job through that same lock (_after_run) — waiting
    # inside shutdown() deadlocks.
    try:
        scheduler.pause()
    except Exception:  # noqa: BLE001 - never started (e.g. startup failed)
        pass
    _refresh_executor.shutdown(wait=True, cancel_futures=True)
    try:
        scheduler.shutdown(wait=True)
    except Exception:  # noqa: BLE001
        logger.exception("scheduler shutdown failed")
    for label, connection in (("request", conn), ("refresh", refresh_conn)):
        try:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            connection.close()
        except Exception:  # noqa: BLE001
            logger.exception("closing the %s connection failed", label)


app = FastAPI(title="Stock Signal Dashboard", lifespan=lifespan)
app.add_middleware(SecurityHeadersMiddleware)

# Everything under /api requires an active session except health and auth itself.
_PUBLIC_PATHS = {"/api/health"}
_PUBLIC_PREFIXES = ("/api/auth/",)


@app.middleware("http")
async def _authenticate(request, call_next):
    request.state.user = auth.resolve_user(conn, request)
    path = request.url.path
    protected = (
        path.startswith("/api")
        and path not in _PUBLIC_PATHS
        and not path.startswith(_PUBLIC_PREFIXES)
    )
    if protected and request.state.user is None:
        return JSONResponse(status_code=401, content={"detail": "not authenticated"})
    return await call_next(request)


# CORS is added last (outermost) so even 401s from the auth middleware carry
# CORS headers — the browser then surfaces the status instead of a CORS error.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,  # session cookie
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_auth.build_router(conn))
app.include_router(routes_oauth.build_router(conn))
app.include_router(routes_update.build_router())


@app.exception_handler(Exception)
async def _unhandled_exception(request: Request, exc: Exception):
    """Log the traceback before returning a generic 500.

    Starlette re-raises unhandled errors so uvicorn can log them, which meant
    they only ever reached the discarded console. Log them ourselves so they
    land in the rotating file, and keep the response body free of internals.
    """
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "internal server error"})


@app.get("/api/health")
def health():
    """Cheap liveness probe. Public, and always HTTP 200 by design.

    start.ps1 polls this to decide the app came up, so a degraded subsystem must
    not read as "failed to start" — the status field carries that instead.
    Detailed diagnostics live behind the admin-only /api/server/* routes.
    """
    checks = {"db": False, "scheduler": scheduler.running}
    try:
        conn.execute("SELECT 1").fetchone()
        checks["db"] = True
    except Exception:  # noqa: BLE001
        logger.exception("health check: db probe failed")
    return {
        "status": "ok" if all(checks.values()) else "degraded",
        "version": __version__,
        "commit": updater.STARTUP_COMMIT,
        "uptime_seconds": round(time.time() - _STARTED_AT, 1),
        "checks": checks,
    }


@app.get("/api/contracts")
def contracts():
    return [c.model_dump() for c in db.get_contracts(conn)]


@app.get("/api/news")
def news():
    return [n.model_dump() for n in db.get_news(conn)]


@app.get("/api/trades")
def trades():
    return [t.model_dump() for t in db.get_trades(conn)]


@app.get("/api/yield-curve")
def yield_curve():
    return [p.model_dump() for p in db.get_yield_curve(conn)]


@app.get("/api/econ-calendar")
def econ_calendar(importance: str | None = None):
    imp = importance if importance in ("high", "medium", "low") else None
    events = db.get_econ_events(
        conn,
        config.ECON_CALENDAR_DAYS_AHEAD,
        config.ECON_CALENDAR_DAYS_BACK,
        imp,
    )
    return [e.model_dump() for e in events]


@app.get("/api/signals")
def signals():
    return [s.model_dump() for s in db.get_technical_signals(conn)]


@app.get("/api/fear-greed")
def fear_greed():
    return [s.model_dump() for s in db.get_fear_greed(conn)]


@app.get("/api/vix")
def vix():
    return [p.model_dump() for p in db.get_vix(conn)]


@app.get("/api/aaii")
def aaii():
    return [s.model_dump() for s in db.get_aaii(conn)]


@app.get("/api/put-call")
def put_call():
    return [p.model_dump() for p in db.get_put_call(conn)]


@app.get("/api/margin-debt")
def margin_debt():
    return margin_debt_source.compute_yoy(db.get_margin_debt(conn))


@app.get("/api/sentiment")
def market_sentiment():
    return sentiment.build_summary(conn)


@app.get("/api/quotes")
def live_quotes(user=Depends(auth.get_current_user)):
    tickers = sorted(
        set(db.get_watched_tickers_for_user(conn, user.id))
        | {h.ticker for h in db.get_portfolio(conn, user.id)}
    )
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # Clock-based session authority so the UI flips at 9:30 ET even when quotes
    # are cached/empty or Yahoo's per-quote marketState lags.
    status = market_status()
    # Cache slightly under the configured poll cadence so each client poll gets
    # at most one fresh Yahoo fetch, shared across concurrent clients.
    interval = db.get_app_settings(conn).quotes_refresh_seconds
    ttl = min(config.QUOTES_TTL_SECONDS, max(5, interval - 5))
    # FX rides the same endpoint and cache but is appended, not merged into the
    # watchlist: a watchlist ticker is fed to technicals, boom score and
    # earnings, and none of those mean anything for a currency pair. The strip
    # is still worth showing when the user holds nothing.
    fx = quotes.decorate_fx(quotes.get_quotes(config.FX_PAIRS, ttl_seconds=ttl)) \
        if config.FX_PAIRS else []
    equities = quotes.get_quotes(tickers, ttl_seconds=ttl) if tickers else []
    return {
        "as_of": now,
        "market_status": status,
        "quotes": [q.model_dump() for q in [*equities, *fx]],
    }


@app.get("/api/congress-trades")
def congress_trades():
    return [t.model_dump() for t in db.get_congress_trades(conn)]


@app.get("/api/short-interest")
def short_interest():
    return [s.model_dump() for s in db.get_short_interest(conn)]


@app.get("/api/social")
def social():
    return [s.model_dump() for s in db.get_social_sentiment(conn)]


@app.get("/api/analyst")
def analyst():
    return [s.model_dump() for s in db.get_analyst_signals(conn)]


@app.get("/api/boom-scores")
def boom_scores():
    return [s.model_dump() for s in db.get_boom_scores(conn)]


@app.get("/api/fundamentals")
def fundamentals():
    return [f.model_dump() for f in db.get_fundamentals(conn)]


@app.get("/api/x-posts")
def x_posts():
    return [p.model_dump() for p in db.get_x_posts(conn)]


@app.get("/api/seasonality")
def seasonality():
    return [s.model_dump() for s in db.get_seasonality(conn)]


# ---------- chart bars (on-demand, for the pro chart) ----------
@app.get("/api/chart/{ticker}")
def chart_bars(ticker: str, interval: str = "1d", prepost: bool = False):
    if interval not in chart_data.INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"interval must be one of {', '.join(chart_data.INTERVALS)}",
        )
    t = clean_ticker(ticker)
    try:
        return chart_data.get_bars(t, interval, prepost)
    except Exception:
        logger.warning("chart data fetch failed for %s (%s)", t, interval, exc_info=True)
        raise HTTPException(status_code=502, detail="chart data unavailable")


@app.get("/api/sparklines")
def sparklines(tickers: str = "", range: str = "1m"):
    """Batch trailing close-series for the watchlist/portfolio row sparklines.
    `range` is one of 1d/3d/1w/1m; invalid tickers are skipped, not fatal."""
    rng = range if range in chart_data.SPARK_RANGES else "1m"
    syms: list[str] = []
    for raw in tickers.split(","):
        try:
            t = clean_ticker(raw)
        except HTTPException:
            continue  # skip malformed symbols rather than failing the batch
        if t and t not in syms:
            syms.append(t)
        if len(syms) >= 60:
            break
    return {"range": rng, "series": chart_data.get_sparklines(syms, rng)}


# ---------- search & on-demand analysis (any ticker) ----------
@app.get("/api/search", dependencies=[Depends(rate_limit("search", 30, 60))])
def search_stocks(q: str = ""):
    q = q.strip()
    if not (1 <= len(q) <= 40):
        raise HTTPException(status_code=400, detail="query must be 1-40 characters")
    try:
        return search.search(q)
    except Exception:
        logger.warning("stock search failed for %r", q, exc_info=True)
        raise HTTPException(status_code=502, detail="search unavailable")


@app.get("/api/analyze/{ticker}", dependencies=[Depends(rate_limit("analyze", 10, 60))])
def analyze_ticker(ticker: str, user=Depends(auth.get_current_user)):
    """Full analysis for ANY ticker — stored for holdings, computed live otherwise."""
    t = clean_ticker(ticker)
    try:
        result = analyze.analyze(conn, t)
    except Exception:
        logger.warning("on-demand analysis failed for %s", t, exc_info=True)
        raise HTTPException(status_code=502, detail="analysis data unavailable")
    a = result["analysis"]
    if a is not None:
        profile = db.get_notify_profile(conn, user.id)
        a = analysis.apply_sizing(a, profile.account_size, profile.risk_pct)
    return {
        "analysis": a.model_dump() if a else None,
        "daily": [b.model_dump() for b in result["daily"]],
        "weekly": [b.model_dump() for b in result["weekly"]],
        "source": result["source"],
        "seasonality_anchors": analyze.get_anchors(conn, t),
        "x_posts": [p.model_dump() for p in db.get_x_posts_for(conn, t)],
        # Company identity + who's trading it. Both come from getters that
        # already exist, so the analysis page stays one round trip.
        "company": _company_payload(t),
        "insider_trades": [tr.model_dump() for tr in db.get_trades_for(conn, t)],
        # The signal sidecar. Every one of these was already stored per ticker
        # and simply wasn't being surfaced on this page.
        "signals": _signal_payload(t),
        "watchlists": db.get_watchlist_map(conn, user.id).get(t, []),
        # This ticker's alerts, each carrying what its type actually means. One
        # extra indexed query rather than a second round trip, and the meaning
        # ships from the same module as the detectors so it can't drift.
        "alerts": [
            {**al.model_dump(), "explain": alerts_source.ALERT_MEANING.get(al.type)}
            for al in db.get_alerts_for(conn, user.id, t)
        ],
    }


def _signal_payload(ticker: str) -> dict:
    """Boom score, technicals, analyst, social and short interest for a ticker.
    Anything not stored comes back as None so the UI can say so."""
    boom = db.get_boom_score_for(conn, ticker)
    tech = db.get_technical_signal_for(conn, ticker)
    analyst_sig = db.get_analyst_for(conn, ticker)
    social = db.get_social_for(conn, ticker)
    short = db.get_short_interest_for(conn, ticker)
    return {
        "boom": boom.model_dump() if boom else None,
        "technical": tech.model_dump() if tech else None,
        "analyst": analyst_sig.model_dump() if analyst_sig else None,
        "social": social.model_dump() if social else None,
        "short_interest": short.model_dump() if short else None,
    }


def _company_payload(ticker: str) -> dict:
    """Profile + ownership for a ticker. Absent data stays absent — a ticker
    with no fundamentals row returns nulls rather than invented values."""
    f = db.get_fundamentals_for(conn, ticker)
    officers = []
    if f and f.officers_json:
        try:
            officers = json.loads(f.officers_json)
        except ValueError:
            officers = []
    # The company name may exist from a Form 4 filing even when Yahoo
    # fundamentals haven't been fetched for this ticker yet.
    fallback_name = db.get_company_names(conn, [ticker]).get(ticker)
    return {
        "profile": f.model_dump() if f else None,
        "name": (f.name if f and f.name else None) or fallback_name,
        "officers": officers,
        "holders": [h.model_dump() for h in db.get_company_holders_for(conn, ticker)],
    }


@app.get("/api/company/{ticker}")
def company(ticker: str, user=Depends(auth.get_current_user)):
    return _company_payload(clean_ticker(ticker))


class DrawingsUpdate(BaseModel):
    shapes: list[dict] = []


# A drawing is a handful of points; this bounds a pathological payload without
# getting in the way of real annotation.
_MAX_SHAPES = 200


@app.get("/api/drawings/{ticker}")
def get_drawings(ticker: str, user=Depends(auth.get_current_user)):
    return db.get_drawings(conn, user.id, clean_ticker(ticker))


@app.put("/api/drawings/{ticker}")
def put_drawings(ticker: str, body: DrawingsUpdate, user=Depends(auth.get_current_user)):
    if len(body.shapes) > _MAX_SHAPES:
        raise HTTPException(status_code=400, detail=f"at most {_MAX_SHAPES} drawings per ticker")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.save_drawings(conn, user.id, clean_ticker(ticker), body.shapes, now)
    return {"shapes": body.shapes, "updated_at": now}


@app.get("/api/company-names")
def company_names(user=Depends(auth.get_current_user)):
    """ticker -> company name, for the "show names instead of symbols" setting.
    Tickers we have no name for are absent; the UI falls back to the symbol."""
    return db.get_all_company_names(conn)


# ---------- per-holding technical analysis ----------
@app.get("/api/analysis")
def analyses(user=Depends(auth.get_current_user)):
    profile = db.get_notify_profile(conn, user.id)
    return [
        analysis.apply_sizing(a, profile.account_size, profile.risk_pct).model_dump()
        for a in db.get_all_analyses(conn)
    ]


@app.get("/api/analysis/{ticker}/report")
def analysis_report(ticker: str, print: int = 0, user=Depends(auth.get_current_user)):
    """Self-contained HTML report. Default downloads; ?print=1 opens inline
    with an auto-print hook so the browser's dialog offers Save as PDF."""
    t = clean_ticker(ticker)
    profile = db.get_notify_profile(conn, user.id)
    anchors = analyze.get_anchors(conn, t)
    html_doc = report.build_report(conn, t, print_mode=bool(print), profile=profile,
                                   anchors_override=anchors)
    if html_doc is None:
        # Not a holding — build the analysis on demand so any ticker gets a report.
        try:
            result = analyze.analyze(conn, t)
        except Exception:
            logger.warning("on-demand report analysis failed for %s", t, exc_info=True)
            result = None
        if result and result["analysis"] is not None:
            html_doc = report.build_report(
                conn, t, print_mode=bool(print), profile=profile,
                analysis_override=result["analysis"], daily_override=result["daily"],
                anchors_override=anchors,
            )
    if html_doc is None:
        raise HTTPException(status_code=404, detail=f"no analysis for {t}")
    today = datetime.now(timezone.utc).date().isoformat()
    headers = {} if print else {
        "Content-Disposition": f'attachment; filename="{t}-analysis-{today}.html"'
    }
    return HTMLResponse(content=html_doc, headers=headers)


@app.get("/api/analysis/{ticker}")
def analysis_detail(ticker: str, user=Depends(auth.get_current_user)):
    t = clean_ticker(ticker)
    a = db.get_analysis(conn, t)
    if a is not None:
        profile = db.get_notify_profile(conn, user.id)
        a = analysis.apply_sizing(a, profile.account_size, profile.risk_pct)
    return {
        "analysis": a.model_dump() if a else None,
        "daily": [b.model_dump() for b in db.get_ohlc(conn, t, "daily")],
        "weekly": [b.model_dump() for b in db.get_ohlc(conn, t, "weekly")],
    }


# ---------- portfolio (user managed) ----------
class HoldingCreate(BaseModel):
    ticker: str
    shares: float
    avg_cost: float


def _portfolio_out(user_id: int) -> list[dict]:
    """Portfolio holdings enriched with theme category + its source ('manual'
    when overridden, else 'auto' from sector/industry classification)."""
    overrides = db.get_holding_categories(conn, user_id)
    fund_map = db.get_fundamentals_map(conn)
    out = []
    for h in db.get_portfolio(conn, user_id):
        if h.ticker in overrides:
            category, source = overrides[h.ticker], "manual"
        else:
            sector, industry = fund_map.get(h.ticker, (None, None))
            category, source = themes.classify(h.ticker, sector, industry), "auto"
        out.append({**h.model_dump(), "category": category, "category_source": source})
    return out


@app.get("/api/portfolio")
def portfolio(user=Depends(auth.get_current_user)):
    return _portfolio_out(user.id)


@app.post("/api/portfolio")
def add_holding(item: HoldingCreate, user=Depends(auth.get_current_user)):
    ticker = clean_ticker(item.ticker)
    if item.shares <= 0 or item.avg_cost < 0:
        raise HTTPException(status_code=400, detail="shares must be > 0 and avg_cost >= 0")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.upsert_holding(conn, user.id, Holding(
        ticker=ticker, shares=item.shares, avg_cost=item.avg_cost, added_at=now,
    ))
    return _portfolio_out(user.id)


class HoldingReplace(BaseModel):
    shares: float
    avg_cost: float


@app.put("/api/portfolio/{ticker}")
def edit_holding(ticker: str, item: HoldingReplace, user=Depends(auth.get_current_user)):
    """Overwrite a held position outright (correct a mistaken entry)."""
    t = clean_ticker(ticker)
    if item.shares <= 0 or item.avg_cost < 0:
        raise HTTPException(status_code=400, detail="shares must be > 0 and avg_cost >= 0")
    held = {h.ticker for h in db.get_portfolio(conn, user.id)}
    if t not in held:
        raise HTTPException(status_code=404, detail="ticker not in portfolio")
    db.replace_holding(conn, user.id, t, item.shares, item.avg_cost)
    return _portfolio_out(user.id)


class CategoryUpdate(BaseModel):
    category: str | None = None  # null clears the override (back to auto)


@app.put("/api/portfolio/{ticker}/category")
def set_holding_category(ticker: str, item: CategoryUpdate, user=Depends(auth.get_current_user)):
    t = clean_ticker(ticker)
    if item.category is not None and item.category not in themes.THEMES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be null or one of {', '.join(themes.THEMES)}",
        )
    held = {h.ticker for h in db.get_portfolio(conn, user.id)}
    if t not in held:
        raise HTTPException(status_code=404, detail="ticker not in portfolio")
    db.set_holding_category(conn, user.id, t, item.category)
    return _portfolio_out(user.id)


@app.delete("/api/portfolio/{ticker}")
def delete_holding(ticker: str, user=Depends(auth.get_current_user)):
    db.remove_holding(conn, user.id, clean_ticker(ticker))
    return _portfolio_out(user.id)


# ---------- notification profile (email/phone; secrets stay in env) ----------
class ProfileUpdate(BaseModel):
    # All optional: a field left None keeps the stored value (the notifications
    # form and the trading-risk form each PUT only their own fields).
    email: str | None = None
    phone: str | None = None
    email_enabled: bool | None = None
    sms_enabled: bool | None = None
    account_size: float | None = None
    risk_pct: float | None = None


@app.get("/api/profile")
def get_profile(user=Depends(auth.get_current_user)):
    return db.get_notify_profile(conn, user.id).model_dump()


@app.put("/api/profile")
def put_profile(item: ProfileUpdate, user=Depends(auth.get_current_user)):
    cur = db.get_notify_profile(conn, user.id)
    email = ((item.email if item.email is not None else cur.email) or "").strip() or None
    phone = ((item.phone if item.phone is not None else cur.phone) or "").strip() or None
    if email and "@" not in email:
        raise HTTPException(status_code=400, detail="invalid email")
    if phone and not phone.startswith("+"):
        raise HTTPException(status_code=400, detail="phone must be E.164 (start with +)")
    email_enabled = item.email_enabled if item.email_enabled is not None else cur.email_enabled
    sms_enabled = item.sms_enabled if item.sms_enabled is not None else cur.sms_enabled
    account_size = item.account_size if item.account_size is not None else cur.account_size
    if account_size is not None and account_size < 0:
        raise HTTPException(status_code=400, detail="account_size must be >= 0")
    risk_pct = item.risk_pct if item.risk_pct is not None else cur.risk_pct
    risk_pct = max(0.1, min(10.0, risk_pct if risk_pct else 1.0))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.upsert_notify_profile(conn, user.id, NotifyProfile(
        email=email, phone=phone,
        email_enabled=bool(email_enabled and email),
        sms_enabled=bool(sms_enabled and phone),
        account_size=account_size, risk_pct=risk_pct,
        updated_at=now,
    ))
    return db.get_notify_profile(conn, user.id).model_dump()


# ---------- app settings (analysis schedule + refresh cadence) ----------
class SettingsUpdate(BaseModel):
    # All optional: a field left None keeps the stored value.
    analysis_time: str | None = None
    analysis_tz: str | None = None
    quotes_refresh_seconds: int | None = None
    x_accounts: list[str] | None = None


# X handles: 1–15 chars, letters/digits/underscore (Twitter's own rule).
_X_HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")


def _settings_payload() -> dict:
    settings = db.get_app_settings(conn)
    payload = settings.model_dump()
    # Show the *effective* monitored accounts: fall back to the env default when
    # none have been configured in settings yet.
    if not payload["x_accounts"]:
        payload["x_accounts"] = list(config.X_ACCOUNTS)
    # Next scheduled run: prefer the live scheduler job, fall back to computing
    # from the trigger (tests run without the scheduler started).
    next_run = None
    try:
        job = scheduler.get_job("daily_analysis")
        if job and job.next_run_time:
            next_run = job.next_run_time.isoformat(timespec="seconds")
        else:
            trigger = analysis_trigger(settings)
            fire = trigger.get_next_fire_time(None, datetime.now(ZoneInfo(settings.analysis_tz)))
            next_run = fire.isoformat(timespec="seconds") if fire else None
    except Exception:
        pass
    payload["next_analysis_run"] = next_run
    return payload


@app.get("/api/settings")
def get_settings():
    return _settings_payload()


@app.put("/api/settings")
def put_settings(item: SettingsUpdate, user=Depends(auth.get_current_user)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="admin only")
    cur = db.get_app_settings(conn)
    analysis_time = (item.analysis_time if item.analysis_time is not None else cur.analysis_time).strip()
    analysis_tz = (item.analysis_tz if item.analysis_tz is not None else cur.analysis_tz).strip()
    try:
        parse_analysis_time(analysis_time)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        ZoneInfo(analysis_tz)
    except Exception:
        raise HTTPException(status_code=400, detail="unknown timezone")
    quotes_refresh = item.quotes_refresh_seconds if item.quotes_refresh_seconds is not None \
        else cur.quotes_refresh_seconds
    quotes_refresh = max(10, min(300, int(quotes_refresh)))
    if item.x_accounts is not None:
        cleaned: list[str] = []
        for raw in item.x_accounts:
            handle = raw.strip().lstrip("@")
            if not handle:
                continue
            if not _X_HANDLE_RE.match(handle):
                raise HTTPException(status_code=400, detail=f"invalid X handle: {raw!r}")
            if handle not in cleaned:
                cleaned.append(handle)
        x_accounts = cleaned
    else:
        x_accounts = cur.x_accounts
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    settings = AppSettings(
        analysis_time=analysis_time, analysis_tz=analysis_tz,
        quotes_refresh_seconds=quotes_refresh, x_accounts=x_accounts, updated_at=now,
    )
    db.upsert_app_settings(conn, settings)
    # Re-arm the daily deep run at the new wall-clock time (no-op in tests,
    # where the scheduler was never started).
    try:
        if scheduler.get_job("daily_analysis"):
            scheduler.reschedule_job("daily_analysis", trigger=analysis_trigger(settings))
    except Exception:
        pass
    return _settings_payload()


# ---------- suggestions (digest preview + delivery) ----------
@app.get("/api/suggestions")
def get_suggestions(user=Depends(auth.get_current_user)):
    digest = suggestions.build_digest(conn, next_trading_day().isoformat(), user_id=user.id)
    # Snapshot as a safety net so a day is never lost if the scheduled job
    # didn't run; the first write for a (user, ticker, day) wins.
    try:
        suggestion_history.record(conn, digest, user.id)
    except Exception:
        logger.exception("suggestion history snapshot failed")
    return digest


@app.get("/api/suggestions/history")
def suggestions_history(
    ticker: str | None = None,
    months: int = 6,
    user=Depends(auth.get_current_user),
):
    """Past suggestions for watched/held tickers, with the realised move at
    each horizon computed from stored bars."""
    months = max(1, min(24, months))
    clean = clean_ticker(ticker) if ticker else None
    rows = db.get_suggestion_history(conn, user.id, clean, months)
    return {
        "entries": suggestion_history.with_outcomes(conn, rows),
        "horizons": list(suggestion_history.HORIZONS),
    }


@app.post("/api/suggestions/send-test")
def send_test_suggestions(user=Depends(auth.get_current_user)):
    return {"results": notify.send_digest_for_user(conn, user.id)}


@app.get("/api/suggestions/log")
def suggestions_log():
    # Fetch a wider window so the UI's per-channel view (2 email + 2 SMS) is
    # not starved when recent rows are dominated by `alert` deliveries.
    return [e.model_dump() for e in db.get_recent_suggestions(conn, limit=60)]


# ---------- alerts ----------
class AlertsRead(BaseModel):
    keys: list[str] | None = None
    all: bool = False


def _alerts_payload(user_id: int):
    return {
        "alerts": [a.model_dump() for a in db.get_alerts(conn, user_id)],
        "unread": db.count_unread_alerts(conn, user_id),
    }


@app.get("/api/alerts")
def alerts(user=Depends(auth.get_current_user)):
    return _alerts_payload(user.id)


@app.post("/api/alerts/read")
def alerts_read(body: AlertsRead, user=Depends(auth.get_current_user)):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.mark_alerts_read(conn, user.id, body.keys if not body.all else None, read_at=now)
    return _alerts_payload(user.id)


@app.get("/api/boom-scores/history/{ticker}")
def boom_score_history(ticker: str, user=Depends(auth.get_current_user)):
    return db.get_boom_score_history(conn, clean_ticker(ticker))


# ---------- watchlists (multiple named lists, user managed) ----------
class WatchCreate(BaseModel):
    ticker: str
    note: str = ""
    list_id: int | None = None


class WatchUpdate(BaseModel):
    """Move a watched ticker between lists and/or edit its note.

    `to_list_id=None` edits in place; `note=None` keeps the stored note, so a
    move never silently drops it.
    """
    from_list_id: int
    to_list_id: int | None = None
    note: str | None = None


class WatchlistCreate(BaseModel):
    name: str = ""


class WatchlistRename(BaseModel):
    name: str


@app.get("/api/watchlists")
def watchlists(user=Depends(auth.get_current_user)):
    return [w.model_dump() for w in db.get_watchlists(conn, user.id)]


@app.post("/api/watchlists")
def create_watchlist(body: WatchlistCreate, user=Depends(auth.get_current_user)):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.create_watchlist(conn, user.id, body.name, now)
    return [w.model_dump() for w in db.get_watchlists(conn, user.id)]


@app.patch("/api/watchlists/{list_id}")
def rename_watchlist(list_id: int, body: WatchlistRename, user=Depends(auth.get_current_user)):
    if not db.rename_watchlist(conn, user.id, list_id, body.name):
        raise HTTPException(status_code=400, detail="invalid name or watchlist")
    return [w.model_dump() for w in db.get_watchlists(conn, user.id)]


@app.delete("/api/watchlists/{list_id}")
def delete_watchlist(list_id: int, user=Depends(auth.get_current_user)):
    if not db.delete_watchlist(conn, user.id, list_id):
        raise HTTPException(status_code=409, detail="cannot delete your only watchlist")
    return [w.model_dump() for w in db.get_watchlists(conn, user.id)]


@app.get("/api/watchlist")
def watchlist(list_id: int | None = None, user=Depends(auth.get_current_user)):
    return [w.model_dump() for w in db.get_watchlist(conn, user.id, list_id)]


@app.post("/api/watchlist")
def add_watch(item: WatchCreate, user=Depends(auth.get_current_user)):
    ticker = clean_ticker(item.ticker)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.add_watch(conn, user.id, WatchItem(ticker=ticker, note=item.note.strip(), added_at=now), item.list_id)
    return [w.model_dump() for w in db.get_watchlist(conn, user.id, item.list_id)]


@app.patch("/api/watchlist/{ticker}")
def patch_watch(ticker: str, body: WatchUpdate, user=Depends(auth.get_current_user)):
    ok = db.update_watch(
        conn, user.id, clean_ticker(ticker),
        body.from_list_id, body.to_list_id, body.note,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="ticker or watchlist not found")
    return [w.model_dump() for w in db.get_watchlist(conn, user.id, body.from_list_id)]


@app.delete("/api/watchlist/{ticker}")
def delete_watch(ticker: str, list_id: int | None = None, user=Depends(auth.get_current_user)):
    db.remove_watch(conn, user.id, clean_ticker(ticker), list_id)
    return [w.model_dump() for w in db.get_watchlist(conn, user.id, list_id)]


@app.get("/api/earnings")
def earnings(
    date_from: str | None = None,
    date_to: str | None = None,
    scope: str = "all",
    user=Depends(auth.get_current_user),
):
    """Earnings calendar. scope=mine limits it to what this user tracks.

    Each row carries `is_estimate`, `held` and `watched` so the UI can show a
    projected date differently from a confirmed one, and the user's own names
    differently from the general market.
    """
    tickers = None
    held = set(h.ticker for h in db.get_portfolio(conn, user.id))
    watched = {w.ticker for w in db.get_watchlist(conn, user.id)}
    if scope == "mine":
        tickers = sorted(held | watched)
        if not tickers:
            return []
    rows = db.get_earnings(conn, date_from, date_to, tickers)
    return [
        {**e.model_dump(), "held": e.ticker in held, "watched": e.ticker in watched}
        for e in rows
    ]


@app.get("/api/earnings/{ticker}")
def earnings_for(ticker: str, user=Depends(auth.get_current_user)):
    """One company's next date plus its reported history."""
    t = clean_ticker(ticker)
    rows = db.get_earnings_for(conn, t)
    today = datetime.now(timezone.utc).date().isoformat()
    upcoming = [e for e in rows if e.event_date >= today]
    return {
        "ticker": t,
        "next": upcoming[-1].model_dump() if upcoming else None,
        "history": [e.model_dump() for e in rows if e.event_date < today],
    }


@app.get("/api/backtest/track-record")
def backtest_track_record(months: int = 12, user=Depends(auth.get_current_user)):
    """How the app's own suggestions have actually turned out, for this user."""
    return backtest.track_record(conn, user.id, months=max(1, min(months, 60)))


@app.get("/api/backtest/signal-replay")
def backtest_signal_replay(
    horizon: int = 7, months: int = 12, user=Depends(auth.get_current_user)
):
    """Boom-score threshold crossings vs the forward move that followed."""
    return backtest.signal_replay(
        conn, horizon_days=max(1, min(horizon, 90)), months=max(1, min(months, 60)))


@app.get("/api/sources")
def sources():
    return [s.model_dump() for s in db.get_source_statuses(conn)]


# ---------- server introspection (admin only) ----------
# Everything here exposes the DB path, tracebacks and machine stats, so it is
# gated to admins rather than any signed-in user.

def _require_admin(user=Depends(auth.get_current_user)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="admin only")
    return user


def _process_stats() -> dict:
    """Process/system metrics, or an honest 'unavailable' when psutil isn't there.

    Reporting zeros for a missing dependency would be indistinguishable from a
    genuinely idle machine.
    """
    if psutil is None:
        return {"available": False, "reason": "psutil is not installed"}
    try:
        proc = psutil.Process()
        with proc.oneshot():
            mem = proc.memory_info()
            return {
                "available": True,
                "pid": proc.pid,
                "rss_bytes": mem.rss,
                "cpu_percent": proc.cpu_percent(interval=None),
                "num_threads": proc.num_threads(),
                "open_files": len(proc.open_files()),
                "system": {
                    "cpu_percent": psutil.cpu_percent(interval=None),
                    "per_cpu": psutil.cpu_percent(interval=None, percpu=True),
                    "mem_percent": psutil.virtual_memory().percent,
                },
            }
    except Exception as exc:  # noqa: BLE001 - diagnostics must not 500
        return {"available": False, "reason": f"{type(exc).__name__}: {exc}"}


def _db_stats() -> dict:
    path = Path(config.DB_PATH)
    out = {"path": str(path.resolve()) if path.exists() else config.DB_PATH}
    for label, suffix in (("size_bytes", ""), ("wal_bytes", "-wal")):
        target = Path(str(path) + suffix)
        out[label] = target.stat().st_size if target.exists() else 0
    return out


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


def _job_next_run(job_id: str) -> str | None:
    job = scheduler.get_job(job_id)
    return _iso(getattr(job, "next_run_time", None)) if job else None


@app.get("/api/server/overview")
def server_overview(user=Depends(_require_admin)):
    jobs = []
    for job in scheduler.get_jobs():
        nxt = getattr(job, "next_run_time", None)
        jobs.append({
            "id": job.id,
            "next_run_at": nxt.isoformat() if nxt else None,
            "trigger": str(job.trigger),
        })
    return {
        "version": __version__,
        "commit": updater.STARTUP_COMMIT,
        "started_at": datetime.fromtimestamp(_STARTED_AT, tz=timezone.utc).isoformat(timespec="seconds"),
        "uptime_seconds": round(time.time() - _STARTED_AT, 1),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "process": _process_stats(),
        "db": _db_stats(),
        "scheduler": {"running": scheduler.running, "jobs": jobs},
        # What the ingestion worker is doing at this exact moment...
        "running_sources": ingest.running_sources(),
        # ...and what is waiting its turn on the single refresh thread.
        "queued": _queued_snapshot(),
    }


def _schedule_payload(sched) -> dict:
    row = sched.model_dump()
    row["description"] = schedules.describe(sched)
    row["next_run_at"] = _job_next_run(_job_id(sched.source))
    row["members"] = list(schedules.DERIVED_MEMBERS) if sched.source == schedules.DERIVED else []
    return row


@app.get("/api/server/sources")
def server_sources(user=Depends(_require_admin)):
    """Every registered source — including ones that have never run — with its
    status, both clocks, run counters, schedule and next run."""
    stats = db.get_source_run_stats(conn)
    statuses = {s.source: s for s in db.get_source_statuses(conn)}
    scheds = db.get_source_schedules(conn)
    running = ingest.running_sources()
    queued = {e["source"] for e in _queued_snapshot()}
    out = []
    for name, spec in SOURCES.items():
        sched_name = schedules.DERIVED if name in schedules.DERIVED_MEMBERS else name
        status = statuses.get(name)
        row = {
            "source": name, "status": None, "last_refreshed_at": None,
            "record_count": None, "error_detail": None, "last_success_at": None,
            "last_duration_ms": None, "next_attempt_at": None,
        }
        if status is not None:
            row.update(status.model_dump())
        row.update(stats.get(name, {}))
        row["never_run"] = status is None
        sched = scheds.get(sched_name)
        row["schedule"] = (
            {**sched.model_dump(), "description": schedules.describe(sched)} if sched else None)
        row["next_run_at"] = _job_next_run(_job_id(sched_name))
        row["force_on_daily"] = spec.force_on_daily
        row["running_for_seconds"] = running.get(name)
        row["queued"] = sched_name in queued or name in queued
        out.append(row)
    return out


@app.get("/api/server/sources/{source_name}/runs")
def server_source_runs(source_name: str, limit: int = 10, user=Depends(_require_admin)):
    """One source's recent runs, each with its own full traceback."""
    if source_name not in SOURCES:
        raise HTTPException(status_code=404, detail="unknown source")
    limit = max(1, min(limit, 100))
    return [r.model_dump() for r in db.get_source_runs(conn, source_name, limit=limit)]


@app.get("/api/server/events")
def server_events(
    limit: int = 60,
    kind: str | None = None,
    event_id: str | None = Query(None, alias="id"),
    user=Depends(_require_admin),
):
    """Recent source runs and scheduler job events, newest first, interleaved.

    `kind` (source | job) and `id` (a source name or job id) narrow it on the
    server, so "show similar" gets a full page of that one thing rather than
    whatever happened to be in the last page.
    """
    if kind not in (None, "", "source", "job"):
        raise HTTPException(status_code=400, detail="kind must be 'source' or 'job'")
    limit = max(1, min(limit, 300))
    events = []
    if kind in (None, "", "source"):
        for run in db.get_source_runs(conn, source=event_id or None, limit=limit):
            events.append({
                "key": f"source:{run.id}", "kind": "source", "at": run.finished_at,
                "id": run.source, "outcome": run.outcome, "duration_ms": run.duration_ms,
                "record_count": run.record_count, "detail": run.detail,
                "next_attempt_at": run.next_attempt_at,
                "has_error_detail": bool(run.error_detail),
            })
    if kind in (None, "", "job"):
        for job in db.get_job_runs(conn, limit=limit, job_id=event_id or None):
            events.append({
                "key": f"job:{job.id}", "kind": "job", "at": job.at, "id": job.job_id,
                "outcome": job.event, "duration_ms": job.duration_ms,
                "record_count": None, "detail": job.detail,
                "next_attempt_at": None, "has_error_detail": False,
            })
    events.sort(key=lambda e: e["at"] or "", reverse=True)
    return events[:limit]


# ---------- per-source schedules (admin) ----------
class ScheduleUpdate(BaseModel):
    mode: str | None = None
    interval_seconds: int | None = None
    times: list[str] | None = None
    days: list[str] | None = None
    tz: str | None = None
    enabled: bool | None = None
    retry_seconds: int | None = None


@app.get("/api/server/schedules")
def get_schedules(user=Depends(_require_admin)):
    scheds = db.get_source_schedules(conn)
    return [_schedule_payload(scheds[n]) for n in _schedule_names() if n in scheds]


@app.put("/api/server/schedules/{source_name}")
def put_schedule(source_name: str, item: ScheduleUpdate, user=Depends(_require_admin)):
    if source_name not in _schedule_names():
        raise HTTPException(status_code=404, detail="unknown schedule")
    current = db.get_source_schedule(conn, source_name)
    if current is None:
        raise HTTPException(status_code=404, detail="unknown schedule")
    changes = item.model_dump(exclude_unset=True)
    # An explicit null retry means "back to the default"; any other null is ignored.
    changes = {k: v for k, v in changes.items() if v is not None or k == "retry_seconds"}
    try:
        updated = schedules.validate(current.model_copy(update=changes))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    updated = updated.model_copy(update={"updated_at": _now_iso()})
    db.upsert_source_schedule(conn, updated)
    try:
        _apply_schedule(updated)
    except Exception:  # noqa: BLE001 - the row is saved; the job re-arms on restart
        logger.exception("re-arming %s after a schedule edit failed", source_name)
    return _schedule_payload(updated)


@app.post("/api/server/schedules/{source_name}/run-now", status_code=202)
def run_schedule_now(source_name: str, user=Depends(_require_admin)):
    """Run once now, on the refresh thread, without touching the schedule."""
    if source_name not in _schedule_names():
        raise HTTPException(status_code=404, detail="unknown schedule")
    _enqueue(source_name, "run-now")
    return {"source": source_name, "queued": True}


def _manual_refresh_gate(source_name: str) -> tuple[str, str] | None:
    """(why, next run) when a non-forced manual refresh should not run now.

    Only sources with a politeness cadence (a registry min_interval: GDELT,
    margin_debt, congress, ...) are gated, and only until their schedule says
    they are due. The answer goes back in the response — nothing is queued and
    no run row is written, so there is no silent skip.
    """
    spec = SOURCES[source_name]
    if spec.min_interval is None or source_name in schedules.DERIVED_MEMBERS:
        return None
    sched = db.get_source_schedule(conn, source_name)
    status = {s.source: s for s in db.get_source_statuses(conn)}.get(source_name)
    if sched is None or status is None:
        return None
    now = datetime.now(timezone.utc)
    due = schedules.next_due(sched, status, now)
    if due <= now:
        return None
    state = status.status or ""
    when = due.isoformat(timespec="seconds")
    if state.startswith("deferred"):
        return f"deferred until {when}: {state.removeprefix('deferred: ')}", when
    if state.startswith("error"):
        return f"failed recently; the retry is scheduled for {when}", when
    return f"up to date (last success {status.last_success_at}); next scheduled run {when}", when


@app.post(
    "/api/refresh/{source_name}",
    status_code=202,
    dependencies=[Depends(rate_limit("refresh", 120, 60))],
)
def refresh(source_name: str, force: bool = False, user=Depends(auth.get_current_user)):
    """Queue a refresh and return immediately.

    This used to run the fetch inline on the request thread. A slow source
    (margin_debt is 3 tiers x a 30s timeout; technical is 30s x N tickers,
    sequentially) then held the request open for minutes — and the dashboard
    fires 19 of these at once. The work now goes to the single refresh thread
    that the scheduler also uses, so it never races a scheduled run.

    A source that is fresh on its politeness cadence answers `queued: false`
    with the reason and its next scheduled run. `force=1` bypasses that and is
    admin-only: it is the one path that can hammer a rate-limited upstream.
    """
    if source_name not in SOURCES:
        raise HTTPException(status_code=404, detail="unknown source")
    if force and not user.is_admin:
        raise HTTPException(status_code=403, detail="admin only")
    # .get(): a source that has never run has no source_status row at all.
    statuses = {s.source: s for s in db.get_source_statuses(refresh_conn)}
    current = statuses.get(source_name)
    payload = {"source": source_name, "status": current.model_dump() if current else None}
    gate = None if force else _manual_refresh_gate(source_name)
    if gate:
        reason, due = gate
        return {**payload, "queued": False, "reason": reason, "next_run_at": due}
    _enqueue(source_name, "manual")
    return {**payload, "queued": True}


# ---------- single-port static serving (serve the built frontend `dist/`) ----------
def _mount_spa(app: FastAPI, dist: Path) -> bool:
    """Serve a built Vite frontend from `dist` on the same port as the API.

    No-op (returns False) when there is no build, so the dev 2-process flow and
    the test suite are unaffected. The catch-all MUST be the last route
    registered so it never shadows an API route; unknown `/api/*` paths 404
    rather than silently returning index.html. The auth middleware already
    guards only `/api*`, and hash routing needs nothing more here.
    """
    index = dist / "index.html"
    if not index.is_file():
        return False
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")
    dist_root = str(dist.resolve())

    @app.get("/{path:path}")
    def spa(path: str):
        if path.startswith("api"):
            raise HTTPException(status_code=404, detail="not found")
        if path:
            candidate = (dist / path).resolve()
            # real file inside dist → serve it; guard against path traversal
            if candidate.is_file() and str(candidate).startswith(dist_root):
                return FileResponse(str(candidate))
        return FileResponse(str(index), headers={"Cache-Control": "no-cache"})

    return True


_DIST = (Path(config.STATIC_DIR) if config.STATIC_DIR
         else Path(__file__).resolve().parents[2] / "frontend" / "dist")
_mount_spa(app, _DIST)
