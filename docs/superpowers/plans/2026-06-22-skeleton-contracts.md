# Skeleton + Contracts Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin end-to-end slice of the Stock Signal Dashboard: a FastAPI + SQLite backend that ingests federal contracts from USASpending.gov, tracks per-source freshness, and a React dashboard that shows the contracts and when each source was last refreshed.

**Architecture:** A pure parser turns raw USASpending JSON into normalized `ContractRecord`s (heavily unit-tested, no network). A thin fetch wrapper does the HTTP call. An ingest orchestrator stores records into SQLite and stamps a `source_status` row. FastAPI exposes contracts, source freshness, and a manual refresh trigger; an APScheduler job runs ingestion on an interval. A React (Vite) dashboard renders it.

**Tech Stack:** Python 3.14, FastAPI, Uvicorn, httpx, APScheduler, pytest; React + Vite (JavaScript). SQLite via the stdlib `sqlite3`.

---

## File Structure

```
backend/
  requirements.txt
  .gitignore
  app/
    __init__.py
    config.py          # settings: DB path, refresh interval, date window
    db.py              # connection + schema + contract/source-status queries
    models.py          # Pydantic models: ContractRecord, SourceStatus
    sources/
      __init__.py
      usaspending.py   # parse_response() [pure] + fetch() [thin HTTP]
    ingest.py          # run_source(): fetch -> store -> stamp source_status
    main.py            # FastAPI app, routes, scheduler startup
  tests/
    __init__.py
    conftest.py        # temp-DB fixture
    test_db.py
    test_usaspending.py
    test_ingest.py
    test_api.py
frontend/              # created by `npm create vite`
  src/
    api.js
    App.jsx
    App.css
```

**Responsibilities:**
- `db.py` — all SQLite access. No other module touches the DB directly.
- `sources/usaspending.py` — knows the USASpending API shape; `parse_response` is pure.
- `ingest.py` — orchestration only; depends on a source's `fetch` + `db`.
- `main.py` — HTTP surface + scheduler wiring only.

---

## Task 1: Backend scaffolding

**Files:**
- Create: `backend/requirements.txt`, `backend/.gitignore`, `backend/app/__init__.py`, `backend/tests/__init__.py`

- [ ] **Step 1: Create `backend/requirements.txt`**

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
httpx==0.28.1
apscheduler==3.11.0
pydantic==2.13.4
pytest==8.3.4
```

- [ ] **Step 2: Create `backend/.gitignore`**

```
.venv/
__pycache__/
*.pyc
*.db
.pytest_cache/
```

- [ ] **Step 3: Create empty package files**

Create `backend/app/__init__.py` (empty) and `backend/tests/__init__.py` (empty).

- [ ] **Step 4: Create venv and install deps**

Run (from `backend/`):
```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
```
Expected: installs without errors, ends with "Successfully installed ...".

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/.gitignore backend/app/__init__.py backend/tests/__init__.py
git commit -m "chore: backend scaffolding and deps"
```

---

## Task 2: Config module

**Files:**
- Create: `backend/app/config.py`

- [ ] **Step 1: Create `backend/app/config.py`**

```python
"""Central configuration. Override via environment variables."""
import os
from datetime import date, timedelta

# SQLite file location (one file, no server).
DB_PATH = os.environ.get("STOCKS_DB_PATH", "stocks.db")

# How often the scheduler re-runs fast ingestion, in seconds. Default 3 min.
REFRESH_INTERVAL_SECONDS = int(os.environ.get("STOCKS_REFRESH_SECONDS", "180"))

# How many days back to pull contracts on each run.
CONTRACTS_LOOKBACK_DAYS = int(os.environ.get("STOCKS_CONTRACTS_LOOKBACK_DAYS", "30"))

# Max contracts to pull per refresh.
CONTRACTS_LIMIT = int(os.environ.get("STOCKS_CONTRACTS_LIMIT", "50"))


def contracts_date_window() -> tuple[str, str]:
    """Return (start_date, end_date) ISO strings for the lookback window."""
    end = date.today()
    start = end - timedelta(days=CONTRACTS_LOOKBACK_DAYS)
    return start.isoformat(), end.isoformat()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/config.py
git commit -m "feat: add config module"
```

---

## Task 3: Pydantic models

**Files:**
- Create: `backend/app/models.py`

- [ ] **Step 1: Create `backend/app/models.py`**

```python
"""Normalized data models shared across the app."""
from pydantic import BaseModel


class ContractRecord(BaseModel):
    # Unique, stable id from USASpending (used for dedup/upsert).
    external_id: str
    award_id: str
    recipient_name: str
    amount: float
    awarding_agency: str
    start_date: str  # ISO date string, may be ""
    source: str = "usaspending"


class SourceStatus(BaseModel):
    source: str
    last_refreshed_at: str | None  # ISO timestamp, None if never run
    status: str                    # "ok" or "error: <msg>"
    record_count: int
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: add ContractRecord and SourceStatus models"
```

---

## Task 4: Database layer

**Files:**
- Create: `backend/app/db.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_db.py`

- [ ] **Step 1: Create the temp-DB fixture `backend/tests/conftest.py`**

```python
import pytest
from app import db


@pytest.fixture
def conn(tmp_path):
    """A fresh, schema-initialized SQLite connection backed by a temp file."""
    db_file = tmp_path / "test.db"
    connection = db.connect(str(db_file))
    db.init_schema(connection)
    yield connection
    connection.close()
```

- [ ] **Step 2: Write the failing test `backend/tests/test_db.py`**

```python
from app import db
from app.models import ContractRecord


def _contract(external_id="X1", amount=100.0):
    return ContractRecord(
        external_id=external_id,
        award_id="AWD-" + external_id,
        recipient_name="Acme Corp",
        amount=amount,
        awarding_agency="Dept of Defense",
        start_date="2026-06-01",
    )


def test_upsert_and_get_contracts(conn):
    db.upsert_contracts(conn, [_contract("A", 10.0), _contract("B", 20.0)])
    rows = db.get_contracts(conn)
    assert len(rows) == 2
    # Sorted by amount desc.
    assert rows[0].amount == 20.0


def test_upsert_is_idempotent(conn):
    db.upsert_contracts(conn, [_contract("A", 10.0)])
    db.upsert_contracts(conn, [_contract("A", 99.0)])  # same external_id
    rows = db.get_contracts(conn)
    assert len(rows) == 1
    assert rows[0].amount == 99.0  # updated, not duplicated


def test_source_status_roundtrip(conn):
    db.update_source_status(conn, "usaspending", "2026-06-22T12:00:00", "ok", 2)
    statuses = db.get_source_statuses(conn)
    assert len(statuses) == 1
    assert statuses[0].source == "usaspending"
    assert statuses[0].record_count == 2
    assert statuses[0].last_refreshed_at == "2026-06-22T12:00:00"
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError` / `AttributeError: module 'app.db' has no attribute 'connect'`.

- [ ] **Step 4: Implement `backend/app/db.py`**

```python
"""All SQLite access lives here."""
import sqlite3

from app.models import ContractRecord, SourceStatus


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS contracts (
            external_id     TEXT PRIMARY KEY,
            award_id        TEXT NOT NULL,
            recipient_name  TEXT NOT NULL,
            amount          REAL NOT NULL,
            awarding_agency TEXT NOT NULL,
            start_date      TEXT NOT NULL,
            source          TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_status (
            source            TEXT PRIMARY KEY,
            last_refreshed_at TEXT,
            status            TEXT NOT NULL,
            record_count      INTEGER NOT NULL
        );
        """
    )
    conn.commit()


def upsert_contracts(conn: sqlite3.Connection, records: list[ContractRecord]) -> None:
    conn.executemany(
        """
        INSERT INTO contracts
            (external_id, award_id, recipient_name, amount, awarding_agency, start_date, source)
        VALUES (:external_id, :award_id, :recipient_name, :amount, :awarding_agency, :start_date, :source)
        ON CONFLICT(external_id) DO UPDATE SET
            award_id=excluded.award_id,
            recipient_name=excluded.recipient_name,
            amount=excluded.amount,
            awarding_agency=excluded.awarding_agency,
            start_date=excluded.start_date,
            source=excluded.source
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_contracts(conn: sqlite3.Connection, limit: int = 100) -> list[ContractRecord]:
    cur = conn.execute(
        "SELECT * FROM contracts ORDER BY amount DESC LIMIT ?", (limit,)
    )
    return [ContractRecord(**dict(row)) for row in cur.fetchall()]


def update_source_status(
    conn: sqlite3.Connection,
    source: str,
    last_refreshed_at: str | None,
    status: str,
    record_count: int,
) -> None:
    conn.execute(
        """
        INSERT INTO source_status (source, last_refreshed_at, status, record_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
            last_refreshed_at=excluded.last_refreshed_at,
            status=excluded.status,
            record_count=excluded.record_count
        """,
        (source, last_refreshed_at, status, record_count),
    )
    conn.commit()


def get_source_statuses(conn: sqlite3.Connection) -> list[SourceStatus]:
    cur = conn.execute("SELECT * FROM source_status ORDER BY source")
    return [SourceStatus(**dict(row)) for row in cur.fetchall()]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_db.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/db.py backend/tests/conftest.py backend/tests/test_db.py
git commit -m "feat: add SQLite db layer with contracts and source_status"
```

---

## Task 5: USASpending parser (pure)

**Files:**
- Create: `backend/app/sources/__init__.py` (empty), `backend/app/sources/usaspending.py`
- Test: `backend/tests/test_usaspending.py`

- [ ] **Step 1: Create empty `backend/app/sources/__init__.py`**

- [ ] **Step 2: Write the failing test `backend/tests/test_usaspending.py`**

```python
from app.sources import usaspending

# A trimmed sample of the real /api/v2/search/spending_by_award/ response.
SAMPLE = {
    "results": [
        {
            "internal_id": 111,
            "Award ID": "FA8675-26-C-0001",
            "Recipient Name": "Acme Defense Inc",
            "Award Amount": 2000000000.0,
            "Awarding Agency": "Department of Defense",
            "Start Date": "2026-06-01",
            "generated_internal_id": "CONT_AWD_FA8675",
        },
        {
            "internal_id": 222,
            "Award ID": "NNX-26-D-0042",
            "Recipient Name": "Orbital Systems LLC",
            "Award Amount": 350000000.0,
            "Awarding Agency": "NASA",
            "Start Date": None,
            "generated_internal_id": "CONT_AWD_NNX",
        },
    ],
    "page_metadata": {"page": 1, "hasNext": False},
}


def test_parse_returns_normalized_records():
    records = usaspending.parse_response(SAMPLE)
    assert len(records) == 2
    first = records[0]
    assert first.external_id == "CONT_AWD_FA8675"
    assert first.award_id == "FA8675-26-C-0001"
    assert first.recipient_name == "Acme Defense Inc"
    assert first.amount == 2000000000.0
    assert first.awarding_agency == "Department of Defense"
    assert first.start_date == "2026-06-01"
    assert first.source == "usaspending"


def test_parse_handles_missing_start_date():
    records = usaspending.parse_response(SAMPLE)
    assert records[1].start_date == ""  # None becomes empty string


def test_parse_empty_results():
    assert usaspending.parse_response({"results": []}) == []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usaspending.py -v`
Expected: FAIL with `AttributeError: module 'app.sources.usaspending' has no attribute 'parse_response'`.

- [ ] **Step 4: Implement `backend/app/sources/usaspending.py`**

```python
"""USASpending.gov federal contracts source.

`parse_response` is pure (no network) so it can be tested directly.
`fetch` is a thin HTTP wrapper around it.
"""
import httpx

from app.models import ContractRecord

API_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
# Contract award type codes: A, B, C, D (definitive/PO/DO/BPA call).
CONTRACT_TYPE_CODES = ["A", "B", "C", "D"]
FIELDS = [
    "Award ID",
    "Recipient Name",
    "Award Amount",
    "Awarding Agency",
    "Start Date",
]


def parse_response(payload: dict) -> list[ContractRecord]:
    records = []
    for row in payload.get("results", []):
        records.append(
            ContractRecord(
                external_id=str(row.get("generated_internal_id") or row.get("internal_id")),
                award_id=row.get("Award ID") or "",
                recipient_name=row.get("Recipient Name") or "",
                amount=float(row.get("Award Amount") or 0.0),
                awarding_agency=row.get("Awarding Agency") or "",
                start_date=row.get("Start Date") or "",
                source="usaspending",
            )
        )
    return records


def fetch(start_date: str, end_date: str, limit: int) -> list[ContractRecord]:
    """Call the live API and return normalized records. Raises on HTTP error."""
    body = {
        "filters": {
            "award_type_codes": CONTRACT_TYPE_CODES,
            "time_period": [{"start_date": start_date, "end_date": end_date}],
        },
        "fields": FIELDS,
        "sort": "Award Amount",
        "order": "desc",
        "limit": limit,
        "page": 1,
    }
    resp = httpx.post(API_URL, json=body, timeout=60.0)
    resp.raise_for_status()
    return parse_response(resp.json())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usaspending.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/sources/__init__.py backend/app/sources/usaspending.py backend/tests/test_usaspending.py
git commit -m "feat: add USASpending source parser and fetch"
```

---

## Task 6: Ingest orchestrator

**Files:**
- Create: `backend/app/ingest.py`
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Write the failing test `backend/tests/test_ingest.py`**

```python
from app import db, ingest
from app.models import ContractRecord


def _records():
    return [
        ContractRecord(
            external_id="A", award_id="AWD-A", recipient_name="Acme",
            amount=10.0, awarding_agency="DoD", start_date="2026-06-01",
        )
    ]


def test_run_source_stores_records_and_stamps_status(conn):
    def fake_fetch():
        return _records()

    ingest.run_source(conn, "usaspending", fake_fetch)

    assert len(db.get_contracts(conn)) == 1
    statuses = db.get_source_statuses(conn)
    assert statuses[0].source == "usaspending"
    assert statuses[0].status == "ok"
    assert statuses[0].record_count == 1
    assert statuses[0].last_refreshed_at is not None


def test_run_source_records_error_status(conn):
    def boom():
        raise RuntimeError("network down")

    ingest.run_source(conn, "usaspending", boom)

    statuses = db.get_source_statuses(conn)
    assert statuses[0].status.startswith("error:")
    assert statuses[0].record_count == 0
    # Failure still stamps a timestamp so the UI shows it tried.
    assert statuses[0].last_refreshed_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_ingest.py -v`
Expected: FAIL with `AttributeError: module 'app.ingest' has no attribute 'run_source'`.

- [ ] **Step 3: Implement `backend/app/ingest.py`**

```python
"""Ingestion orchestration: run a source's fetch, store results, stamp status."""
import sqlite3
from datetime import datetime, timezone
from typing import Callable

from app import db
from app.models import ContractRecord


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run_source(
    conn: sqlite3.Connection,
    source_name: str,
    fetch: Callable[[], list[ContractRecord]],
) -> None:
    """Run one source. Never raises: failures are recorded as status."""
    try:
        records = fetch()
        db.upsert_contracts(conn, records)
        db.update_source_status(conn, source_name, _now_iso(), "ok", len(records))
    except Exception as exc:  # noqa: BLE001 - we want to capture any failure
        db.update_source_status(conn, source_name, _now_iso(), f"error: {exc}", 0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_ingest.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat: add ingest orchestrator with status stamping"
```

---

## Task 7: FastAPI app + endpoints

**Files:**
- Create: `backend/app/main.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write the failing test `backend/tests/test_api.py`**

```python
import pytest
from fastapi.testclient import TestClient

from app import db
from app.models import ContractRecord


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Point the app at a temp DB and a stub fetch before importing the app.
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "api.db"))
    import importlib
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)

    # Replace the real contracts fetch with a stub (no network in tests).
    def stub_fetch():
        return [
            ContractRecord(
                external_id="A", award_id="AWD-A", recipient_name="Acme",
                amount=10.0, awarding_agency="DoD", start_date="2026-06-01",
            )
        ]
    main_module.contracts_fetch = stub_fetch

    with TestClient(main_module.app) as c:
        yield c


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_contracts_empty_then_populated_after_refresh(client):
    assert client.get("/api/contracts").json() == []
    refreshed = client.post("/api/refresh/usaspending").json()
    assert refreshed["status"] == "ok"
    contracts = client.get("/api/contracts").json()
    assert len(contracts) == 1
    assert contracts[0]["recipient_name"] == "Acme"


def test_sources_reports_freshness(client):
    client.post("/api/refresh/usaspending")
    sources = client.get("/api/sources").json()
    assert sources[0]["source"] == "usaspending"
    assert sources[0]["last_refreshed_at"] is not None


def test_refresh_unknown_source_returns_404(client):
    assert client.post("/api/refresh/bogus").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError` / `ImportError` for `app.main`.

- [ ] **Step 3: Implement `backend/app/main.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_api.py -v`
Expected: 4 passed.

- [ ] **Step 5: Run the full backend suite**

Run: `.venv/Scripts/python.exe -m pytest -v`
Expected: all tests pass (test_db 3, test_usaspending 3, test_ingest 2, test_api 4).

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/tests/test_api.py
git commit -m "feat: add FastAPI endpoints and scheduler wiring"
```

---

## Task 8: Manual backend smoke test (live API)

**Files:** none (verification only)

- [ ] **Step 1: Start the server**

Run (from `backend/`): `.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`
Expected: "Uvicorn running on http://127.0.0.1:8000".

- [ ] **Step 2: Trigger a real refresh and inspect**

In a second terminal:
```bash
curl -s -X POST http://localhost:8000/api/refresh/usaspending
curl -s http://localhost:8000/api/contracts | head -c 500
curl -s http://localhost:8000/api/sources
```
Expected: refresh returns `{"source":"usaspending","status":"ok",...}`; contracts returns a non-empty JSON array of real federal contracts; sources shows a recent `last_refreshed_at`.

- [ ] **Step 3: Stop the server** (Ctrl+C). No commit (verification only).

---

## Task 9: Frontend scaffold

**Files:**
- Create: `frontend/` via Vite

- [ ] **Step 1: Scaffold the React app**

Run (from project root `stocks/`):
```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
```
Expected: `frontend/` created with a working Vite React app.

- [ ] **Step 2: Add a `.gitignore` entry**

Vite's template already includes `node_modules` in `frontend/.gitignore`. Verify it exists; if not, create `frontend/.gitignore` containing `node_modules` and `dist`.

- [ ] **Step 3: Commit**

```bash
git add frontend
git commit -m "chore: scaffold Vite React frontend"
```

---

## Task 10: Frontend API client + dashboard

**Files:**
- Create: `frontend/src/api.js`
- Modify: `frontend/src/App.jsx` (replace template content)
- Modify: `frontend/src/App.css` (replace template content)

- [ ] **Step 1: Create `frontend/src/api.js`**

```javascript
const BASE = "http://localhost:8000";

export async function getContracts() {
  const res = await fetch(`${BASE}/api/contracts`);
  if (!res.ok) throw new Error("failed to load contracts");
  return res.json();
}

export async function getSources() {
  const res = await fetch(`${BASE}/api/sources`);
  if (!res.ok) throw new Error("failed to load sources");
  return res.json();
}

export async function refreshSource(name) {
  const res = await fetch(`${BASE}/api/refresh/${name}`, { method: "POST" });
  if (!res.ok) throw new Error("refresh failed");
  return res.json();
}
```

- [ ] **Step 2: Replace `frontend/src/App.jsx`**

```jsx
import { useEffect, useState, useCallback } from "react";
import { getContracts, getSources, refreshSource } from "./api";
import "./App.css";

const REFRESH_MS = 180000; // 3 minutes, matches backend default

function formatAmount(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatWhen(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

export default function App() {
  const [contracts, setContracts] = useState([]);
  const [sources, setSources] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([getContracts(), getSources()]);
      setContracts(c);
      setSources(s);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function handleRefresh() {
    setBusy(true);
    try {
      await refreshSource("usaspending");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Stock Signal Dashboard</h1>
        <button onClick={handleRefresh} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="sources">
        <h2>Data sources</h2>
        <ul>
          {sources.length === 0 && <li>No data yet — click “Refresh now”.</li>}
          {sources.map((s) => (
            <li key={s.source}>
              <strong>{s.source}</strong> — {s.status} · {s.record_count} records ·
              last refreshed {formatWhen(s.last_refreshed_at)}
            </li>
          ))}
        </ul>
      </section>

      <section className="contracts">
        <h2>Biggest recent federal contracts</h2>
        <table>
          <thead>
            <tr>
              <th>Recipient</th><th>Agency</th><th>Amount</th><th>Start</th><th>Award ID</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.external_id}>
                <td>{c.recipient_name}</td>
                <td>{c.awarding_agency}</td>
                <td className="amount">{formatAmount(c.amount)}</td>
                <td>{c.start_date || "—"}</td>
                <td>{c.award_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Replace `frontend/src/App.css`**

```css
:root { color-scheme: light dark; }
.app { max-width: 1000px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; }
header { display: flex; justify-content: space-between; align-items: center; }
button { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
button:disabled { opacity: 0.6; cursor: default; }
.error { color: #c00; }
.sources ul { list-style: none; padding: 0; }
.sources li { padding: 0.25rem 0; }
table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #8884; }
.amount { text-align: right; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js frontend/src/App.jsx frontend/src/App.css
git commit -m "feat: dashboard showing contracts and per-source freshness"
```

---

## Task 11: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the backend**

Run (from `backend/`): `.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`

- [ ] **Step 2: Start the frontend** (second terminal, from `frontend/`): `npm run dev`
Expected: Vite serves on http://localhost:5173.

- [ ] **Step 3: Open the dashboard**

Open http://localhost:5173 in a browser. Click "Refresh now".
Expected: the data-sources list shows `usaspending — ok` with a fresh "last refreshed" time, and the contracts table fills with real federal contracts sorted by amount.

- [ ] **Step 4: Confirm auto-refresh freshness display**

Leave the page open; confirm "last refreshed" timestamps render and the table is populated. Stop both servers when done.

---

## Self-Review Notes

- **Spec coverage (this slice):** FastAPI+SQLite backend ✅ (Tasks 4,7); React+Vite frontend ✅ (Tasks 9,10); USASpending ingestion as the first end-to-end source ✅ (Tasks 5,6); per-source "last refreshed" plumbing ✅ (`source_status` table + `/api/sources` + UI); scheduler with configurable interval ✅ (Task 7, `config.py`). Other data sources (EDGAR, trades, Truth Social, GDELT), signals, per-stock report, and the background full-market scan are intentionally **out of this slice** — they are separate plans per the design's build order.
- **Type consistency:** `ContractRecord` / `SourceStatus` field names are identical across `models.py`, `db.py`, `usaspending.py`, `ingest.py`, `main.py`, and tests. `run_source(conn, name, fetch)` signature matches in `ingest.py` and `test_ingest.py`. `contracts_fetch` is the single monkeypatch point named identically in `main.py` and `test_api.py`.
- **No placeholders:** every code step contains complete, runnable code; every run step states the exact command and expected result.
