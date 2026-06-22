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


# Module-level fetchers so tests can monkeypatch them with stubs.
def contracts_fetch():
    start, end = config.contracts_date_window()
    return usaspending.fetch(start, end, config.CONTRACTS_LIMIT)


def news_fetch():
    return gdelt.fetch(config.NEWS_QUERY, config.NEWS_LIMIT)


def trades_fetch():
    return edgar.fetch(config.EDGAR_LIMIT, config.SEC_USER_AGENT)


# One shared connection (SQLite with check_same_thread=False).
conn = db.connect(config.DB_PATH)
db.init_schema(conn)

# Registry of scheduler-driven sources: name -> (fetch, store).
SOURCES = {
    "usaspending": (lambda: contracts_fetch(), db.upsert_contracts),
    "gdelt": (lambda: news_fetch(), db.upsert_news),
    "edgar": (lambda: trades_fetch(), db.upsert_trades),
}

scheduler = BackgroundScheduler()


def _refresh_all():
    for name, (fetch, store) in SOURCES.items():
        ingest.run_source(conn, name, fetch, store)


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
    fetch, store = SOURCES[source_name]
    ingest.run_source(conn, source_name, fetch, store)
    statuses = {s.source: s for s in db.get_source_statuses(conn)}
    return statuses[source_name].model_dump()
