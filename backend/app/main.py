"""FastAPI surface + scheduler wiring."""
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import config, db, ingest
from app.models import WatchItem
from app.sources import edgar, gdelt, usaspending
import app.sources.yield_curve as yield_curve_source
import app.sources.technical as technical_source
import app.sources.fear_greed as fear_greed_source
import app.sources.congress as congress_source
import app.sources.short_interest as short_interest_source
import app.sources.social as social_source
import app.sources.analyst as analyst_source
import app.sources.fundamentals as fundamentals_source
import app.sources.seasonality as seasonality_source
import app.sources.boom_score as boom_score_source


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
    "congress":       (lambda: congress_source.fetch(config.CONGRESS_LOOKBACK_DAYS), db.upsert_congress_trades, config.CONGRESS_MIN_INTERVAL_SECONDS),
    "short_interest": (lambda: short_interest_source.fetch([w.ticker for w in db.get_watchlist(conn)]), db.upsert_short_interest, None),
    "social":         (lambda: social_source.fetch([w.ticker for w in db.get_watchlist(conn)]), db.upsert_social_sentiment, None),
    "analyst":        (lambda: analyst_source.fetch([w.ticker for w in db.get_watchlist(conn)]), db.upsert_analyst_signals, None),
    "fundamentals":   (lambda: fundamentals_fetch(), db.upsert_fundamentals, None),
    "seasonality":    (lambda: seasonality_fetch(), db.upsert_seasonality, config.SEASONALITY_MIN_INTERVAL_SECONDS),
    "boom_score":     (lambda: score_fetch(), db.upsert_boom_scores, None),  # must be last
}

scheduler = BackgroundScheduler()


def _refresh_all():
    for name, (fetch, store, min_interval) in SOURCES.items():
        ingest.run_source(conn, name, fetch, store, min_interval_seconds=min_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(
        _refresh_all,
        "interval",
        seconds=config.REFRESH_INTERVAL_SECONDS,
        id="refresh_all",
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
