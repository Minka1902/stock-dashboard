# Mobile redesign + open STC tasks

## Context

The phone layout (≤640px) is the desktop terminal stacked into one column. Measured at 390×844
with live data: chrome and the failed-source strip push content half a screen down, primary
numbers sit below the fold, the stock page is 8.9 screens with ~830px of controls before the
chart, Trades/History scroll sideways (716–823px), dozens of controls are under 40px, the
watchlist `⋯` menu is clipped off-screen, and there is **no error boundary anywhere**, so any
render error blanks the app (STC-107).

Decisions already made with the user:

- **Full desktop parity on the phone.** Every desktop task stays possible.
- **Same identity, phone-native structure.** Amber, mono numerics, ruled panes stay. Each view
  gets its own phone layout (answer first, sheets instead of inline forms, rows instead of wide
  tables). **Desktop (>640px) must render exactly as today**, except the three desktop-visible
  tasks STC-87, STC-88, STC-91 and the error boundary.
- **Default system text** on the user's phone, and it reads as oversized → the phone gets its own
  smaller type scale and tighter controls.
- **Order C**: safety net and harness → shell + filed bugs → foundations → shared primitives →
  every view → touch pass → QA/docs. STC-94 is an independent backend track.
- STC-94: fix the fetch **and** add a manual import.
- STC-107: crash while scrolling the Watchlist on the phone. Not reproducible in Chromium
  emulation (6 and 38 tickers, 390/360px, touch swipes). Found on the way: a swipe starting on a
  row's drag handle reorders instead of scrolling.

In scope (MSR project STC): STC-92 and its subtasks STC-96…105, STC-87, STC-88, STC-91, STC-94,
STC-107, STC-108.
Out of scope: STC-93 / SP-12 (repo merge + universal installer: needs the stocks-pi repo, own
project) and tasks in other MSR projects (other repositories).

## Execution

- Branch `claude/new-session-jwwhyi`. No PR unless asked.
- **Each phase is implemented by a subagent: `model: opus` (Opus 5.5), `effort: xhigh`**, one
  phase at a time, sequentially, in this working tree. The main session reviews each phase
  (diff, harness report, screenshots), then pushes.
- First commit: copy this plan to `docs/plans/2026-11-10-mobile-redesign.md` with a progress
  checklist at the bottom, ticked per commit, so a fresh agent can resume after a restart.
- One commit per task ID (or per view group in Phase 5), message prefixed with the ID, e.g.
  `fix(mobile): back-to-top clears the tab bar (STC-108)`.
- MSR, per task: `In Progress` when started; when pushed, `In Review` (tasks) / `Ready for QA`
  (bugs) plus a comment with the commit, what changed and how to check it. Never `Done`.
  At the end, create one STC task assigned to Michael: "Phone QA on your device" with the
  checklist from Phase 7.

### Code conventions (binding for every phase)

- One component per file with a co-located `.module.css`. File order: imports → consts →
  helper functions → component (hooks first, `return` last).
- Shared, prop-driven components over copies. Nothing is written twice.
- No unused imports/consts, no comments that restate the code.
- Backend: the most effective implementation, not the prettiest.
- Reuse what exists: `Dialog` (already a bottom sheet ≤640px), `ConfirmDialog`, `Field`,
  `Button`, `MenuButton`/`MenuItem`, `SelectMenu`, `Segmented`, `CollapsibleSection`,
  `Popover` + `lib/floating.js`, `ScrollHint`, `SortHeader` + `hooks/useSortableRows.js`,
  `Skeleton`, `EmptyState`, `useMediaQuery`, `useSettings`, `prefersReducedMotion()`.
- Product rule stands: never fabricate data; unavailable sources show an honest error state.
- Only the four documented breakpoints (1000 / 900 / 640 / 560).

## Phase B — STC-94 margin debt (backend track, runs first)

Files: `backend/app/sources/margin_debt.py`, `backend/app/main.py` (`SourceSpec`, `SOURCES`,
server routes near `_require_admin`), `backend/app/ingest.py`, `backend/app/config.py`,
`backend/tests/test_margin_debt.py`, `frontend/src/components/ServerPanel.jsx`, `frontend/src/api.js`.

1. **Diagnose live.** `www.finra.org` and `api.finra.org` are blocked by this environment's
   network policy. Request both hosts via the environment tools; if declined, work from
   fixtures and list what the user must verify on their machine.
2. **Fix the fetch** according to the diagnosis. Known gaps to close regardless:
   - Tier 3 (workbook) is skipped when the page is blocked and no URL is configured → default
     `MARGIN_DEBT_WORKBOOK_URL` to FINRA's workbook URL, confirmed live.
   - Do not hit FINRA when stored data is already current: `SOURCES` passes the latest stored
     month into `fetch`, which raises `ingest.SourceDeferred("up to date through YYYY-MM", …)`
     until the next monthly release window. This also makes a manual import stick instead of
     flipping back to an error on the next run.
3. **Manual import, generic.** Optional `importer` on `SourceSpec`
   (`bytes -> list[Model]`; margin debt = existing `parse_workbook`).
   `POST /api/server/sources/{name}/import`: admin-only, raw request body (no multipart
   dependency), 5 MB cap → 413, unparsable → 422 with the reason, unknown or non-importable
   source → 404. The write runs on `_refresh_executor` with `refresh_conn` (single-writer rule),
   then stamps status `ok (manual import: N months through YYYY-MM)`, appends a `source_runs`
   row and pulls `derived` forward. `/api/server/sources` rows gain `importable`.
4. **Server page**: importable rows get an "Import file" button (hidden file input) with the
   result or field error inline, and a link to the provider page.
5. Tests: admin gate, 404/413/422, successful import updates rows + status + run row, deferred
   when current, tier 3 reachable without the page.

## Phase 1 — Harness and crash safety net (STC-96, STC-107 part 1)

1. **Harness** `frontend/scripts/mobile-shots.mjs` + `npm run shots:mobile`
   (no new dependency and no lockfile change: `playwright` is resolved with `createRequire`
   from the local or global install, with an install hint when it is missing; honour
   `PLAYWRIGHT_CHROMIUM_PATH`). Against a running backend on `127.0.0.1:8000`:
   - registers a throwaway account, enrols TOTP (RFC 6238 with `node:crypto`), marks it
     onboarded, seeds watchlist (incl. a long list, a second list, `.TA` tickers) + portfolio
   - visits every `TITLES` view, every Trading Bot `?tab=`, `/stock/<T>`, the auth screens
   - widths 360 / 390 / 430, `isMobile` + `hasTouch`, DPR 2; captures full height by sizing the
     viewport to the inner `.scroll` container's `scrollHeight` (the document never scrolls)
   - **gates** (non-zero exit, each naming view + element + px): inner scroller wider than the
     viewport; leaf text clipped by an `overflow:hidden` ancestor (tape and ellipsis excluded);
     interactive hit box under 40×40 (own box or its `::after` extension); any `pageerror` or
     blank `#root`; per-view "first screen" assertions added in Phase 5
   - `--gestures`: touch swipes via CDP on every view from several start points (the STC-107
     reproduction), failing on any `pageerror`
   - `npm run shots:desktop`: at 1440×900 records computed `font-size`, box size and position
     of every text node per view to JSON; `--check` diffs against the committed baseline. This
     is the "desktop unchanged" gate for every later phase.
   - output in `frontend/.mobile-shots/` (gitignored)
2. **`ErrorBoundary`** (`components/ErrorBoundary.jsx`; a class is required by React). Props:
   `label`, `resetKeys`, `fallback`, `onError`, `compact`. Default fallback is a ruled pane:
   caption "This view hit an error", the error message, collapsible stack, buttons **Try
   again**, **Copy details**, **Reload**. Wired at: app root (`Root.jsx`), the view switch in
   `App.jsx` (`resetKeys=[view]`), `StockDetailPanel`, and inside `CollapsibleSection` and
   `Dialog` bodies (`compact`), so one failing pane never takes the page with it.
3. Commit the baseline report (not the images) and the desktop baseline.

## Phase 2 — Shell and filed bugs (STC-97, 99, 108, 88, 87, 91, 107 part 2)

1. **STC-97 type tokens** (`index.css`): one token per distinct size used ≥5 times (9, 9.5, 10,
   10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16) plus role tokens for headings and display
   numbers (lead 17, h3 18–20, h2 22, h1 26–30, hero 34–40, display 44). Desktop values are the
   exact current sizes. Phone block `@media (max-width: 640px) { :root { … } }`:
   captions stay 10–10.5px, UI 12.5→12, body 14→13, lead 17→15, h2 22→18, h1 30→22,
   hero/display → `clamp(26px, 8vw, 34px)`, caption letter-spacing 0.09em→0.06em, inputs 16px
   (no iOS focus zoom). Add `text-size-adjust: 100%`. New setting `textScale`
   (compact 0.93 / default 1 / large 1.08) in `useSettings`, applied as a `--type-scale`
   multiplier in the phone block and exposed in Settings, so the size can be tuned on the
   device without a code change.
2. **Phone controls**: replace the global `main button { min-height: var(--tap) }` rule. Chips,
   segmented items and secondary buttons render 32–34px tall with the hit area extended to
   `--tap` by `::after`; primary buttons and inputs are 44px. One shared rule, not per module.
3. **STC-87 + STC-88 `SourceHealth`** (replaces the `SourceStatus` strip above every page):
   - `lib/sources.js`: every `SOURCE_META` entry gets an `icon`; add the missing glyphs to
     `Icon.jsx`. The icon is used wherever a source is named (SourceGuide, SourceDrawer,
     Server page rows, Info).
   - `components/SourceHealth.jsx`, props `sources`, `variant` (`"inline" | "compact"`), `max`,
     `onOpenDetails`. Rendered in `TopBar` between the title/status and the action buttons.
     Desktop `inline`: a "Not responding" caption and one icon per failing source, each with a
     soft red pulse (opacity only, off under reduced motion, where it is solid red with ▲), a
     tooltip (name + recorded error) and click → details; overflow collapses to `+N`.
     Phone `compact`: one pulsing icon with the count; tap opens a sheet listing each failing
     source (icon, name, error, link to details). Renders nothing when all sources are healthy.
4. **STC-99 shell**:
   - `LiveTicker` ≤640px: market-state stamps collapse to dots (state in the accessible name,
     tap for the full text), row 36px, symbol bold first then price and change at the UI size,
     speed in px/s and slower; ≥2 full quotes visible at 360px.
   - `TopBar` ≤640px: title, status dot (word hidden), SourceHealth, search, alerts, account.
   - `MobileNav`: pinned tabs come from a new `phoneTabs` setting (default = `PRIMARY_KEYS`,
     2–5 tabs); the More sheet is grouped (Modules / Tools / App) and each row has a pin
     toggle. `short` labels for every item; safe-area insets.
5. **STC-108**: `BackToTop` sits above the tab bar via one `--bottom-chrome` variable set by
   `App.module.css` (tab bar + safe area on views, safe area only on the stock page).
6. **STC-91**: `AlertsBell` lists every alert (scrolling list, unread first) instead of the
   newest 8; the per-alert mark-read control gets a real hit area; on the phone the popover is
   a sheet (see Phase 4 item 2, pulled forward for this component).
7. **STC-107 part 2, Watchlist touch**: on coarse pointers the drag handle no longer starts a
   drag on touch-down (`touch-action: pan-y`; drag starts after a 350ms press), Move up/down
   stay in the row menu; rows restack to two lines so the `⋯` menu is always on screen; audit
   `Sparkline`, `Tooltip` and `BackToTop` (it mounts on scroll) for null/empty inputs.
   `--gestures` must pass on the long seeded list.

## Phase 3 — Foundations (STC-98, STC-100)

1. **STC-98**: migrate all ~800 `font-size` declarations to the tokens with a one-off script
   (not committed); no rounding, unmatched sizes decided by hand; canvas fonts in
   `lib/chartStyle.js` / `ChartPro` read the tokens via `getComputedStyle` on theme change;
   delete per-module phone font overrides the tokens replace. Gate: `shots:desktop --check`
   reports zero differences.
2. **STC-100 layout contract** in `index.css`: one phone gutter; section header = title row
   then caption row; `min-width: 0` on grid/flex children; nested panels flatten on the phone
   (inner card loses border and padding); every `minmax(Npx, 1fr)` → `minmax(min(Npx, 100%), 1fr)`;
   phone rules for the 15 panels that have none. Gate: clip check = 0 on every view.

## Phase 4 — Shared primitives (STC-101, STC-102)

1. **`DataTable`** (`components/DataTable.jsx`): `columns: [{ key, label, render, align, sort,
   phone: "title" | "subtitle" | "value" | "meta" | "hidden" }]`, `rows`, `rowKey`,
   `onRowClick`, `rowActions` (render prop → `MenuButton`), `sort`/`onSort` (via
   `useSortableRows` + `SortHeader`), `empty`, `loading`, `dense`, `stickyHeader`, `caption`,
   `groupBy`, `footer`, `layout: "auto" | "table" | "cards" | "scroll"`. `auto` = table above
   640, ruled two-line rows at or below (title + subtitle left, value with ▲/▼ right, meta as a
   caption/value grid revealed on tap), sorting moves to a `SelectMenu` above the list.
2. **Menus become sheets on the phone**: `Popover` renders as a bottom sheet ≤640px, which
   covers `MenuButton`, `SelectMenu`, `UserMenu`, the theme menu and `AlertsBell` in one place.
3. **`Segmented`** gains `overflow="scroll"` (single row, active item scrolled into view).
4. **`SectionIndex`**: sticky horizontally scrolling chip row that jumps between a page's
   `CollapsibleSection`s; sections default collapsed on the phone.
5. **STC-102**: migrate all 20 table components (Analyst, Backtest, BotActivity, Broker,
   Congress, Contracts, EconCalendar, ExitRules, Fundamentals, Investors, Portfolio, Rebalance,
   Scanner, Server, Short, Social, TaxLots, Technical, Trades; `CorrelationHeatmap` stays
   `layout="scroll"`), each with a deliberate phone column mapping. Portfolio's bespoke card
   code is replaced first as the proof of the API.

## Phase 5 — Every view (STC-103, widened to full parity)

One commit per group; each view gets a "first screen" harness assertion.

| Group | View | Phone layout |
|---|---|---|
| Core | Sentiment | The read + gauge in the first screen; indicators as a 2-up grid, 1-up at 360 |
| | Suggestions | One flat row per idea (no nested cards), reasoning clamped to 2 lines with expand |
| | Portfolio | Totals strip first, holdings next; range/currency in one control row; Add, Cash, Sell, Edit, Exit rule in sheets; row tap opens actions |
| | Trades | DataTable rows; filters in one scrolling chip row |
| | News | Source filter → multi-select sheet; headline rows |
| Watch + stock | Watchlist | List tabs scroll in one row; add form in a sheet; two-line rows |
| | Stock page | Sticky compact header (Back, ticker, price, change); primary actions Watch + Paper trade, the rest in `⋯`; chart first at ~52svh; one toolbar row (timeframes scroll) + **Chart tools** sheet (type, indicators, overlays, draw) with a slim drawing rail while a tool is active; only entry/stop/target/last axis labels by default, others as lines with a "labels" toggle; sections collapsed with `SectionIndex` |
| Trading | Trading Bot + 9 tabs | Single scrolling tab row; every tab on DataTable/one-column forms; `OrderTicket`, `NewBotDialog`, `RuleBuilder`/`ConditionRow`, `ExitRulesEditor`, `RebalancePlanner`, `SaleCheck` as full-height sheets, one field per row |
| Reference | History, Calendar, Earnings, X Watch, and the URL-only signal views (contracts, yield-curve, signals, fear-greed, congress, investors, boom-score, short, social, analyst, fundamentals, seasonality, overview) | DataTable rows / stacked panes under the layout contract |
| App | Settings, Info, Server | Sections collapsed by default with `SectionIndex`; Server tables on DataTable |
| | AuthGate | One-column forms; TOTP field `inputmode="numeric"`, `autocomplete="one-time-code"`; QR scaled to the width |

## Phase 6 — Touch pass (STC-104)

- `Tooltip` / `InfoTip` / `Term` under `(hover: none)`: open on tap, close on outside tap,
  never on scroll; long content opens as a sheet. Every explainer reachable on touch.
- `:hover`-only reveals get an always-visible or row-menu alternative.
- Forms: `inputmode` (decimal for prices/qty), `enterkeyhint`, 16px inputs.
- `ChartPro`: one-finger pan, pinch zoom, tap for the crosshair readout; drawing tools usable
  by touch (parity).
- `100vh`/`100svh` audit → `100dvh` where the URL bar matters; safe-area insets on sheets.

## Phase 7 — QA and docs (STC-105)

- Full harness at 360/390/430 in dark, light, dyslexia mode and reduced motion; landscape spot
  check; `shots:desktop --check` clean; before/after grid for the user.
- `DESIGN.md`: phone type scale table, control sizing, layout contract, DataTable phone roles,
  shell, SourceHealth. `PRODUCT.md`: the phone is a supported surface. `CLAUDE.md` frontend
  section: nav pins, DataTable, ErrorBoundary, harness commands, source import. `README` if it
  names changed behaviour.
- Confirm the duplicated constants table in `CLAUDE.md` is still true (`commandItems` ↔
  `desktop/src/tray.js`; extension copies).
- Tick the three STC-92 checklist items with links to the fixing commits.
- Create the device-QA task for the user: iOS Safari + Android Chrome through the tunnel,
  the Watchlist scroll crash (now shows the error instead of a blank page), safe areas,
  FINRA fetch/import on the Windows service.

## Verification

- `cd backend && python -m pytest -q` (all, after Phase B and whenever backend changes).
- `cd frontend && npm run lint && npm run build` after every commit.
- `npm run shots:mobile` (+ `--gestures`) after every frontend phase: all gates green; the
  phase's before/after screenshots reviewed by the main session before pushing.
- `npm run shots:desktop -- --check`: zero differences after Phases 3–6. After Phase 2 the only
  expected differences are the top bar (SourceHealth) and the removed strip.
- `cd desktop && npm run test`, `cd extension && npm run test` if shared constants changed.
- End to end on the built app (`npm run build`, uvicorn on :8000) at 390×844: Portfolio total
  visible without scrolling; candles in the stock page's first screen; ≥2 full quotes on the
  tape at 360px; no sideways scroll except `CorrelationHeatmap`; back-to-top clear of the tab
  bar; failing sources shown as pulsing icons in the top bar; any alert markable as read;
  margin debt workbook importable from the Server page; a thrown render error stays inside
  its pane.

## Known limits

- Only Chromium is available here, so iOS Safari behaviour (including the STC-107 crash, if it
  is WebKit-specific) is verified by the user on device; the boundary makes the error visible.
- Live FINRA testing depends on the two hosts being allowed in this environment.

## Progress

Tick an item in the same commit that completes it.

- [x] Phase B — STC-94 margin debt fetch + manual import
- [x] Phase 1 — STC-96 harness
- [x] Phase 1 — STC-107 ErrorBoundary
- [x] Phase 2 — STC-97 type tokens, text-scale setting, phone control sizing
- [x] Phase 2 — STC-87 + STC-88 SourceHealth
- [x] Phase 2 — STC-99 shell (ticker tape, top bar, nav pins)
- [x] Phase 2 — STC-108 back-to-top
- [ ] Phase 2 — STC-91 alerts
- [ ] Phase 2 — STC-107 watchlist touch
- [ ] Phase 3 — STC-98 font-size migration
- [ ] Phase 3 — STC-100 layout contract
- [ ] Phase 4 — STC-101 DataTable + sheet menus + Segmented scroll + SectionIndex
- [ ] Phase 4 — STC-102 table migrations
- [ ] Phase 5 — Core views
- [ ] Phase 5 — Watchlist + stock page
- [ ] Phase 5 — Trading Bot
- [ ] Phase 5 — Reference views
- [ ] Phase 5 — Settings, Info, Server, AuthGate
- [ ] Phase 6 — STC-104 touch pass
- [ ] Phase 7 — STC-105 QA + docs
