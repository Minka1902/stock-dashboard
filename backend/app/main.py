"""FastAPI surface + scheduler wiring."""
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from fastapi.responses import HTMLResponse, JSONResponse

from app import analysis, analyze, auth, chart_data, config, db, ingest, notify, quotes, report, routes_auth, search, sentiment, suggestions, themes
from app import alerts as alerts_source
from app.logging_config import setup_logging
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
    return macro + gdelt.fetch_for_tickers(tickers, names, config.NEWS_PER_TICKER_LIMIT)


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


def x_posts_fetch(conn):
    """Monitor configured X accounts. known_tickers = watchlist ∪ portfolio, so
    posts get their cashtags/matches tagged against symbols the user tracks.
    Accounts come from app settings (admin-editable), falling back to the env
    default when none are configured."""
    known = set(db.get_all_watched_tickers(conn)) | set(db.get_all_portfolio_tickers(conn))
    accounts = db.get_app_settings(conn).x_accounts or config.X_ACCOUNTS
    return x_posts_source.fetch(accounts, known)


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
    tickers = db.get_all_portfolio_tickers(conn)
    if not tickers:
        return []
    return ohlc_source.fetch(tickers)


def analysis_fetch(conn):
    """Per-holding technical analysis from stored OHLC + live price.

    Computed once per ticker across all users and stored UNSIZED; each user's
    account size / risk % is applied at read time (analysis.apply_sizing)."""
    tickers = db.get_all_portfolio_tickers(conn)
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


def build_sources(conn):
    """Registry bound to a connection: name -> (fetch, store, min_interval).

    Fetch closures reference the module-global fetcher names (so tests can still
    monkeypatch them) and pass in `conn`; store fns take the connection from
    ingest.run_source. Ordering matters: boom_score is a pure DB computation and
    must run after every source it reads; alerts must run last (diffs boom_score).
    """
    return {
        "usaspending": (lambda: contracts_fetch(conn), db.upsert_contracts, None),
        "gdelt":       (lambda: news_fetch(conn), db.upsert_news, config.GDELT_MIN_INTERVAL_SECONDS),
        "edgar":       (lambda: trades_fetch(conn), db.upsert_trades, None),
        "yield_curve": (lambda: yield_curve_source.fetch(config.YIELD_CURVE_MONTHS), db.upsert_yield_curve, None),
        "econ_calendar": (lambda: econ_calendar_fetch(conn), db.upsert_econ_events, config.ECON_CALENDAR_MIN_INTERVAL_SECONDS),
        "technical":   (lambda: signals_fetch(conn), db.upsert_technical_signals, None),
        "fear_greed":  (lambda: fear_greed_source.fetch(), db.upsert_fear_greed, None),
        "vix":         (lambda: vix_source.fetch(config.VIX_RANGE), db.upsert_vix, None),
        "aaii":        (lambda: aaii_source.fetch(), db.upsert_aaii, config.AAII_MIN_INTERVAL_SECONDS),
        "put_call":    (lambda: put_call_source.fetch(), db.upsert_put_call, config.PUT_CALL_MIN_INTERVAL_SECONDS),
        "margin_debt": (lambda: margin_debt_source.fetch(), db.upsert_margin_debt, config.MARGIN_DEBT_MIN_INTERVAL_SECONDS),
        "congress":       (lambda: congress_source.fetch(config.CONGRESS_LOOKBACK_DAYS), db.upsert_congress_trades, config.CONGRESS_MIN_INTERVAL_SECONDS),
        "short_interest": (lambda: short_interest_source.fetch(db.get_all_watched_tickers(conn)), db.upsert_short_interest, None),
        "social":         (lambda: social_source.fetch(db.get_all_watched_tickers(conn)), db.upsert_social_sentiment, None),
        "analyst":        (lambda: analyst_source.fetch(db.get_all_watched_tickers(conn)), db.upsert_analyst_signals, None),
        "fundamentals":   (lambda: fundamentals_fetch(conn), db.upsert_fundamentals, None),
        "x_posts":        (lambda: x_posts_fetch(conn), db.upsert_x_posts, config.X_MIN_INTERVAL_SECONDS),
        "seasonality":    (lambda: seasonality_fetch(conn), db.upsert_seasonality, config.SEASONALITY_MIN_INTERVAL_SECONDS),
        "boom_score":     (lambda: score_fetch(conn), db.upsert_boom_scores, None),
        "ohlc":           (lambda: ohlc_fetch(conn), db.upsert_ohlc, 3600),  # 2y history barely moves intraday
        "analysis":       (lambda: analysis_fetch(conn), db.upsert_analyses, None),  # after ohlc; cheap DB+quote read
        "alerts":         (lambda: alerts_source.detect(conn), db.upsert_alerts, None),  # must be last (diffs boom_score)
    }


# The scheduler and the manual-refresh route drive ingestion through the refresh
# connection; API read routes use `conn`.
SOURCES = build_sources(refresh_conn)

scheduler = BackgroundScheduler()


def _refresh_all():
    for name, (fetch, store, min_interval) in SOURCES.items():
        ingest.run_source(refresh_conn, name, fetch, store, min_interval_seconds=min_interval)


def _send_daily_digest():
    """Scheduled pre-market: deliver the next trading day's suggestions."""
    target = next_trading_day()
    if not is_trading_day(target):
        return
    try:
        notify.send_digest(refresh_conn, target.isoformat())
    except Exception:
        # Delivery is already resilient; never let the job crash the scheduler.
        logger.exception("daily digest delivery failed")


def parse_analysis_time(value: str) -> tuple[int, int]:
    """Validate "HH:MM" (24h) and return (hour, minute). Raises ValueError."""
    parts = value.strip().split(":")
    if len(parts) != 2:
        raise ValueError("time must be HH:MM")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("time must be HH:MM in 24h range")
    return hour, minute


def analysis_trigger(settings: AppSettings) -> CronTrigger:
    """Weekday cron trigger for the daily deep-analysis run."""
    hour, minute = parse_analysis_time(settings.analysis_time)
    return CronTrigger(
        day_of_week="mon-fri", hour=hour, minute=minute,
        timezone=ZoneInfo(settings.analysis_tz),
    )


def _run_daily_analysis():
    """Scheduled deep run: force-refresh every source (bypassing per-source
    min-interval throttles), which recomputes analyses, boom scores and alerts,
    then deliver the digest for the relevant trading session."""
    for name, (fetch, store, min_interval) in SOURCES.items():
        ingest.run_source(refresh_conn, name, fetch, store,
                          min_interval_seconds=min_interval, force=True)
    settings = db.get_app_settings(refresh_conn)
    try:
        today = datetime.now(ZoneInfo(settings.analysis_tz)).date()
        target = today if is_trading_day(today) else next_trading_day(today)
        notify.send_digest(refresh_conn, target.isoformat())
    except Exception:
        # Delivery is already resilient; never let the job crash the scheduler.
        logger.exception("post-analysis digest delivery failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(
        _refresh_all,
        "interval",
        seconds=config.REFRESH_INTERVAL_SECONDS,
        id="refresh_all",
        replace_existing=True,
    )
    scheduler.add_job(
        _send_daily_digest,
        CronTrigger(
            day_of_week="mon-fri",
            hour=config.DIGEST_HOUR,
            minute=config.DIGEST_MINUTE,
            timezone=ZoneInfo(config.DIGEST_TZ),
        ),
        id="daily_digest",
        replace_existing=True,
    )
    scheduler.add_job(
        _run_daily_analysis,
        analysis_trigger(db.get_app_settings(conn)),
        id="daily_analysis",
        replace_existing=True,
    )
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


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


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
        {w.ticker for w in db.get_watchlist(conn, user.id)}
        | {h.ticker for h in db.get_portfolio(conn, user.id)}
    )
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # Clock-based session authority so the UI flips at 9:30 ET even when quotes
    # are cached/empty or Yahoo's per-quote marketState lags.
    status = market_status()
    if not tickers:
        return {"as_of": now, "market_status": status, "quotes": []}
    # Cache slightly under the configured poll cadence so each client poll gets
    # at most one fresh Yahoo fetch, shared across concurrent clients.
    interval = db.get_app_settings(conn).quotes_refresh_seconds
    ttl = min(config.QUOTES_TTL_SECONDS, max(5, interval - 5))
    return {
        "as_of": now,
        "market_status": status,
        "quotes": [q.model_dump() for q in quotes.get_quotes(tickers, ttl_seconds=ttl)],
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
    }


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
    return suggestions.build_digest(conn, next_trading_day().isoformat(), user_id=user.id)


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
def boom_score_history(ticker: str):
    return db.get_boom_score_history(conn, clean_ticker(ticker))


# ---------- watchlist (user managed, no external source) ----------
class WatchCreate(BaseModel):
    ticker: str
    note: str = ""


@app.get("/api/watchlist")
def watchlist(user=Depends(auth.get_current_user)):
    return [w.model_dump() for w in db.get_watchlist(conn, user.id)]


@app.post("/api/watchlist")
def add_watch(item: WatchCreate, user=Depends(auth.get_current_user)):
    ticker = clean_ticker(item.ticker)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.add_watch(conn, user.id, WatchItem(ticker=ticker, note=item.note.strip(), added_at=now))
    return [w.model_dump() for w in db.get_watchlist(conn, user.id)]


@app.delete("/api/watchlist/{ticker}")
def delete_watch(ticker: str, user=Depends(auth.get_current_user)):
    db.remove_watch(conn, user.id, clean_ticker(ticker))
    return [w.model_dump() for w in db.get_watchlist(conn, user.id)]


@app.get("/api/sources")
def sources():
    return [s.model_dump() for s in db.get_source_statuses(conn)]


@app.post("/api/refresh/{source_name}", dependencies=[Depends(rate_limit("refresh", 30, 60))])
def refresh(source_name: str):
    if source_name not in SOURCES:
        raise HTTPException(status_code=404, detail="unknown source")
    fetch, store, min_interval = SOURCES[source_name]
    # Ingestion runs on the refresh connection (shared with the scheduler,
    # serialized by its lock) so a manual refresh never blocks request reads.
    ingest.run_source(refresh_conn, source_name, fetch, store, min_interval_seconds=min_interval)
    statuses = {s.source: s for s in db.get_source_statuses(refresh_conn)}
    return statuses[source_name].model_dump()
