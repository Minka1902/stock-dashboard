# Plan: Methodology-Complete Technical Analysis Engine, Background Buy/Sell/Hold + Alerts, TA-Driven Suggestions, Single-Port App, Hourly X-Watch

## Context

The user received a Hebrew document describing a friend's complete technical-analysis
methodology. The dashboard's analyze function must follow it **to the dot**: every concept in the
document becomes an explicit, explainable component of the analysis (project principle: signals
with source + reasoning, never black-box scores, never fabricated data).

On top of the engine rework, four product changes:
1. The analysis runs **in the background over all portfolio + watchlist tickers** (today it covers
   portfolio only) and produces a **Buy / Sell / Hold** recommendation per ticker, pushing alerts
   on actionable transitions — the doc's stated goal is to *warn before falls and before breakouts*.
2. The **Suggestions page** uses this engine to surface new opportunities.
3. The app runs on **one port** — FastAPI serves the built frontend `dist/`.
4. The X/Twitter watcher (`x_posts` source — there is no literal "xwatch" in the repo) fetches
   **every 1 hour** (currently every 15 min).
Plus hardening/tests so the analyze function is demonstrably correct.

### User decisions (confirmed)
- **Opportunities universe**: watchlist + tickers already flowing through the other signal sources
  (congress trades, insider buys, analyst upgrades, social spikes, contracts). No full-index scan.
- **Labels**: new explicit `recommendation` field — Buy / Hold / Sell — shown everywhere; the
  finer-grained `directive` (Accumulate/Hold/Reduce/Avoid) stays as secondary detail.
- **Alert delivery**: all TA alerts in the in-app bell; high-severity also push via the existing
  email/SMS channels.
- **Single port**: backend serves `dist/` on :8000; the optional Vite dev server (:5173, hot
  reload) stays available via a dev proxy.

---

## The methodology → component spec (the "to the dot" contract)

Every row must exist as an explicit component with its own evidence in the output. Items marked
**NEW** don't exist in the codebase today (grep-verified); others exist and are kept/extended.

| # | Methodology item (from the document) | Engine component | Status |
|---|---|---|---|
| A1 | Horizontal support/resistance from repeated stalls; strength = touch count (+ volume at level) | `support_resistance` pivot clustering (exists, analysis.py:81) | keep |
| A2 | Trendlines from swing lows/highs; valid at 2 touches; confidence grows per touch | `trendline_levels()` | **NEW** |
| A3 | Channels: parallel trendline pair = dynamic S/R rails | `detect_channel` (exists) + trendline pair evidence | extend |
| A4 | Gaps: ~90% eventually fill (timing unknowable); gap edges act as S/R; reversal gap; runaway gaps that never fill | `gaps()` exists; `classify_gaps()` roles + gap-as-S/R | extend |
| A5 | Round numbers as S/R; strong moves once broken | `round_number_levels()` | **NEW** |
| A6 | SMAs 20/50/150/200: magnet + dynamic S/R; distance-from-MA = mean-reversion odds; 150/200 most reliable long-term | `moving_averages` (exists) + `ma_extension_atr` | extend |
| A7 | Healthy uptrend = all four MAs stacked in order, evenly spread (long-horizon focus names) | `ma_structure()` → `healthy_uptrend` | **NEW** |
| A8 | Topping formation = MAs converge after a run, price slips below them one by one → exit/trim | `ma_structure()` → `topping` | **NEW** |
| A9 | Reclaim progression = price recrosses 20 → 50 → (toward 150) → staged entry/add | `ma_structure()` → `reclaiming` | **NEW** |
| B1 | False breakouts (stop-hunts): break + snap back inside with long wick / opposing volume = trap; must prepare for it | `detect_breakout()` → `failed` state | **NEW** |
| B2 | Breakout needs a confirmation candle before trusting it | `detect_breakout()` → `broke_unconfirmed` vs `confirmed` | **NEW** |
| B3 | Staged entry: start ~20% size, stop slightly below breakout per ATR, add after confirmation candle | `staging_guidance()` → `staging_note` | **NEW** |
| B4 | ATR = average daily movement; volatility gate; stop ~1 ATR below structure so stop-hunts can't tag it (10%-ATR stock → stop ~10% below) | `atr()` exists; **stop buffer 0.25→1.0 ATR** | fix |
| B5 | Structure stops below proven support (more stalls = more trust) or below trendlines (with ATR buffer, trailing) | `compute_stop` (exists) + trendline stop basis | extend |
| B6 | R/R = (target−entry)/(entry−stop); professional threshold ≥3:1; sub-threshold trades are known skips **in advance** | base `rr` exists; **`rr_pass` gate demotes Buy→Hold** | **NEW** |
| C1 | Cup & Handle (bullish, most important; measured move = cup depth) | `detect_cup_handle` (exists, analysis.py:305) | keep |
| C2 | Head & Shoulders (bearish after strong runs; move = head height) | `detect_head_shoulders` (exists) | keep |
| C3 | Ascending/descending triangles; confirmation required after the break | `detect_triangle` (exists) + confirmation via B2 | extend |
| C4/C5 | Double top / double bottom | `detect_double_top/bottom` (exist) | keep |
| D | Candles: hammer, doji, bullish/bearish harami (~half-body inside prior, often gap open), shooting star | `detect_candles()` | **NEW** |
| E | Volume confirms everything: moves without volume are meaningless; consecutive directional volume days = strong move; slowing volume = move exhausting | `volume_read()` + volume checks inside breakout/pattern evidence | **NEW** |
| F | Confluence: combinations of indicators validate strength; warn before falls and breakouts; output buy/sell/hold + trade plan + evidence | evidence-pipeline `build()` + `recommendation` + TA alerts | rework |

---

## Current state (validated in code)

- **Engine** `backend/app/analysis.py` — pure (no DB/network). `build()` at :478-590 already
  computes ATR14, SMAs 20/50/150/200 + `ma_alignment` + `trend`, pivot-clustered S/R with touch
  counts, gaps with fill detection, patterns (double top/bottom :218/:243, H&S+inverse :268,
  cup & handle :305, triangles :352, channels :374, flags :397), conviction → `directive`,
  `compute_stop` (tighter of 2×ATR vs structure−0.25·ATR, :439), `target_ladder` 3-6R (:453),
  base `rr`. `apply_sizing` (:593) personalizes `suggested_shares` per user at read time.
  **`build` never reads `OHLCBar.volume`** — volume is entirely unused in Layer A.
- **Pipeline** `backend/app/main.py`: `SOURCES` registry :160-191 (order load-bearing; `alerts`
  last). `ohlc_fetch` :122 and `analysis_fetch` :129 iterate **portfolio only**; `ohlc`
  min-interval is a hardcoded `3600` (:188), `analysis` runs every 180s cycle. Scheduler :255-283:
  `_refresh_all` every `STOCKS_REFRESH_SECONDS` (180); daily digest cron 07:30 NY; daily deep run
  (force-refresh all) at `AppSettings.analysis_time` (15:30 Asia/Jerusalem default).
- **On-demand** `backend/app/analyze.py`: `GET /api/analyze/{ticker}` — stored fast-path, else
  live 2y-daily/10y-weekly build via `chart_data.get_bars`, 10-min TTL, never persisted,
  `_MIN_BARS=30` (skip rather than fabricate).
- **Alerts** `backend/app/alerts.py::detect` — watchlist tickers, diffs **Boom scores** vs
  `alert_state` snapshot; types boom_cross/golden_cross/insider_cluster/earnings_soon/congress_buy;
  `dedup_key` + `ON CONFLICT DO NOTHING`; high severity pushes via `notify.push_alert`
  (email SMTP + SMS Twilio); read state per-user (`alert_reads`).
- **Suggestions** `backend/app/suggestions.py::build_digest` :107-236 — `opportunities` =
  watchlist-not-held ranked by **Boom score** (:189-201); holdings action strings from Boom flags.
  The TA `directive` feeds none of it.
- **xwatch** = `x_posts` source: `config.py:197` `X_MIN_INTERVAL_SECONDS` default **900**;
  wired at main.py:185.
- **Serving**: backend serves no static files; CORS default `http://localhost:5173`; frontend
  `src/api.js:1` `BASE = VITE_API_BASE || "http://localhost:8000"`; no react-router (hash
  deep-link `#/stock/T` only) → a catch-all `index.html` route suffices; `vite.config.js` bare;
  build output `frontend/dist/` (gitignored).
- **Frontend**: `StockDetailPanel.jsx` renders the full analyze payload; `ChartPro.jsx`
  (lightweight-charts) already overlays horizontal S/R, entry/stop/target, pattern pivots, gaps
  ("PLAN" toggle ~:392-422) — no diagonal trendline support yet. `SuggestionsPanel.jsx` renders
  the server payload verbatim. `AlertsBell.jsx` is the live alerts UI (`AlertsPanel.jsx` is dead
  code with a `TYPE_ICON` map). `useDashboardData.js` holds `EXTERNAL_SOURCES` for refresh.
- **Constraint** (`docs/scaling-roadmap.md`): single uvicorn worker is load-bearing; scheduler
  uses its own `refresh_conn`; per-ticker fan-outs must stay bounded.

---

## Implementation plan

Order: P0 → P1 → P2 → P3 → P4 → P5. Tests land per-phase.

### Phase 0 — Config quick wins (`backend/app/config.py`)
- `X_MIN_INTERVAL_SECONDS` default `"900"` → `"3600"` (line 197) + comment update. **(xwatch hourly;
  the 180s cycle still calls it, the min-interval gate spaces real fetches; daily force-run bypasses.)**
- New vars: `OHLC_MIN_INTERVAL_SECONDS` (default 3600), `ANALYSIS_MIN_INTERVAL_SECONDS` (default
  3600), `OHLC_MAX_TICKERS` (default 60, fan-out bound mirroring `NEWS_MAX_TICKERS`),
  `OPPORTUNITY_CANDIDATES` (default 20, cap on signal-source tickers added to the universe),
  `STATIC_DIR` (optional override for the dist path; used by tests).

### Phase 1 — Engine: every methodology item explicit (`backend/app/analysis.py`, `backend/app/models.py`)

**New models (all additive with defaults so old `stock_analysis.payload_json` rows still parse):**
- `Evidence { component, signal: bullish|bearish|neutral, weight: int, detail: str, data: dict }`
  — the per-signal explanation; a component with insufficient data is **omitted**, never invented.
- `CandleSignal { name: hammer|shooting_star|doji|bullish_harami|bearish_harami, label, date, direction, confidence, note }`
- `TrendlineLevel { kind: support|resistance, touches, confidence, slope_per_bar, pivots: [{date,price,role}], current_value, broken }`
  — pivots are exactly what ChartPro needs for a two-point line series.
- `VolumeRead { avg20, last, ratio, streak: signed int, state: expanding|contracting|flat, note }`
  — `None` when bars carry no real volume (explicit absence).
- `BreakoutState { direction, level, level_source: horizontal|trendline|round|gap, status: approaching|broke_unconfirmed|confirmed|failed, volume_confirmed, note }`
  — `approaching` (within 1 ATR of a level) powers "warn **before** falls/breakouts"; `failed` is the stop-hunt trap.
- `SRLevel` + `source: str = "pivot"` (`pivot|round|gap|ma`); `GapEvent` + `role`
  (`breakaway|runaway|exhaustion|common`), `acts_as` (`support|resistance|None`), `note`
  (carries the ~90%-fill heuristic wording).
- `StockAnalysis` new fields: `recommendation` (**buy|sell|hold** — mapped
  Accumulate→buy, Reduce/Avoid→sell, Hold→hold, then the R/R gate can demote buy→hold; do NOT
  rename `directive`, existing tone maps keep working), `evidence[]` (with `reasons` kept, derived
  as `[e.detail]`), `trendlines[]`, `candles[]`, `volume`, `ma_state`
  (`healthy_uptrend|topping|reclaiming|breaking_down|mixed`), `ma_extension_atr`, `breakout`,
  `rr_threshold=3.0`, `rr_pass`, `staging_note`.

**New pure detectors (each returns artifact + `list[Evidence]`; per-detector unit tests):**
- `detect_candles(bars)` — scan last ~5 bars: hammer (lower shadow ≥2× body, small upper shadow,
  after a decline), shooting star (mirror, after an advance), doji (body ≤10% of range),
  bullish/bearish harami (small body inside prior large opposite body reaching ~half of it,
  confidence bonus on gap open).
- `trendline_levels(pivots, bars)` — fit lines through swing-low pairs (support) / swing-high
  pairs (resistance); count touches within tolerance; valid at ≥2 touches;
  `confidence = min(0.9, 0.4 + 0.15·(touches−2))`; `broken` when a recent close crosses the
  projection; support+resistance lines with similar slope → channel evidence (rails as dynamic S/R).
- `round_number_levels(bars, price)` — grid step from price magnitude ($5/$10/$50/$100…); nearest
  2 above/below; touches counted from historical stalls → merged into S/R lists as `source="round"`.
- `classify_gaps(gap_events, bars)` — breakaway (out of a base) / runaway (mid-trend) /
  exhaustion-reversal (after extended move, then reversed); unfilled up-gap below price →
  `acts_as="support"` and its edge joins the support list (`source="gap"`), mirrored for
  down-gaps; note always states that ~90% of gaps fill but timing is unknowable.
- `ma_structure(closes, mas, px, atr_val)` — `healthy_uptrend` (stacked bull + roughly even
  spacing); `topping` (MA spread compressed after a run AND price slipping under 20→50 → exit/trim
  evidence); `reclaiming` (price recrossed 20→50 recently → staged add evidence);
  `ma_extension_atr = (px − ma20)/ATR` with a mean-reversion warning when >~2.5 (MA-magnet rule;
  150/200 called out as the long-term reference in the evidence detail).
- `volume_read(bars)` — 20-bar average, last/avg ratio, signed streak of directional volume days,
  expanding/contracting (last 5 vs prior 10).
- `detect_breakout(bars, support, resistance, trendlines, vol, atr_val)` — nearest level within
  1 ATR → `approaching`; close beyond level → `broke_unconfirmed`; second consecutive close beyond
  → `confirmed` (the confirmation candle); break then close back inside within ~3 bars with long
  opposing wick / opposing volume → `failed`; `volume_confirmed = ratio ≥ ~1.3` on the break bar,
  and a no-volume break is explicitly noted as suspect.
- `staging_guidance(breakout, rr, atr_pct)` — the doc's staged-entry text: "Start ~20% size at the
  break; stop ≈1 ATR (~X%) below the breakout level; add after a confirmation close." Emitted when
  recommendation is buy or a breakout is live.

**Changes to existing code:**
- `compute_stop` (:439): structure-stop buffer **0.25·ATR → 1.0·ATR** (new tunable
  `_STRUCT_STOP_ATR_BUFFER = 1.0`) — the doc's stop-hunt protection. Deliberate behavior change;
  update `test_compute_stop_prefers_tighter_structure`. Add trendline value as an additional
  structure-stop candidate (stop trails up with the line). Keep "tighter of the two" selection.
- `build()` (:478): restructure scoring into an **evidence pipeline** — each detector contributes
  `Evidence`; `conviction = clamp(Σ weight)`; `reasons = [e.detail]`. New weights (existing kept):
  candles ±6 (max one per direction), volume confirm/deny ±8, ma_state topping −15 / healthy +10 /
  reclaiming +8, over-extension −8, breakout confirmed +12 / failed −12 / approaching weight 0
  (informational — it alerts instead), trendline support nearby +6. Merge round/gap levels into
  `support`/`resistance` **before** `compute_stop`/`target_ladder` (widen stored slice `[:5]`→`[:8]`).
  Then: `recommendation` mapping + **R/R gate** (`rr_pass = rr ≥ 3.0`; failing gate demotes buy→hold
  with an Evidence row saying "R/R {rr} < 3:1 — known skip in advance").
- Module docstring becomes the methodology index (component list ↔ doc section).
- No signature change to `build` → on-demand path and scheduled path pick everything up; `apply_sizing` untouched.

### Phase 2 — Background scope: portfolio ∪ watchlist ∪ signal candidates, hourly

- `backend/app/db.py`: new `get_analysis_universe(conn)` = portfolio ∪ watchlist ∪
  `get_signal_candidate_tickers(conn, config.OPPORTUNITY_CANDIDATES)` (new helper: recent DISTINCT
  tickers from congress buys / insider cluster buys / analyst upgrades / social spikes / contracts,
  most-recent first, capped). New `get_ohlc_fetched_at(conn)` for staleness rotation.
- `backend/app/main.py`: `ohlc_fetch` (:122) iterates the universe **stalest-first, capped at
  `OHLC_MAX_TICKERS` per run** (bounds the Yahoo fan-out; big lists rotate across hourly runs).
  `analysis_fetch` (:129) iterates the same universe (cheap: stored bars + one quotes call).
  SOURCES (:188-189): `ohlc` → `config.OHLC_MIN_INTERVAL_SECONDS`, `analysis` →
  `config.ANALYSIS_MIN_INTERVAL_SECONDS`. Registry order unchanged (… ohlc → analysis → alerts last).
- Optional nice-to-have: `db.prune_analyses(conn, keep)` to drop rows for tickers no longer in the universe.

### Phase 3 — TA transition alerts ("warn before falls and breakouts")

- `backend/app/db.py`: `_try_add_column` on `alert_state`: `ta_recommendation TEXT`,
  `ta_breakout_status TEXT`, `ta_ma_state TEXT`, `ta_conviction INTEGER`; extend
  `upsert_alert_state` with keyword-only params (existing callers unaffected).
- `backend/app/alerts.py::detect`: iterate portfolio ∪ watchlist (alerts are for the user's own
  stakes; signal-source candidates surface via Suggestions, not alerts). Load
  `db.get_all_analyses` once. New types + severities:
  - `breakdown_warning` (**high**) — breakout state `approaching`, direction down (price within
    1 ATR above strong support) — *the warn-before-falls alert*. Key `breakdown_warning|{t}|{level}`.
  - `breakout_setup` (medium) — `approaching`, direction up — *warn-before-breakout*. Key `breakout_setup|{t}|{level}`.
  - `breakout_confirmed` (**high**) — transition to `confirmed`. Key `breakout_confirmed|{t}|{level}`.
  - `false_breakout` (**high**) — transition to `failed` (trap sprung). Key `false_breakout|{t}|{date}`.
  - `topping_formation` (**high**) — `ma_state` transitions to `topping`. Key `topping|{t}|{date}`.
  - `recommendation_change` (**high** when new value is buy or sell, else medium) — prev
    `ta_recommendation` non-null and ≠ current. Key `reco|{t}|{new}|{date}`. Message includes
    entry/stop/target/R:R + top evidence lines.
  - **First-run seeding**: TA alerts only fire when the previous `ta_*` snapshot is non-null; the
    first pass just records state (prevents a deploy-time alert storm).
  - Snapshot upsert must also run for tickers that have an analysis but no Boom score.
  - High-severity delivery unchanged: `notify.push_alert` → email/SMS per user profile.
- Frontend: add the six new types to the alert type/icon map used by `AlertsBell.jsx` (or port
  `AlertsPanel.jsx`'s `TYPE_ICON` map there).

### Phase 4 — Suggestions driven by the TA engine

- `backend/app/suggestions.py`:
  - `_opportunity_universe(conn, user_id, held)` = (user watchlist ∪ signal-candidate tickers) −
    held — single pluggable function.
  - Replace the opportunities block (:189-201): candidates where stored analysis has
    `recommendation == "buy"` **and** `rr_pass`; rank by `(conviction desc, rr desc)`; top
    `SUGGESTIONS_COUNT`. Row keeps old keys (`ticker`, `score`, `signals`) and adds
    `recommendation`, `conviction`, `rr`, `entry`, `stop`, `target`, `evidence` (top 3 details) —
    Boom score demoted to secondary evidence. Fallback: if no candidate has a stored analysis yet
    (fresh deploy), keep Boom ranking with `ta_pending: true` — explicit absence, no fabricated TA.
  - `holdings_alerts`: enrich rows with `ta_recommendation`/`ta_conviction`; a TA sell overrides
    the action string ("Reduce — TA breakdown: …"); Boom/earnings logic stays as fallback. This is
    the background **buy/sell/hold answer for held + watched names**.
  - `render_email`/`render_sms`: lead with TA (`AAPL · BUY (conv 62, R/R 3.4) — entry/stop/target …`), guard `ta_pending`.
- Frontend:
  - `SuggestionsPanel.jsx` (~:99-114): recommendation badge, conviction, R/R, entry/stop, evidence
    chips; Boom as secondary chip; handle `ta_pending`.
  - `StockDetailPanel.jsx`: recommendation badge next to directive; evidence list (component-tagged);
    candles; volume read; breakout state + staging note; `rr_pass` flag.
  - `ChartPro.jsx` PLAN overlay (~:392-422): diagonal trendlines as two-point line series from
    `trendlines[].pivots` (dashed when `broken`); style `source==="round"` levels distinctly.

### Phase 5 — Single port (backend serves `frontend/dist`)

- `backend/app/main.py` (end of file): resolve `_dist = STOCKS_STATIC_DIR or
  <repo>/frontend/dist`; **only if `index.html` exists** (dev/tests without a build unaffected):
  mount `/assets` via `StaticFiles`, then a **last-registered** catch-all `GET /{path:path}` —
  `path.startswith("api")` → 404 (unknown API routes must not get index.html); real file →
  `FileResponse`; else `index.html` with `Cache-Control: no-cache`. Auth middleware already guards
  only `/api*`; hash routing needs nothing more.
- `frontend/src/api.js:1`: default `BASE` becomes `""` (same-origin relative).
- `frontend/vite.config.js`: add `server.proxy = { "/api": "http://localhost:8000" }` so the
  :5173 dev flow keeps working with the relative default. CORS middleware stays for anyone still
  setting `VITE_API_BASE` cross-origin.
- Update `frontend/.env.example` (VITE_API_BASE now optional/empty), `run-dev.bat`, and
  `CLAUDE.md` (document both modes: single-port `npm run build` + uvicorn :8000; dev 2-process).

---

## Test plan ("make sure the analyze function is good")

Extend `backend/tests/test_analysis.py` (reuse its synthetic-bar helpers; split into
`test_analysis_candles.py` / `test_analysis_levels.py` / `test_analysis_volume.py` if long):
- **Candles**: positive + negative case per pattern (hammer after decline detected; same shape
  after an advance is NOT a hammer; harami half-body rule; doji body threshold).
- **Trendlines**: 3 collinear ascending lows → support line, touches=3, confidence > 2-touch case;
  broken-line flag; parallel pair → channel evidence.
- **Round numbers**: px=97 → 100 resistance / 95, 90 support, `source="round"`, touch counting.
- **Gap classification**: breakaway/runaway/exhaustion fixtures; unfilled up-gap below price
  produces a `source="gap"` support level.
- **Volume**: streak sign/length; expanding vs contracting; all-zero volume → `volume is None`
  and no volume Evidence (explicit absence, per the no-fabrication principle).
- **MA structure**: even-spaced stacked bull → `healthy_uptrend`; converged MAs after a run +
  price under MA20 → `topping`; recross sequence → `reclaiming`; extension >2.5 ATR → warning.
- **Breakout**: `approaching` within 1 ATR of resistance; two closes above → `confirmed`
  (+`volume_confirmed` with a 2× volume bar); break-then-snap-back with long opposing wick →
  `failed`; low-volume break carries a "suspect" note.
- **Stops/R:R**: structure buffer now 1×ATR (update `test_compute_stop_prefers_tighter_structure`);
  rr<3 → `rr_pass is False` and `recommendation=="hold"` even at high conviction; rr≥3 buy passes.
- **`build` integration**: rich synthetic uptrend-with-breakout series → every methodology
  component key present in `{e.component}`, `recommendation` consistent with directive + gate,
  `reasons == [e.detail]`, all existing invariants (`test_build_trade_plan_invariants`) still hold.

Integration (existing `conn` fixture):
- `test_alerts.py`: first `detect` run seeds TA state without firing; mutating stored analysis
  (approaching→confirmed, hold→buy) fires exactly one alert per transition; idempotent re-run
  (dedup); severity map; high severity calls `notify.push_alert` (monkeypatched).
- `test_suggestions.py`: seeded analyses (buy+rr_pass / sell / hold) + boom rows → ranking by
  conviction/rr; `ta_pending` fallback; email/SMS render smoke.
- Universe: `ohlc_fetch`/`analysis_fetch` cover portfolio ∪ watchlist ∪ capped signal candidates;
  `OHLC_MAX_TICKERS` rotation respected.
- Static serving: with `STOCKS_STATIC_DIR` tmp dir → `GET /` serves index, `GET /any/route`
  falls back, `GET /api/unknown` still 404, `/api/health` unaffected; without dist → today's behavior.
- Config: `X_MIN_INTERVAL_SECONDS` default is 3600.

## Verification (end-to-end)

```bash
cd backend && python -m pytest -q                         # full suite
cd frontend && npm run build && npm run lint
# single-port smoke:
cd backend && uvicorn app.main:app --port 8000
curl -s localhost:8000/api/health && curl -sI localhost:8000/ | head -3   # SPA served
# pipeline smoke (authenticated browser session on :8000 only):
#   POST /api/refresh/ohlc → /api/refresh/analysis → /api/refresh/alerts
#   GET /api/analyze/AAPL → verify evidence[], recommendation, breakout, candles, volume, trendlines
#   GET /api/suggestions → TA-ranked opportunities; AlertsBell shows TA alert types
```

## Risks / trade-offs
- Conviction re-weighting shifts existing directives once on deploy; first-run alert seeding
  prevents an alert storm, but stored recommendations will move — call it out in the commit.
- Structure-stop buffer 0.25→1.0 ATR widens stops and shrinks `suggested_shares` — this is what
  the methodology dictates (stop-hunt protection).
- `analysis` moving from every-180s to hourly delays transition detection by up to an hour —
  acceptable for daily-bar signals; the daily force-run and manual refresh cover urgency.
- Universe growth raises the Yahoo OHLC fan-out; stalest-first rotation + `OHLC_MAX_TICKERS`
  keeps each run bounded on the single worker (per `docs/scaling-roadmap.md`).
- The SPA catch-all must stay the last-registered route; the `api` prefix guard prevents
  index.html masking API 404s.

## Critical files
- `backend/app/analysis.py` (engine — bulk of the work)
- `backend/app/models.py`
- `backend/app/main.py` (universe, SOURCES intervals, static serving)
- `backend/app/alerts.py`, `backend/app/suggestions.py`, `backend/app/db.py`, `backend/app/config.py`
- `frontend/src/api.js`, `frontend/vite.config.js`, `frontend/src/components/{SuggestionsPanel,StockDetailPanel,ChartPro,AlertsBell}.jsx`
- `CLAUDE.md`, `frontend/.env.example`, `run-dev.bat`
