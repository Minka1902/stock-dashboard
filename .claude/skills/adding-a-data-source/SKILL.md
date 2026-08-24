---
name: adding-a-data-source
description: Step-by-step checklist for adding a new market-data source to the dashboard — the source module, Pydantic model, DB table and upsert/get helpers, SOURCES registry entry and API route, tests, and the frontend wiring. Use when adding, replacing, or removing a data source (contracts, news, insider trades, congress, technicals, sentiment, earnings, etc.).
---

# Adding a new data source

The whole pipeline hangs off the `SOURCES` registry in `app/main.py`:
`name -> (fetch_callable, store_fn, min_interval_seconds | None)`.

1. `app/sources/<name>.py` with `fetch(...) -> list[<Model>]` (pure parse helpers kept
   separate from the throttled HTTP, so they can be unit-tested without network).
2. Add the Pydantic model to `app/models.py`.
3. In `app/db.py`: add the table to `init_schema`, plus `upsert_<name>` / `get_<name>`
   (and any `get_<name>_for(ticker)` helpers Boom Score needs).
4. Register in the `SOURCES` dict in `app/main.py` (before `boom_score`/`alerts`) and add
   a `GET /api/<name>` route.
5. Add a `pytest` test (parsing logic without network; storage via the `conn` fixture).
6. Frontend: add the fetch in `src/api.js`, wire it into `src/hooks/useDashboardData.js`
   (state + `Promise.all` load), add the source name to `EXTERNAL_SOURCES` there, and add
   a panel/view.

## Ordering matters

`SOURCES` is a dict and insertion order is load order:

- `boom_score` is a *pure DB computation* (no network) and must run **after** every source
  it reads.
- `alerts` must run **last** — it diffs the freshly computed boom scores against the prior
  `alert_state` snapshot to fire transition events exactly once (deduped by `dedup_key`).

## Non-negotiables

- Sources never write to the DB themselves — `ingest.run_source` is the only orchestrator,
  and it never raises: any exception becomes that source's `error: ...` status.
- Never fabricate or placeholder a value. If the upstream is unavailable, let the source
  record an error status so the UI can show it. That is the core product principle and it
  applies to every new source without exception.
- Use `min_interval_seconds` for slow or rate-limited upstreams rather than letting them
  run every refresh cycle.
