"""FastAPI surface + scheduler wiring."""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import analysis, config, db, ingest, notify, quotes, sentiment, suggestions
from app import alerts as alerts_source
from app.market_calendar import is_trading_day, next_trading_day
from app.models import Holding, NotifyProfile, WatchItem
from app.sources import edgar, gdelt, usaspending
import app.sources.yield_curve as yield_curve_source
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


# Module-level fetchers so tests can monkeypatch them with stubs.
def contracts_fetch():
    start, end = config.contracts_date_window()
    return usaspending.fetch(start, end, config.CONTRACTS_LIMIT)


def news_fetch():
    return gdelt.fetch(config.NEWS_QUERY, config.NEWS_LIMIT)


def trades_fetch():
    return edgar.fetch(config.EDGAR_LIMIT, config.SEC_USER_AGENT)


def signals_fetch():
    tickers = [w.ticker for w in db.get_watchlist(conn)]
    if not tickers:
        return []
    return technical_source.fetch(tickers, config.ALPHA_VANTAGE_KEY)


def fundamentals_fetch():
    tickers = [w.ticker for w in db.get_watchlist(conn)]
    if not tickers:
        return []
    return fundamentals_source.fetch(tickers)


def seasonality_fetch():
    tickers = [w.ticker for w in db.get_watchlist(conn)]
    if not tickers:
        return []
    return seasonality_source.fetch(tickers, config.SEASONALITY_RANGE)


def score_fetch():
    tickers = [w.ticker for w in db.get_watchlist(conn)]
    if not tickers:
        return []
    return boom_score_source.compute_all(tickers, conn)


def ohlc_fetch():
    tickers = [h.ticker for h in db.get_portfolio(conn)]
    if not tickers:
        return []
    return ohlc_source.fetch(tickers)


def analysis_fetch():
    """Per-holding technical analysis from stored OHLC + live price + risk settings."""
    holdings = db.get_portfolio(conn)
    if not holdings:
        return []
    profile = db.get_notify_profile(conn)
    quote_map = {q.ticker: q.price for q in quotes.get_quotes([h.ticker for h in holdings])}
    out = []
    for h in holdings:
        daily = db.get_ohlc(conn, h.ticker, "daily")
        if len(daily) < 30:
            continue  # not enough history yet; skip rather than fabricate
        price = quote_map.get(h.ticker) or daily[-1].close
        out.append(analysis.build(h.ticker, daily, price, profile.account_size, profile.risk_pct))
    return out


# One shared connection (SQLite with check_same_thread=False).
conn = db.connect(config.DB_PATH)
db.init_schema(conn)

# Registry: name -> (fetch_callable, store_fn, min_interval_seconds | None).
SOURCES = {
    "usaspending": (lambda: contracts_fetch(), db.upsert_contracts, None),
    "gdelt":       (lambda: news_fetch(), db.upsert_news, None),
    "edgar":       (lambda: trades_fetch(), db.upsert_trades, None),
    "yield_curve": (lambda: yield_curve_source.fetch(config.YIELD_CURVE_MONTHS), db.upsert_yield_curve, None),
    "technical":   (lambda: signals_fetch(), db.upsert_technical_signals, None),
    "fear_greed":  (lambda: fear_greed_source.fetch(), db.upsert_fear_greed, None),
    "vix":         (lambda: vix_source.fetch(config.VIX_RANGE), db.upsert_vix, None),
    "aaii":        (lambda: aaii_source.fetch(), db.upsert_aaii, config.AAII_MIN_INTERVAL_SECONDS),
    "put_call":    (lambda: put_call_source.fetch(), db.upsert_put_call, config.PUT_CALL_MIN_INTERVAL_SECONDS),
    "margin_debt": (lambda: margin_debt_source.fetch(), db.upsert_margin_debt, config.MARGIN_DEBT_MIN_INTERVAL_SECONDS),
    "congress":       (lambda: congress_source.fetch(config.CONGRESS_LOOKBACK_DAYS), db.upsert_congress_trades, config.CONGRESS_MIN_INTERVAL_SECONDS),
    "short_interest": (lambda: short_interest_source.fetch([w.ticker for w in db.get_watchlist(conn)]), db.upsert_short_interest, None),
    "social":         (lambda: social_source.fetch([w.ticker for w in db.get_watchlist(conn)]), db.upsert_social_sentiment, None),
    "analyst":        (lambda: analyst_source.fetch([w.ticker for w in db.get_watchlist(conn)]), db.upsert_analyst_signals, None),
    "fundamentals":   (lambda: fundamentals_fetch(), db.upsert_fundamentals, None),
    "seasonality":    (lambda: seasonality_fetch(), db.upsert_seasonality, config.SEASONALITY_MIN_INTERVAL_SECONDS),
    "boom_score":     (lambda: score_fetch(), db.upsert_boom_scores, None),
    "ohlc":           (lambda: ohlc_fetch(), db.upsert_ohlc, 3600),  # 2y history barely moves intraday
    "analysis":       (lambda: analysis_fetch(), db.upsert_analyses, None),  # after ohlc; cheap DB+quote read
    "alerts":         (lambda: alerts_source.detect(conn), db.upsert_alerts, None),  # must be last (diffs boom_score)
}

scheduler = BackgroundScheduler()


def _refresh_all():
    for name, (fetch, store, min_interval) in SOURCES.items():
        ingest.run_source(conn, name, fetch, store, min_interval_seconds=min_interval)


def _send_daily_digest():
    """Scheduled pre-market: deliver the next trading day's suggestions."""
    target = next_trading_day()
    if not is_trading_day(target):
        return
    try:
        notify.send_digest(conn, target.isoformat())
    except Exception:
        pass  # delivery is already resilient; never let the job crash the scheduler


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
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Stock Signal Dashboard", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
def live_quotes():
    tickers = sorted(
        {w.ticker for w in db.get_watchlist(conn)} | {h.ticker for h in db.get_portfolio(conn)}
    )
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not tickers:
        return {"as_of": now, "quotes": []}
    return {"as_of": now, "quotes": [q.model_dump() for q in quotes.get_quotes(tickers)]}


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


@app.get("/api/seasonality")
def seasonality():
    return [s.model_dump() for s in db.get_seasonality(conn)]


# ---------- per-holding technical analysis ----------
@app.get("/api/analysis")
def analyses():
    return [a.model_dump() for a in db.get_all_analyses(conn)]


@app.get("/api/analysis/{ticker}")
def analysis_detail(ticker: str):
    t = ticker.strip().upper()
    a = db.get_analysis(conn, t)
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


@app.get("/api/portfolio")
def portfolio():
    return [h.model_dump() for h in db.get_portfolio(conn)]


@app.post("/api/portfolio")
def add_holding(item: HoldingCreate):
    ticker = item.ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker required")
    if item.shares <= 0 or item.avg_cost < 0:
        raise HTTPException(status_code=400, detail="shares must be > 0 and avg_cost >= 0")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.upsert_holding(conn, Holding(
        ticker=ticker, shares=item.shares, avg_cost=item.avg_cost, added_at=now,
    ))
    return [h.model_dump() for h in db.get_portfolio(conn)]


@app.delete("/api/portfolio/{ticker}")
def delete_holding(ticker: str):
    db.remove_holding(conn, ticker.strip().upper())
    return [h.model_dump() for h in db.get_portfolio(conn)]


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
def get_profile():
    return db.get_notify_profile(conn).model_dump()


@app.put("/api/profile")
def put_profile(item: ProfileUpdate):
    cur = db.get_notify_profile(conn)
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
    db.upsert_notify_profile(conn, NotifyProfile(
        email=email, phone=phone,
        email_enabled=bool(email_enabled and email),
        sms_enabled=bool(sms_enabled and phone),
        account_size=account_size, risk_pct=risk_pct,
        updated_at=now,
    ))
    return db.get_notify_profile(conn).model_dump()


# ---------- suggestions (digest preview + delivery) ----------
@app.get("/api/suggestions")
def get_suggestions():
    return suggestions.build_digest(conn, next_trading_day().isoformat())


@app.post("/api/suggestions/send-test")
def send_test_suggestions():
    return {"results": notify.send_digest(conn)}


@app.get("/api/suggestions/log")
def suggestions_log():
    return [e.model_dump() for e in db.get_recent_suggestions(conn)]


# ---------- alerts ----------
class AlertsRead(BaseModel):
    keys: list[str] | None = None
    all: bool = False


def _alerts_payload():
    return {
        "alerts": [a.model_dump() for a in db.get_alerts(conn)],
        "unread": db.count_unread_alerts(conn),
    }


@app.get("/api/alerts")
def alerts():
    return _alerts_payload()


@app.post("/api/alerts/read")
def alerts_read(body: AlertsRead):
    db.mark_alerts_read(conn, body.keys if not body.all else None)
    return _alerts_payload()


@app.get("/api/boom-scores/history/{ticker}")
def boom_score_history(ticker: str):
    return db.get_boom_score_history(conn, ticker.upper())


# ---------- watchlist (user managed, no external source) ----------
class WatchCreate(BaseModel):
    ticker: str
    note: str = ""


@app.get("/api/watchlist")
def watchlist():
    return [w.model_dump() for w in db.get_watchlist(conn)]


@app.post("/api/watchlist")
def add_watch(item: WatchCreate):
    ticker = item.ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker required")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.add_watch(conn, WatchItem(ticker=ticker, note=item.note.strip(), added_at=now))
    return [w.model_dump() for w in db.get_watchlist(conn)]


@app.delete("/api/watchlist/{ticker}")
def delete_watch(ticker: str):
    db.remove_watch(conn, ticker.strip().upper())
    return [w.model_dump() for w in db.get_watchlist(conn)]


@app.get("/api/sources")
def sources():
    return [s.model_dump() for s in db.get_source_statuses(conn)]


@app.post("/api/refresh/{source_name}")
def refresh(source_name: str):
    if source_name not in SOURCES:
        raise HTTPException(status_code=404, detail="unknown source")
    fetch, store, min_interval = SOURCES[source_name]
    ingest.run_source(conn, source_name, fetch, store, min_interval_seconds=min_interval)
    statuses = {s.source: s for s in db.get_source_statuses(conn)}
    return statuses[source_name].model_dump()
