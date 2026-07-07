# Scaling roadmap

Where the app stands after the production-prep work, and the order in which to
grow it when real traffic arrives. The guiding rule: don't pay for scale you
don't have yet.

## Current envelope (what ships today)

- **One uvicorn worker, and that's load-bearing.** Four things live in process
  memory and assume a single process: the APScheduler jobs, the TTL caches
  (quotes, chart bars, on-demand analyses, search results, seasonality
  anchors), the rate limiter's counters, and the shared SQLite connection.
  Running `uvicorn --workers 2` (or any replica count > 1) would double-run
  the scheduler and split the rate limits. **Do not add workers before step 1
  below.**
- **SQLite in WAL mode** with `busy_timeout` and a process-wide lock
  serializing access to the one shared connection. Reads are plentiful and
  cheap; writes come almost entirely from the scheduler, not users.
- **Auth is stateless per request**: opaque session tokens hashed in the
  `sessions` table — no signing keys, nothing in memory, already
  multi-process-safe.
- Realistic capacity: this comfortably serves a small team of users
  (tens of concurrent sessions). The first thing that degrades under load is
  request latency while a scheduler write holds the DB lock.

## Step 1 — split the scheduler out of the web process

When: you want more than one web worker, or refreshes visibly stall requests.

- Add a `STOCKS_ROLE` env var (`web` | `worker` | `all`, default `all`).
  In `main.py`'s lifespan, only start APScheduler when the role includes
  `worker`. Run one worker process and N web processes against the same DB.
- Give each process its own SQLite connection (WAL already permits concurrent
  readers + one writer); keep the write lock inside the worker.

## Step 2 — move shared state to Redis

When: more than one web process exists (step 1) and you need correct
rate limits / warm caches across them.

- Rate-limit counters → Redis `INCR` with TTL (same fixed-window semantics).
- TTL caches (quotes, chart bars, analyze, search) → Redis with the same keys
  and TTLs; the module interfaces already isolate cache get/set.
- Sessions can stay in SQLite (they're already shared via the DB).

## Step 3 — PostgreSQL

When: concurrent *writers* actually contend — e.g. many users mutating
watchlists/portfolios at once — or the DB file outgrows one machine.

- `app/db.py` is the single choke point for SQL; the queries are already
  parameterized and portable except for a few `INSERT ... ON CONFLICT`
  clauses (compatible) and `PRAGMA` calls (drop under Postgres).
- Migrate with a one-shot copy script; keep SQLite for tests (the `conn`
  fixture stays fast and hermetic).

## Step 4 — observability

- Request logging middleware (method, path, status, duration) on top of the
  existing `logging_config`; ship stderr to journald or a collector.
- `/api/health` already exists for liveness; add a readiness probe that
  checks a trivial DB read once a load balancer is in front.

## Non-goals for now

- Horizontal auto-scaling, message queues, microservices: the workload is a
  handful of upstream fetches every few minutes plus light reads. A single
  box runs this for a long time.
- CDN for the frontend: `npm run build` output is static and can go on any
  static host when needed.
