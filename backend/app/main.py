"""FastAPI surface + scheduler wiring."""
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app import config, db, ingest
from app.sources import usaspending


# Module-level so tests can monkeypatch it with a stub.
def contracts_fetch():
    start, end = config.contracts_date_window()
    return usaspending.fetch(start, end, config.CONTRACTS_LIMIT)


# One shared connection (SQLite with check_same_thread=False).
conn = db.connect(config.DB_PATH)
db.init_schema(conn)

# Registry of runnable sources: name -> callable returning records.
SOURCES = {"usaspending": lambda: contracts_fetch()}

scheduler = BackgroundScheduler()


def _refresh_all():
    for name, fetch in SOURCES.items():
        ingest.run_source(conn, name, fetch)


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


@app.get("/api/sources")
def sources():
    return [s.model_dump() for s in db.get_source_statuses(conn)]


@app.post("/api/refresh/{source_name}")
def refresh(source_name: str):
    if source_name not in SOURCES:
        raise HTTPException(status_code=404, detail="unknown source")
    ingest.run_source(conn, source_name, SOURCES[source_name])
    statuses = {s.source: s for s in db.get_source_statuses(conn)}
    return statuses[source_name].model_dump()
