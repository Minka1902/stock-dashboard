# Stock Dashboard — 15-Task Improvement Plan

> **For the implementing agent.** Execute the phases in order. Read the
> "Cross-cutting rules" section first — it governs every task. All file paths are
> relative to the repo root (`stock-dashboard/`).

## Context

The Stock Signal Dashboard (FastAPI + SQLite backend in `backend/`, React 19 + Vite
frontend in `frontend/`) needs a batch of fixes and upgrades requested by the owner:

- Two real **bugs**: the pro chart (`ChartPro.jsx`) throws away the user's zoom/pan on
  every toolbar interaction, and adding a ticker that already exists in the portfolio
  silently **overwrites** the position instead of merging shares and recalculating the
  weighted-average cost (which breaks P/L).
- **Feature gaps**: premarket prices aren't surfaced, the SMA 20/50/150/200 chart lines
  can't be identified on hover, the analyze view can't open in a new tab, there's no
  X/Twitter monitoring, no portfolio categorization, and source errors are truncated.
- A broad **UI/UX pass**: better user display, back-to-top button, hidden scrollbars, a
  consolidated Info page, and a redesign of all big panels using `animejs` v4 +
  `motion` (motion.dev) on top of the existing design-token system.

Decisions already made with the owner (do not re-ask):
- **Task 10 (X bot)**: free/unofficial approach (Nitter-style RSS mirrors). Store the
  data it returns, but stamp the source status as an **error-style warning** while no
  official X API key is configured ("write it as an error but use the data it gives").
  If `STOCKS_X_BEARER` is set, use the official X API v2 and stamp `ok`.
- **Task 12 (WebSocket)**: written recommendation only — do NOT implement.
- **Task 11 (categories)**: theme mapping (Yahoo sector/industry + curated ticker map →
  themes like AI, Medicine, Space), with per-ticker manual override.

## Cross-cutting rules (read first)

1. **Use the context7 MCP server for library docs.** Before writing code against any of
   these, call `resolve-library-id` → `get-library-docs` and read the relevant topics:
   - `lightweight-charts` (v5) — `timeScale()` visible-range save/restore
     (`getVisibleLogicalRange` / `setVisibleLogicalRange`, `getVisibleRange`,
     `scrollToRealTime`), `chart.applyOptions` / `priceScale().applyOptions`,
     `chart.removeSeries`, series `title` option, `subscribeCrosshairMove` and
     `param.seriesData`, panes API (RSI/MACD sub-panes already use it).
   - `animejs` (v4 — the API changed from v3: named exports `animate`, `stagger`,
     `createTimeline`, `utils`) — number count-ups, staggered reveals.
   - `motion` (motion.dev — import from `"motion/react"`) — `motion.*` components,
     `AnimatePresence`, layout animations, `useReducedMotion`.
   - Anything else non-trivial (FastAPI lifespan/route patterns are already established
     in-repo; prefer mirroring existing code over docs).
2. **Animation packages**: `cd frontend && npm install animejs motion`. Use
   `motion/react` for declarative enter/exit/layout animation; use `animejs` for
   imperative effects (count-ups, gauge sweeps, staggered timelines).
3. **Reduced motion is law.** The app has `settings.reducedMotion` →
   `<html data-reduced-motion>` (`frontend/src/hooks/useSettings.js:44-52`) and token
   collapse in `frontend/src/index.css:239-246`. Create
   `frontend/src/lib/motionConfig.js` exporting:
   - `prefersReducedMotion()` — reads the `data-reduced-motion` attribute and the
     OS-level `matchMedia("(prefers-reduced-motion: reduce)")`;
   - shared motion variants (`fadeRise`, `staggerContainer`, `staggerItem`) that
     degrade to zero-duration when reduced;
   - `countUp(el, to, opts)` — animejs number tween that snaps instantly when reduced.
   Every animejs/motion usage in the app must route through this module.
4. **Backend conventions (CLAUDE.md)**: sources never write the DB; `ingest.run_source`
   never raises; all SQLite access lives in `backend/app/db.py`; additive migrations via
   `_try_add_column` inside `init_schema`; new sources registered in `build_sources`
   (`backend/app/main.py:150-180`) **before** `boom_score`/`alerts`; every change gets a
   pytest test mirroring existing patterns (`backend/tests/conftest.py::conn` fixture,
   `authenticate(client)` helper, monkeypatched-httpx fetch tests like
   `tests/test_social.py`, route tests like `tests/test_api.py`).
5. **Frontend conventions**: CSS Modules + tokens from `frontend/src/index.css` (OKLCH,
   amber accent, mono-led; light theme mirror under `:root[data-theme="light"]`) — no
   CSS frameworks. New endpoints wire through `frontend/src/api.js` →
   `frontend/src/hooks/useDashboardData.js` (state + `Promise.allSettled` load + add to
   `EXTERNAL_SOURCES` if it's a refreshable source). Keep accessibility: visible focus
   rings, dyslexia mode untouched, keyboard reachability for every new control.
6. **No fabricated data, ever.** If a source can't produce real data, its status shows
   the error; the UI never shows placeholder values.
7. **Run/verify**: backend `cd backend && .venv/Scripts/python.exe -m pytest` (Windows
   venv path per CLAUDE.md; on Linux `.venv/bin/python`), frontend
   `cd frontend && npm run lint && npm run build`. For manual checks run both apps
   (uvicorn on :8000, vite on :5173).

## Phases and dependencies

- **Phase A — bug fixes**: Task 1, Task 2.
- **Phase B — backend features**: Task 5 (premarket), Task 9-backend (full error
  detail), Task 10 (X source), Task 11-backend (themes).
- **Phase C — UX features**: Task 6 (MA hover), Task 13 (new-tab analyze), Task 8
  (Info page), Task 9-frontend, Task 4 (back to top), Task 7 (hide scrollbars).
  Install `animejs`/`motion` + create `motionConfig.js` at the start of Phase C
  (Task 4 already uses them).
- **Phase D — design pass**: Task 3 (user display), Task 14 (portfolio/watchlist UI),
  Task 15 (big-component redesign).
- **Task 12** is a written recommendation (deliver as `docs/websocket-recommendation.md`).

Dependencies: 11 → 14 (grouping needs categories) · 2 → 14 (edit affordance uses the
new PUT) · 8 → 9-frontend (error UI lives on the Info page) · 5 → 14 (PRE badge in
tables) · 3/4/14 share Task 15's motion language.

---

## Task 1 — Chart must keep its view when settings change  *(bug, Phase A)*

**Problem** (`frontend/src/components/ChartPro.jsx`): one monolithic effect at lines
164-379 (deps `[bars, displayBars, compareBars, analysis, prefs, height, intraday]`)
destroys the chart (`chart.remove()`, line 377), recreates it (`createChart`, line 174)
and calls `chart.timeScale().fitContent()` (line 367) on **every** prefs change — every
toolbar click (type, MA/EMA/BB/VWAP/VOL/RSI/MACD, LOG, vs SPY, PLAN) and every 30s
intraday refresh — discarding the user's zoom/pan. `setPref` (lines 114-120) creates a
new `prefs` object (and a new `prefs.inds` object) on every call, so the effect always
re-fires. There is no visible-range save/restore anywhere in the codebase.

**Approach** — refactor `ChartPro.jsx` (consult context7 lightweight-charts v5 docs
first):

1. Split the monolithic effect into:
   - **Create-once effect**: `createChart(el, staticOptions)` on mount; store in
     `chartRef`; cleanup `chart.remove()` on unmount only. Apply `height` changes via
     `chart.applyOptions({ height })` in a small separate effect.
   - **Options effect**: things expressible as options changes must NOT rebuild
     anything — price-scale mode (LOG / vs-SPY percentage:
     `chart.priceScale("right").applyOptions({ mode })`), `timeScale`
     `timeVisible` (intraday), `scaleMargins` for the volume pane, grid/colors.
   - **Series effect**: on data/series-affecting inputs (`displayBars`, `compareBars`,
     `analysis`, `prefs.type`, individual indicator flags, `prefs.overlays`,
     `prefs.compare`) tear down only the **series**: keep every created series in a
     `seriesRef` array (main + volume + MA/EMA/BB/VWAP + RSI/MACD panes + compare +
     price lines/markers), call `chart.removeSeries(s)` for each, then re-add and
     `setData`.
2. **View preservation**: before rebuilding series (or applying refreshed bars),
   capture `const lr = chart.timeScale().getVisibleLogicalRange()`; after `setData`,
   restore with `setVisibleLogicalRange(lr)`. For the 30s intraday refresh, first check
   whether the user is at the live edge (saved range's `to` ≥ last bar index − ~1); if
   so let the chart follow real time (`scrollToRealTime()`), otherwise restore `lr`.
3. **When fitting IS correct**: keep a `datasetKeyRef = \`${ticker}|${prefs.tf}\``. Only
   call `fitContent()` when the key changes (new ticker or new timeframe — a genuinely
   different dataset). All other paths restore the saved range.
4. **Effect deps hygiene**: `prefs.inds` is a fresh object per `setPref`; depend on a
   stable key (e.g. `JSON.stringify(prefs.inds)`) or individual booleans, not the
   object, so unrelated pref writes don't re-run the series effect.
5. Keep the existing loading state (`setBars(null)`) for timeframe changes only — that
   path is allowed to reset.

**Files**: `frontend/src/components/ChartPro.jsx` (main), no CSS change required.

**Verify** (manual, both apps running): open a ticker (Watchlist → symbol), zoom+pan;
toggle each of MA, EMA, BB, VWAP, VOL, RSI, MACD, LOG, vs SPY, PLAN, and switch chart
types — the visible range must not move. Switch timeframe → refit is expected. On a 1m
chart, wait 30s+ for auto-refresh while zoomed into history — view must hold; when
scrolled to the right edge, new bars keep flowing. `npm run lint && npm run build`.

---

## Task 2 — Portfolio add must merge positions  *(bug, Phase A)*

**Problem**: `db.upsert_holding` (`backend/app/db.py:1329-1339`) does
`ON CONFLICT(user_id, ticker) DO UPDATE SET shares=excluded.shares,
avg_cost=excluded.avg_cost` — adding an existing ticker replaces the position. P/L is
computed on the frontend from `avg_cost` (`PortfolioPanel.jsx:139-141`), so it breaks too.

**Approach**:
1. Change the conflict clause to merge (in SQLite's `DO UPDATE SET`, unqualified /
   `portfolio.`-qualified columns are the pre-update row, `excluded.` is the incoming
   row; all RHS expressions evaluate against the old row, so ordering is safe):
   ```sql
   ON CONFLICT(user_id, ticker) DO UPDATE SET
       avg_cost = (portfolio.shares * portfolio.avg_cost
                   + excluded.shares * excluded.avg_cost)
                  / (portfolio.shares + excluded.shares),
       shares   = portfolio.shares + excluded.shares
   ```
   `added_at` stays untouched (first-buy date preserved — already the behavior).
2. Add an explicit **edit/replace** path so users can still correct a position:
   `PUT /api/portfolio/{ticker}` in `backend/app/main.py` (body `{shares, avg_cost}`,
   same validation as POST at `main.py:551-560`, 404 if not held) → new
   `db.replace_holding(conn, user_id, ticker, shares, avg_cost)` (plain `UPDATE`).
   Return the full updated list like POST/DELETE do.
3. Frontend: `api.js` add `updateHolding(ticker, shares, avgCost)` (PUT);
   `useDashboardData.js` add an `updateHolding` mutator storing the returned list.
   The edit UI itself lands in Task 14 (inline row edit); nothing else changes now —
   POST already returns the new list, so the merged numbers appear automatically.

**Files**: `backend/app/db.py`, `backend/app/main.py`, `frontend/src/api.js`,
`frontend/src/hooks/useDashboardData.js`, tests.

**Tests** (mirror `tests/test_api.py` / db tests): db-level — insert 10 @ 100, upsert
10 @ 200 → shares 20, avg_cost 150, added_at unchanged; API-level — POST twice, GET
shows merged; PUT replaces outright; PUT unknown ticker → 404.

---

## Task 3 — Better user display  *(Phase D)*

**Current**: `frontend/src/components/TopBar.jsx:99-112` — plain email text
(truncated at 160px, hidden < 960px) + a bare logout icon button.

**Approach** — new `frontend/src/components/UserMenu.jsx` + `UserMenu.module.css`,
replacing the user block in TopBar:
- **Avatar chip**: circle with the user's initials (first letter of the email local
  part, or two letters around a dot, uppercased), background = deterministic
  gradient from an email hash mapped onto the token hues (amber/info/positive), amber
  ring on hover/focus. Next to it (≥ 960px) the email local part.
- **Dropdown** (click or Enter/Space; closes on Escape/outside click): full email,
  "Admin" badge when the auth user is admin (check what `useAuth`/`getMe` exposes —
  if `is_admin` isn't in the `/api/auth/me` payload, add it to that response in
  `backend/app/routes_auth.py`), menu items: **Settings** (→ `onNavigate("settings")`),
  **Info / Guide** (→ `onNavigate("info")`, Task 8), divider, **Log out** (existing
  `onLogout`). Thread `onNavigate` into TopBar from `App.jsx` (it already receives
  `user`/`onLogout` at `App.jsx:171-172`).
- **Animation**: `motion/react` `AnimatePresence` scale/fade for the dropdown, via
  `motionConfig.js` variants. Full keyboard support + `aria-expanded`/`aria-haspopup`.

**Verify**: manual — open/close via mouse and keyboard, all items navigate, admin badge
correct for first-registered user, layout OK at < 960px (avatar-only), light + dark +
dyslexia modes, reduced-motion renders instantly.

---

## Task 4 — "Back to top" button  *(Phase C)*

**Current**: the app scrolls in exactly one container — `.scroll` in
`frontend/src/App.module.css:26-31` (`overflow-y:auto`); the window/body never scrolls.

**Approach** — new `frontend/src/components/BackToTop.jsx` + module CSS:
- `App.jsx`: attach a `scrollRef` to the `.scroll` div; render `<BackToTop scrollRef=…/>`
  inside `main` (position: fixed bottom-right, above content, `z-index` below overlays).
- Component: rAF-throttled scroll listener on `scrollRef.current`; visible when
  `scrollTop > 600`. Click → `scrollRef.current.scrollTo({ top: 0, behavior:
  prefersReducedMotion() ? "auto" : "smooth" })`.
- Enter/exit with `motion/react` (fade + rise), amber-accent circular button with an
  up-chevron from the existing `Icon.jsx` set, `aria-label="Back to top"`.

**Verify**: scroll a long view (News/Trades) — button appears, click returns to top
smoothly, hidden again at top; keyboard focusable; reduced-motion jumps instantly.

---

## Task 5 — Premarket (and after-hours) price visibility  *(Phase B backend, Phase C/D UI)*

**Current**: `backend/app/quotes.py` fetches Yahoo v8 chart with `includePrePost=true`
(lines 63-67); `parse_quote` (lines 30-58) takes the last non-null 1-minute close as
`price` (so it already *contains* pre/post ticks) and normalizes `market_state` to
`PRE|LIVE|POST|CLOSED`. But nothing is labeled: `LiveQuote` (`backend/app/models.py:80-86`)
has no explicit extended-hours fields, and the UI shows a bare price. The chart's bars
endpoint (`backend/app/chart_data.py`, `includePrePost=false` at line 73) never shows
extended hours.

**Approach**:
1. **Model** (`models.py` `LiveQuote`): add `regular_price: float | None` (Yahoo
   `meta.regularMarketPrice`) and `extended_change_pct: float | None`.
2. **`parse_quote`**: set `regular_price` from meta. When `market_state` is `PRE`,
   `extended_change_pct` = (price − previous_close) / previous_close · 100 (price is
   the latest premarket trade). When `POST`, compute vs `regular_price` (the session
   close). Otherwise `None`. Keep `change_pct` semantics unchanged. No new HTTP call —
   the v8 payload already has everything.
3. **Chart extended hours (optional toggle)**: `chart_data.py` — give `get_bars` a
   `prepost: bool = False` param that flips `includePrePost` for intraday intervals
   (cache key must include it); `GET /api/chart/{ticker}` (`main.py:434-446`) accepts
   `?prepost=1`; `api.js getChart` passes it; `ChartPro.jsx` gains an **EXT** toolbar
   pill (in `prefs`, default off, rendered only for intraday timeframes).
4. **UI surfacing** (uses `market_state` already returned):
   - `WatchlistPanel.jsx` rows: `PRE`/`POST` badge chip next to the price (amber/info
     tinted) + the extended change % when present.
   - `PortfolioPanel.jsx` price cell: same badge + small extended-change line.
   - `LiveTicker.jsx`: append a compact `PRE`/`AH` marker to symbols in extended hours.
   - `StockDetailPanel.jsx` header: price line shows "Pre-market" / "After hours" label
     with the extended change.

**Tests**: `tests/test_quotes.py` — extend the fake-payload parse tests: PRE state ⇒
`extended_change_pct` computed vs previous close and `regular_price` set; LIVE ⇒
`extended_change_pct is None`. `tests/test_chart_data.py` — `prepost` param changes the
request params + cache key. Manual: during premarket (or mock), badges render.

---

## Task 6 — MA line names on hover  *(Phase C)*

**Current** (`ChartPro.jsx`): MA lines from `MA_DEFS` (lines 46-49: 20/50/150/200) are
added at line 265 via `addLine` (lines 254-262) with `crosshairMarkerVisible:false`, no
`title`, and the series refs are discarded — nothing identifies them on hover. The
crosshair legend (`onMove` lines 357-364, rendered 435-450) shows main-series OHLCV only.

**Approach** (fits naturally into the Task-1 refactor; consult context7 for the v5
`param.seriesData` map API):
1. Change `addLine` to accept a `label` and push `{ series, label, color }` onto an
   `overlaySeriesRef` array (cleared when series are torn down). Call it with labels
   `"SMA 20" / "SMA 50" / "SMA 150" / "SMA 200"`, `"EMA 9" / "EMA 21"`, `"BB upper/mid/
   lower"`, `"VWAP"`. Set `crosshairMarkerVisible: true` on these series.
2. In the crosshair `onMove` handler, for each entry read
   `param.seriesData.get(entry.series)` (line-series datum → `.value`) and build an
   `overlays: [{label, color, value}]` array into the `legend` state.
3. Render them in the legend block (after OHLCV): small color-dot chips
   `● SMA 20 172.31`, matching the existing static color key styling
   (`ChartPro.module.css`). The static bottom key (lines 465-474) stays.

**Verify**: enable MA + EMA + BB + VWAP, hover the chart — the legend lists each active
overlay's name and value at the crosshair; values change while moving; nothing renders
when the indicator is off. Lint passes.

---

## Task 7 — Hide all scrollbars (keep scrolling)  *(Phase C)*

**Current**: global webkit scrollbar styling at `frontend/src/index.css:195-207`;
`scrollbar-gutter: stable` on the main `.scroll` (`App.module.css:26-31`); Firefox thin
scrollbar on the sidebar (`Sidebar.module.css:47-48`); many inner scrollers
(`overflow-x:auto` table wraps in most panels, `AlertsBell`, `CommandPalette`).

**Approach**:
1. In `index.css`, replace the scrollbar block (195-207) with a global hide:
   ```css
   * { scrollbar-width: none; }              /* Firefox */
   *::-webkit-scrollbar { width: 0; height: 0; display: none; }  /* Chromium/Safari */
   ```
2. Remove `scrollbar-gutter: stable` from `App.module.css` (no gutter needed once
   hidden) and delete the sidebar's `scrollbar-width:thin`/`scrollbar-color` rules
   (`Sidebar.module.css:47-48`) — the global rule covers them.
3. Sweep `frontend/src/components/*.module.css` for any other `scrollbar` rules and
   remove them (the global hide wins, but keep the CSS clean).

**Verify**: wheel/trackpad/keyboard scrolling still works in: main view, sidebar nav,
every wide table (Trades, Congress, Contracts…), AlertsBell dropdown, CommandPalette
results — with no visible scrollbars in Chromium and Firefox, light and dark themes.
No horizontal layout shift after removing the gutter.

---

## Task 8 — Consolidated Info page  *(Phase C)*

**Current**: guide content is split — `GuidePanel.jsx` (view id `guide`, "Module
Guide": module cards + glossary from `src/lib/glossary.js`), and `SourceGuide.jsx`
(data-source directory) buried inside `SettingsPanel.jsx:182-190`.

**Approach** — one **Info** page:
1. Rename the view: `guide` → `info`, `TITLES` entry "Info" (`App.jsx:39-61`). Grep for
   every `"guide"` navigation reference and update: Sidebar (add/replace nav item with
   an info icon — check `Sidebar.jsx` NAV), CommandPalette items, the Settings "Learn
   the dashboard" links (`SettingsPanel.jsx:192-211`), TopBar/tour references.
2. Restructure `GuidePanel.jsx` into `InfoPanel.jsx` with three sections and an
   in-page section nav (sticky chip row: **Modules · Data sources · Glossary**):
   - **Modules**: the existing `GROUPS` cards + "How this dashboard thinks" intro
     (reuse the current markup/CSS wholesale).
   - **Data sources**: `<SourceGuide sources={…}/>` moved here (App already threads
     `sources` from `useDashboardData`); this is where Task 9's expandable errors live.
   - **Glossary**: the existing glossary section.
3. Remove the SourceGuide fieldset from `SettingsPanel.jsx`; leave a one-line link
   ("Data sources have moved to the Info page") that calls `onNavigate("info")`.

**Files**: `frontend/src/components/GuidePanel.jsx` → `InfoPanel.jsx` (+ CSS module
rename), `App.jsx`, `Sidebar.jsx`, `CommandPalette.jsx`, `SettingsPanel.jsx`.

**Verify**: Info reachable from sidebar, command palette, and settings link; module
cards still navigate to their views; glossary renders; no dangling `guide` references
(`grep -rn '"guide"' frontend/src`).

---

## Task 9 — Full source-error visibility  *(backend Phase B, UI Phase C, on the Info page)*

**Current**: `ingest.run_source` truncates errors to 120 chars
(`backend/app/ingest.py:70`, `error: {Type}: {msg[:120]}`); `source_status` table
(`db.py:188-193`) has no detail column; the UI truncates further
(`SourceStatus.module.css` 220px ellipsis, full text only in `title` attr;
`SourceGuide.jsx:27-37` same pattern).

**Approach**:
1. **Backend**: add `error_detail` TEXT column to `source_status` via `_try_add_column`
   in `init_schema`. `db.update_source_status` gains an `error_detail: str | None = None`
   param (stored; explicitly NULLed on success so stale errors clear).
   In `run_source`'s except block: keep the short `brief` status, additionally pass
   `error_detail = f"{type(exc).__name__}: {exc}\n\n" + last ~2000 chars of
   `traceback.format_exc()`. `models.SourceStatus` gains `error_detail: str | None`;
   `GET /api/sources` returns it automatically via `model_dump()`.
2. **Frontend** (after Task 8): in `SourceGuide.jsx` (now on the Info page), an errored
   source row gets a "show details" disclosure: expands (motion height/fade) to a
   monospace `<pre>` with the full `error_detail` (fallback: the status string), the
   last-attempt time, record count, and a **Copy** button
   (`navigator.clipboard.writeText`). In the top `SourceStatus.jsx` strip, clicking an
   error chip navigates to the Info page's data-sources section (thread `onNavigate`)
   instead of relying on the hover title.

**Tests**: extend the ingest tests (`tests/test_ingest.py` if present, else add one):
a fetch that raises stores short status + full detail with traceback text; a subsequent
success clears `error_detail`. Route test: `/api/sources` includes the field.

---

## Task 10 — X (Twitter) watcher: @realDonaldTrump + @aistocksavvy  *(Phase B)*

**Current**: no X/Twitter code anywhere; `social` source is ApeWisdom/Reddit only.

**Approach** — a normal `SOURCES` pipeline entry with a **degraded-provenance status**:

1. **Config** (`backend/app/config.py`, `STOCKS_` prefix, mirror existing style):
   `X_ACCOUNTS` (default `"realDonaldTrump,aistocksavvy"`), `X_BEARER` (default `""` —
   official API token), `X_MIRRORS` (comma list of Nitter-style mirror base URLs with a
   few sane defaults), `X_POSTS_LIMIT` (default 30 per account). Document in
   `backend/.env.example`.
2. **Model** (`models.py`): `XPost { account: str, post_id: str, text: str, url: str,
   posted_at: str, tickers: str ("" or comma-joined cashtags/matches), fetched_at: str }`.
3. **Source** `backend/app/sources/x_posts.py`:
   - Pure, unit-testable helpers: `parse_rss(xml_text, account) -> list[XPost]`
     (Nitter RSS `<item>`: title/description → text, link → url, pubDate → ISO
     `posted_at`, guid → `post_id`) and `extract_tickers(text, known: set[str]) ->
     list[str]` (`$TSLA` cashtags + exact watched-ticker word matches).
   - `fetch(accounts, known_tickers)`:
     - If `X_BEARER` set: official API v2 (`GET /2/users/by/username/{u}` then
       `GET /2/users/{id}/tweets?max_results=…&tweet.fields=created_at`), return plain
       `FetchResult(records)` → status `ok`.
     - Else: for each account, iterate `X_MIRRORS`, request `{mirror}/{account}/rss`
       with a short timeout; first parseable response wins; throttle between accounts.
       If at least one account yielded posts, return the records with a **warning**
       (see next point) noting `unofficial mirror — set STOCKS_X_BEARER for official
       API`. If every mirror fails for all accounts, raise (normal error path — no
       data, honest error status).
4. **Ingest warning support** (`backend/app/ingest.py`): extend `FetchResult` with
   `warning: str = ""`. In `run_source`, after a successful `store(...)`: if
   `records.warning` is set, stamp status `f"error: {warning}"` **with the real
   `len(records)` count** (the frontend's `sourceState()` treats any non-`ok` as error
   — exactly the owner's requested "show as error but keep the data"). Otherwise the
   existing `ok` / `ok (note)` logic. Update `run_source`'s docstring.
5. **DB** (`db.py`): table `x_posts` (PK `(account, post_id)`; columns per model) in
   `init_schema`; `upsert_x_posts(conn, records)` (INSERT OR REPLACE);
   `get_x_posts(conn, limit=100)` newest-first. (A boom-score hook can come later —
   out of scope now.)
6. **Registry + route** (`main.py`): module-level `x_posts_fetch()` wrapper (derives
   `known_tickers` from `db.get_all_watched_tickers` + portfolio tickers, monkeypatch
   point for tests); register `"x_posts": (x_posts_fetch, db.upsert_x_posts, 900)`
   **before** `boom_score`; add `GET /api/x-posts`.
7. **Frontend**: `api.js getXPosts()`; `useDashboardData.js` — state entry, add to the
   parallel load and `EXTERNAL_SOURCES`; `SOURCE_META` entry in `src/lib/sources.js`
   (label "X Watch", provider "Nitter mirrors / X API"); new
   `XPostsPanel.jsx` + module CSS — a feed: account header (@handle, deterministic
   avatar like Task 3), relative time, post text with highlighted `$TICKER` chips
   (clickable → Task 13 new-tab analyze), link out to the original post; group or
   filter tabs per account. New view `x` ("X Watch") in `TITLES`/Sidebar/palette; an
   Info-page module card.
8. **Provenance UI**: with no bearer key the source shows red/error in
   SourceStatus/SourceGuide with the warning text (that's intended); the panel itself
   still renders the stored posts with a small "unofficial mirror" tag derived from the
   source status.

**Tests** (mirror `tests/test_social.py`): `parse_rss` on a fixture XML; `extract_tickers`
(cashtags, word matches, no false substring hits); `fetch` with monkeypatched
`httpx.Client` — first mirror 500s, second succeeds ⇒ records + warning set; bearer
path builds official URLs; all-mirrors-fail ⇒ raises. Ingest test: warning ⇒ status
starts with `error:` **and** records were stored with correct count.

---

## Task 11 — Auto-categorize portfolio into themes  *(backend Phase B, UI in Task 14)*

**Current**: `fundamentals` source already fetches `sector`/`industry` per ticker from
Yahoo quoteSummary (`backend/app/sources/fundamentals.py:39-47`) but its universe is
watchlist-only (`main.py:80-84`); portfolio rows have no category.

**Approach**:
1. **Universe fix**: `fundamentals_fetch` (and the equivalent technical/ohlc wrappers
   if they'd help — check before touching) fetches for
   `set(watched) | set(portfolio tickers)` using `db.get_all_portfolio_tickers`.
2. **`backend/app/themes.py`** (new, pure, no I/O): ordered classifier
   `classify(ticker, sector, industry) -> str` over themes
   `AI · Semiconductors · Medicine · Space · Defense · Energy · Finance · Crypto ·
   Consumer · Tech · Other`:
   - explicit curated `TICKER_THEMES` dict first (e.g. NVDA/AMD/PLTR/SMCI → AI,
     RKLB/LUNR/ASTS → Space, LMT/RTX/NOC → Defense, COIN/MSTR/HOOD → Crypto…);
   - then case-insensitive keyword rules on `industry` then `sector`
     ("semiconductor" → Semiconductors; "biotech|pharma|drug|medical|health" →
     Medicine; "aerospace" → Space/Defense; "oil|gas|solar|energy|utilit" → Energy;
     "bank|insur|capital|financ" → Finance; "software|information|internet" → Tech…);
   - fallback `Other`. Missing fundamentals row ⇒ `Other` (never invent).
3. **Manual override**: `_try_add_column(portfolio, "category", "TEXT")` (NULL = auto);
   `db.set_holding_category(conn, user_id, ticker, category | None)`;
   route `PUT /api/portfolio/{ticker}/category` (body `{category: str | null}`,
   validate against the theme list or null; return the updated portfolio list).
4. **Read-time enrichment**: `GET /api/portfolio` returns each holding +
   `category` (override if set, else `classify(...)` using a fundamentals map via a new
   `db.get_fundamentals_map(conn) -> {ticker: (sector, industry)}`) and
   `category_source: "manual" | "auto"`. Prefer a `HoldingOut` response shape (dict or
   model) over widening the storage `Holding` model — `db.get_portfolio` selects the
   new column, the route composes the rest.
5. **Frontend**: `api.js setHoldingCategory(...)`; hook mutator. Grouped rendering is
   Task 14.

**Tests**: `tests/test_themes.py` — curated hits, keyword hits, fallback, None inputs;
API — portfolio response carries auto category from seeded fundamentals; override PUT
wins and survives; invalid category → 422/400.

---

## Task 12 — WebSocket for prices: recommendation only  *(no implementation)*

Write `docs/websocket-recommendation.md`:

**Recommendation: not now — keep polling.** Rationale to include: (1) the backend is a
single uvicorn worker with in-process scheduler/caches (see `docs/scaling-roadmap.md`)
— a WS layer adds connection state to exactly the component that must stay simple;
(2) the upstream is Yahoo's HTTP API polled with a TTL cache (`app/quotes.py`) — there
is no push feed to relay, so a WS would only re-broadcast the same poll at the same
cadence; (3) the current cadence (quotes every 10-30s via `useLiveQuotes`, dashboard
every 3 min) matches the product's signal-oriented (not day-trading) purpose. **If/when
live push is wanted**: prefer **SSE** (`text/event-stream`) first — it rides the
existing cookie-auth middleware and HTTP stack, one-directional fits the use case, and
a single broadcaster task can fan out quote diffs from the existing poller; upgrade to
WebSockets only if bidirectional needs appear, and only after the multi-worker items in
the scaling roadmap.

---

## Task 13 — Analyze opens in a new tab  *(Phase C)*

**Current**: no router. Analyze/detail is in-page state: `detailTicker` in
`App.jsx:84,189-196` (command palette), and local `selected` state in
`WatchlistPanel.jsx:19-21,84` / `PortfolioPanel.jsx:19-21,146` — all render
`StockDetailPanel` inline.

**Approach** — minimal hash deep-link + `window.open`:
1. **Deep link**: in `App.jsx`, parse `location.hash` on mount and on `hashchange`:
   `#/stock/{TICKER}` (validate against the existing ticker regex client-side) ⇒
   render `StockDetailPanel` as a full standalone page (reuse the existing overlay
   rendering path; hide sidebar-driven views underneath as today). The panel's back
   control: `window.close()` — and if the tab wasn't script-opened (close is a no-op),
   fall back to clearing the hash to return to the dashboard. Auth already works —
   same-origin cookie session.
2. **Entry points open a new tab**: replace the inline-state openers with
   `window.open(\`${location.pathname}#/stock/${t}\`, "_blank", "noopener")` in:
   `WatchlistPanel.jsx` symbol click, `PortfolioPanel.jsx` row click,
   `CommandPalette.jsx` result select (`onOpenTicker` in `App.jsx:279`), and Task 10's
   ticker chips. Remove the now-dead `selected`/`detailTicker` inline plumbing (keep
   `detailTicker` only if the hash path reuses it internally).
3. All opens are direct user gestures, so popup blockers don't interfere.

**Files**: `App.jsx`, `WatchlistPanel.jsx`, `PortfolioPanel.jsx`, `CommandPalette.jsx`,
`StockDetailPanel.jsx`.

**Verify**: each entry point opens a new tab showing the right ticker; F5 in that tab
keeps it; invalid hash (`#/stock/../etc`) falls back to the dashboard; back control
closes the tab (script-opened) or clears the hash (hand-typed URL); the existing
Report/PDF links still work.

---

## Task 14 — Portfolio table & watchlist UI upgrade  *(Phase D; needs Tasks 2, 5, 11)*

**PortfolioPanel** (`frontend/src/components/PortfolioPanel.jsx` + module CSS):
- **Summary cards** above the table (replacing/augmenting the `<tfoot>` totals): Total
  value · Day P/L · Total P/L — animejs `countUp` numbers, semantic colors.
- **Theme grouping** (Task 11): rows grouped under category headers with per-group
  subtotals (value, P/L%); each row shows a category chip with a small dropdown to
  override (PUT from Task 11); group headers subtly sticky within the table scroll.
- **Row polish**: price cell keeps the tick-flash but adds the PRE/POST badge +
  extended change (Task 5); P/L and Day% as tinted chips; **inline edit** (pencil →
  shares/avg-cost inputs → save via Task 2's PUT, Escape cancels); row enter/exit via
  `AnimatePresence` on add/remove.
- **Add form**: one refined row — ticker (uppercase, validated), shares, avg cost,
  submit; on merge (POST of existing ticker) show a small inline note "merged into
  existing position — new avg $X" (compare list before/after in the component).

**WatchlistPanel** (`WatchlistPanel.jsx` + module CSS): richer rows — symbol +
price + change chip + market-state/PRE badge (Task 5) + note + added-at; motion
enter/exit on add/remove; nicer add form and empty state consistent with Portfolio.

Both panels: keyboard operability preserved (row actions are buttons), light/dark
themes verified, reduced-motion clean. Use context7 for `motion` layout-animation and
`animejs` count-up docs before starting.

**Verify**: add/merge/edit/remove flows all reflect correctly with animation; group
subtotals sum to the header totals; override persists after reload; lint + build.

---

## Task 15 — Redesign all big components  *(Phase D)*

**Scope** (big panels by size/traffic): `MarketSentimentPanel` (294), `SettingsPanel`
(462, light touch — structure only), `StockDetailPanel` (269), `InfoPanel` (Task 8),
`SeasonalityPanel` (219), `TechnicalPanel` (163), `BoomScorePanel` (148),
`EconCalendarPanel` (145), `SuggestionsPanel` (145), `NewsPanel` (127),
`YieldCurvePanel` (127), `FundamentalsPanel` (115), `AnalystPanel` (113),
`TradesPanel` (112), `CongressPanel` (109), `ContractsPanel` (101), `ShortPanel` (99),
`SocialPanel` (80), plus Task 10's `XPostsPanel`. (Portfolio/Watchlist are Task 14;
TopBar user area is Task 3.)

**Approach** — a consistent design language, not per-panel invention:
1. First fetch `animejs` v4 and `motion` docs via context7; build everything on
   `src/lib/motionConfig.js` (rule 3) and the `index.css` tokens — **no new colors or
   fonts**; both themes + dyslexia mode must keep working.
2. **Shared patterns** (implement once, reuse):
   - Panel header: title + subtitle + data-age badge + per-panel refresh, consistent
     spacing (several panels already approximate this — normalize it, extracting a
     small `PanelHeader.jsx` if it reduces duplication).
   - Staggered entrance: table rows / cards animate in with `motion` stagger variants
     on first data arrival (not on every poll — key off "was loading → has data").
   - Animated numbers: KPI stats and gauges use `countUp` (MarketSentiment composite,
     FearGreed needle sweep via animejs, BoomScore score chips, YieldCurve spread).
   - Hover elevation/border transitions using the existing `--dur-*`/easing tokens.
   - Empty/error states: consistent block with icon + message + retry.
3. **Order of work** (highest traffic first): MarketSentiment → StockDetail →
   Suggestions → News → Trades → BoomScore → Technical → Seasonality → the remaining
   tables (Analyst/Congress/Contracts/Short/Social/EconCalendar/YieldCurve/
   Fundamentals) which share one "data table" treatment → Info → Settings structure.
4. Keep every panel's data props contract (`{data, loading, busy, onRefresh, compact…}`)
   untouched — this is a presentation pass; `useDashboardData` and the API layer do not
   change.
5. Re-check `Tour.jsx` targets (`data-tour` attributes) still exist after markup
   changes, and keep `recharts`-based mini-charts working (restyle, don't replace).

**Verify**: every view renders with data and empty states; tours still anchor; reduced
motion disables all animejs/motion effects; dyslexia + light theme pass; no console
errors; `npm run lint && npm run build`.

---

## Final verification (end-to-end)

1. `cd backend && <venv-python> -m pytest` — all green, including the new tests:
   portfolio merge, quotes premarket fields, ingest warning/error-detail, x_posts
   parse/fetch, themes classifier, routes.
2. `cd frontend && npm run lint && npm run build`.
3. Run both apps; walk the manual checklist embedded in each task above. Highest-value
   smoke: zoom the chart and click every toolbar toggle (Task 1); add the same ticker
   twice and check shares/avg/P&L (Task 2); open analyze from all entry points → new
   tabs (Task 13); kill one source's network (or set a bad mirror list) and read the
   full error from the Info page (Tasks 8-10); toggle reduced motion and re-check the
   redesigned panels (Task 15).
4. Commit per phase with descriptive messages; push to the designated branch.

## Deliverable placement (for the human)

Recommended location in the repo for this plan so the implementing agent finds it:
`docs/plans/2026-07-09-dashboard-improvements-plan.md` — then point the implementing
agent at that path (e.g. "implement docs/plans/2026-07-09-dashboard-improvements-plan.md,
phase by phase").
