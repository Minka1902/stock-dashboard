# WebSocket for live prices — recommendation

**Date:** 2026-07-10 · **Status:** recommendation only (no implementation)

## Recommendation: not now — keep polling.

The current polling model (quotes every 10–30 s via `useLiveQuotes`, the full
dashboard every 3 min) is the right fit for this product today. Adding a
WebSocket layer would introduce cost and complexity without a matching benefit.

### Why

1. **The backend is a single uvicorn worker with an in-process scheduler and
   TTL caches** (see `docs/scaling-roadmap.md`). All shared state — the
   APScheduler jobs, the quote/chart TTL caches, the rate limiter, the one
   shared SQLite connection — lives inside that one process. A WebSocket layer
   adds long-lived connection state to exactly the component that must stay
   simple, and it is the component the scaling roadmap says to split *first*.

2. **There is no upstream push feed to relay.** Quotes come from Yahoo's HTTP
   API, polled behind a TTL cache (`app/quotes.py`). A WebSocket to the browser
   would still be fed by that same poll at the same cadence — it would just
   re-broadcast a poll over a fancier transport. The freshness ceiling is set by
   the upstream poll interval, not by the browser transport.

3. **The cadence already matches the product.** This is a signals dashboard, not
   a day-trading terminal. "Something is happening here," surfaced within tens of
   seconds, is the design goal (see the signal-oriented product principle in
   `docs/superpowers/specs/2026-06-22-stock-signal-dashboard-design.md`).
   Sub-second tick streaming would be precision the product does not use.

### If/when live push is actually wanted

Prefer **Server-Sent Events (SSE, `text/event-stream`) first**, not WebSockets:

- SSE rides the **existing cookie-auth ASGI middleware** and the plain HTTP
  stack — no new auth path, no new handshake to secure.
- The use case is **one-directional** (server → browser price diffs); SSE fits
  it exactly, and browsers auto-reconnect for free.
- A **single broadcaster task** can fan out quote diffs from the *existing*
  poller to all connected clients, so the poll stays the single source of truth
  and the cache/scheduler design is untouched.

Only upgrade to **WebSockets** if genuinely bidirectional needs appear (e.g.
client-driven subscriptions that must mutate server state per-connection), and
only **after** the multi-worker / shared-state items in `docs/scaling-roadmap.md`
are done — because both SSE and WebSockets require a shared pub/sub layer
(e.g. Redis) once there is more than one worker fanning out to clients.

### Cost of doing it now (for reference)

- Connection lifecycle + backpressure handling in the single worker.
- A broadcaster coupled to the scheduler tick.
- Reconnect/auth-expiry handling on the client, replacing the currently trivial
  `useLiveQuotes` polling hook.
- A migration path anyway once the app goes multi-worker.

Net: the polling approach is cheaper, already shipped, and good enough until the
scaling roadmap's multi-worker work lands.
