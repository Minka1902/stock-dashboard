# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **multi-user Stock Signal Dashboard** that aggregates *public* signals
(federal contracts, SEC Form 4 insider trades, congressional trades, news, technicals,
short interest, social sentiment, analyst ratings, fundamentals, seasonality) and surfaces
explainable "something is happening here" indicators per ticker. Accounts require
**mandatory TOTP 2FA** (Google/Microsoft Authenticator); each user has their own
watchlist, portfolio and notification profile, while market data is shared.

**Core product principle — signals, not predictions.** Every signal must show its source and
reasoning; never a black-box score and never fabricated/placeholder data. If a data source is
unavailable, the source records an error status (visible in the UI) rather than inventing values.
See `docs/superpowers/specs/2026-06-22-stock-signal-dashboard-design.md`.

## Layout & commands

Two independent apps, no root package manager. Run each from its own directory.

### Backend (`backend/`) — FastAPI + SQLite + APScheduler, Python 3.11+
```bash
cd backend
python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt  # first time (Windows)
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000   # run API + scheduler
.venv/Scripts/python.exe -m pytest                                       # all tests
.venv/Scripts/python.exe -m pytest tests/test_boom_score.py             # one file
.venv/Scripts/python.exe -m pytest tests/test_boom_score.py::test_name  # one test
```
Imports are package-relative (`from app import db`), so **always run from `backend/`** with the
`app.main:app` module path. Tests use a `conn` fixture (`tests/conftest.py`) giving a fresh
temp-file SQLite DB per test.

### Frontend (`frontend/`) — React 19 + Vite, plain CSS Modules
```bash
cd frontend
npm install
npm run dev      # Vite dev server on :5173
npm run build
npm run lint     # eslint
```
**Two run modes:**
- **Single port (prod-like):** `cd frontend && npm run build`, then run uvicorn — the backend
  serves the built `frontend/dist/` on `:8000` (SPA catch-all in `app/main.py::_mount_spa`, only
  active when a build exists). Open `http://localhost:8000`. Override the dist path with
  `STOCKS_STATIC_DIR`.
- **Dev (hot reload):** run both — Vite on `:5173` proxies `/api` → `:8000` (see
  `vite.config.js`), so `src/api.js` uses a same-origin relative base (`VITE_API_BASE` defaults to
  `""`; set it only for a cross-origin backend). The backend CORS allowlist defaults to
  `http://localhost:5173` (override with `STOCKS_CORS_ORIGINS`; wildcard rejected because requests
  carry the session cookie).

**Run exactly one uvicorn worker.** The scheduler, TTL caches, rate limiter and the shared
SQLite connection are all in-process — see `docs/scaling-roadmap.md` before scaling out.

## Auth & multi-tenancy

- **`app/auth.py` + `app/routes_auth.py`** — Argon2id passwords; opaque session tokens
  (SHA-256-hashed in the `sessions` table) delivered as httpOnly SameSite=Lax cookies; 2FA is
  mandatory: register → `totp_setup` session → QR enrollment (pyotp + segno SVG) → `active`;
  login → `pending_totp` → 6-digit verify → `active`. Tokens rotate on every state upgrade.
  Single-use recovery codes are stored hashed.
- An ASGI middleware in `app/main.py` resolves the cookie once per request into
  `request.state.user` and 401s everything under `/api` except `/api/health` and `/api/auth/*`.
  Routes needing the user take `Depends(auth.get_current_user)`.
- **Per-user tables**: `watchlist`, `portfolio` (PK `(user_id, ticker)`), `notify_profile`
  (PK `user_id`), `alert_reads`. **Shared**: all market-data tables, `stock_analysis` (stored
  *unsized*; `analysis.apply_sizing` personalizes at read time), `app_settings` (PUT is
  admin-only). The first registered account becomes admin and claims legacy `user_id=0` rows
  (`db.claim_legacy_rows`); old single-user DBs are rebuilt in place by `init_schema`.
- Tests authenticate a `TestClient` with `tests/conftest.py::authenticate` (registers +
  enrolls TOTP via pyotp).
- Rate limiting (`app/security.py`) is a fixed-window in-memory limiter; ticker inputs are
  whitelisted by `app/validation.py::clean_ticker` before reaching outbound URLs.

## On-demand analysis & search (any ticker)

- `GET /api/search?q=` — Yahoo keyless search (`app/search.py`, TTL-cached), surfaced in the
  frontend Cmd/Ctrl+K palette.
- `GET /api/analyze/{ticker}` — `app/analyze.py`: stored fast-path for holdings, otherwise a
  live 2y-bars build (TTL-cached, **never persisted** — `stock_analysis` stays portfolio-only).
  Also powers the HTML report fallback for never-watched tickers and serves the seasonality
  anchors ("this day 1/2/5/max years ago", `seasonality.compute_anchors`, stored in
  `anchors_json`).

## Backend architecture

The whole pipeline hangs off the **`SOURCES` registry** in `app/main.py`:
`name -> (fetch_callable, store_fn, min_interval_seconds | None)`.

- **`app/sources/<name>.py`** — one isolated module per source exposing `fetch(...) -> list[Model]`.
  Network-free parsing helpers are kept pure and unit-tested directly; `fetch` does the throttled
  HTTP. Sources never write to the DB themselves.
- **`app/ingest.run_source`** — the only orchestrator. Calls `fetch()`, passes results to the
  `store_fn`, and stamps source status. **It never raises**: any exception is captured as the
  source's `error: ...` status. `min_interval_seconds` lets slow/rate-limited sources (congress,
  seasonality) skip a refresh cycle.
- **`app/db.py`** — the *single* place any SQLite access lives. `init_schema` is idempotent
  (`CREATE TABLE IF NOT EXISTS` + `_try_add_column` for additive migrations). One shared connection
  (`check_same_thread=False`, `Row` factory) is created at import time in `main.py`.
- **`app/models.py`** — Pydantic models that are the common schema between sources, DB, and API.
- **`app/main.py`** — FastAPI routes (mostly thin `db.get_* -> model_dump()` reads) plus the
  APScheduler wiring in `lifespan`: an interval job (`_refresh_all`, default 180s) and a pre-market
  cron job (`_send_daily_digest`).

**Ordering matters in `SOURCES` (dict insertion order is load order):**
- `boom_score` is a *pure DB computation* (no network) and must run **after** every source it reads.
- `alerts` must run **last** — it diffs the freshly computed boom scores against the prior
  `alert_state` snapshot to fire transition events exactly once (deduped by `dedup_key`).

**Boom Score** (`app/sources/boom_score.py`) combines all signals into a weighted `-90…+100`
composite per watchlist ticker. `WEIGHTS` defines each component's contribution; congress weight is
scaled by trade amount and time-decayed. Component booleans are persisted so the UI can explain the
score, and each run also appends to boom-score history.

### Adding a new data source
1. `app/sources/<name>.py` with `fetch(...) -> list[<Model>]` (pure parse helpers kept separate).
2. Add the Pydantic model to `app/models.py`.
3. In `app/db.py`: add the table to `init_schema`, plus `upsert_<name>` / `get_<name>` (and any
   `get_<name>_for(ticker)` helpers Boom Score needs).
4. Register in the `SOURCES` dict in `app/main.py` (before `boom_score`/`alerts`) and add a
   `GET /api/<name>` route.
5. Add a `pytest` test (parsing logic without network; storage via the `conn` fixture).
6. Frontend: add the fetch in `src/api.js`, wire it into `src/hooks/useDashboardData.js` (state +
   `Promise.all` load), add the source name to `EXTERNAL_SOURCES` there, and add a panel/view.

## Frontend architecture

- **`src/hooks/useDashboardData.js`** owns *all* dashboard state: loads every endpoint in parallel
  on mount, auto-polls every 3 min, and exposes `refresh()` which POSTs `/api/refresh/<source>` for
  each `EXTERNAL_SOURCES` entry (via `Promise.allSettled`, so partial failures are fine) then reloads.
- **`src/App.jsx`** is a single-page view switcher (`view` state + `TITLES` map). Each section is a
  `*Panel` component in `src/components/`, paired with a co-located `.module.css`.
- Styling is **CSS Modules + design tokens** defined in `src/index.css` (`:root` custom properties
  for spacing/radius/typography; the "Iris Dusk" dark theme). No CSS framework. Accessibility is a
  first-class concern: an always-on ADHD-friendly type scale and an opt-in dyslexia mode
  (self-hosted Atkinson Hyperlegible font, toggled via `useSettings`).

## Configuration

All backend config is env-var driven with `STOCKS_` prefixes and sane defaults in `app/config.py`
(DB path, refresh interval, per-source lookbacks/limits, news query, SEC user-agent). **Secrets stay
in env, never in code/DB** — SMTP (email digest), Twilio (SMS), and the optional Alpha Vantage key.
Notification channels safely no-op and log when their env vars are unset, so the app runs fully
without any of them.
