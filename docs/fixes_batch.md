# Stock Dashboard — 20-Task UI/Feature Plan

## Context

The user listed 20 fixes/features for the Stock Signal Dashboard (FastAPI + SQLite backend in `backend/`, React 19 + Vite frontend in `frontend/`, no router — state-driven views). Mid-planning the user pushed PR #11 (`23dd6be..7474b30`), which added the X Watch source (`backend/app/sources/x_posts.py` — official X API v2 when `STOCKS_X_BEARER` is set, else Nitter RSS mirrors, cashtag/known-ticker extraction), `XPostsPanel.jsx`, an Info page (`InfoPanel.jsx`), a `UserMenu`, `motion@12` + `animejs@4` deps with a shared `lib/motionConfig.js`, and `#/stock/TICKER` new-tab deep links (`lib/nav.js`). The plan below targets this code. Work happens on `claude/dashboard-ui-planning-tsyyry` (already fast-forwarded to `origin/main`; push with `-u`, force-with-lease is fine since the old branch history is merged).

**Decisions agreed with the user:**
- OAuth (GitHub/Facebook/Google) still requires TOTP — social login replaces only the password step.
- Settings/Info leave the side nav; they stay reachable via the existing **UserMenu** (it already has Settings, Info, Log out entries) and the command palette.
- Implementation must consult the **context7 MCP server** for library docs (motion, animejs v4, lightweight-charts v5, authlib/OAuth) and use **animejs/motion** for big UI components that benefit. Both packages are already installed; reuse the `lib/motionConfig.js` policy point (honors reduced-motion).

## Phase A — Small UI fixes

**Task 3 + 13 — Sidebar cleanup** (`frontend/src/components/Sidebar.jsx` + module.css)
- Remove the ordinal `<span className={styles.index}>` (L35) and its CSS/grid column.
- Remove the footer **Info** (L45-53) and **Settings** (L54-62) buttons (keep the tagline note). Access preserved via UserMenu + palette — no new entry points needed.
- Also remove the `MODULE_INDEX` terminal numbers in the TopBar (`App.jsx` L64-71 area) if the user means those too — they are "numbers on navigation"; confirm visually and strip.

**Task 8 — Table header/cell alignment** (~10 panel module.css files)
- Confirmed bug: `.table thead th { text-align:left }` (specificity 0-1-2) beats `.num`/`.numCol` (0-1-0) on `<th>` — e.g. `PortfolioPanel.module.css` L98-109 vs `.numCol` L123-127; `TradesPanel.module.css` L43-56 vs `.num` L71-74.
- Fix in each table's module.css: `.table thead th.num / th.numCol { text-align: right }`; audit JSX so every numeric `<th>` carries the same class as its `<td>`s. Panels: Portfolio, Trades, Technical, Short, Social, Analyst, Congress, Contracts, Fundamentals, EconCalendar.

**Task 6 — Delivery log: last 2 email + 2 SMS** (`SuggestionsPanel.jsx::DeliveryLog` L15-36)
- Client-side: partition fetched log by `channel`, render newest 2 `email` + newest 2 `sms` (drop `alert` rows from this list). Backend `GET /api/suggestions/log` (20 recent) already provides enough rows; if 20 recents can starve a channel, bump `limit` param server-side (`db.get_recent_suggestions` db.py L1613-1618).

## Phase B — Sentiment view (tasks 2, 5) (`MarketSentimentPanel.jsx` + module.css — CSS untouched by PR #11, sizes still large)

- Shrink hero: `.gaugeSvg` `min(100%, 340px)` → ~230px, `.gaugeNum` 44→~28px, `.leanWord` 34→~22px, `.val` 28→~22px; tighten pane padding/gaps so gauge + composite + 4-indicator grid fit one 1080p viewport with no scroll.
- Align the four indicators (VIX/AAII/PutCall/MarginDebt): give `Indicator` a fixed internal grid (title row / value row / threshold row / spark pinned at equal height) and replace AAII's bespoke inline `<LineChart>` (jsx L270-280) with the shared `Sparkline` (extended to accept 2 series) so all four panes have identical geometry.
- Motion: animate the gauge needle and lean-word change with `motion` springs per `motionConfig` (context7: motion React docs).

## Phase C — Charts (tasks 7, 9, 14) (`ChartPro.jsx`)

- **7**: the 7 render styles (candles/hollow/heikin/bars/line/area/baseline, L36-44) exist behind a plain `<select>` (L458-465) — replace with a prominent segmented control with per-type icons + animated active-thumb (motion `layoutId`); keep the localStorage pref.
- **9**: default `height=460` fixed (L107) → viewport-aware: measure available height in `StockDetailPanel` (or `height = clamp(280, viewport - chrome, 460)`) so chart + toolbar + legend fit one screen; chart already re-applies height via `applyOptions`.
- **14**: crosshair legend (L517) shows only `fmtVol` abbreviation — render exact volume too: `Vol 1.23M (1,234,567)` via `Number.toLocaleString()`.
- context7: lightweight-charts v5 docs for series-type swap + sizing APIs.

## Phase D — Market status live (task 4)

- Backend truth: `quotes.py` maps Yahoo `REGULAR→LIVE` (`_STATE_MAP` L23); enum is `PRE|LIVE|POST|CLOSED`.
- Fix stale check in `LiveTicker.jsx` L18 (`!== "REGULAR"` is always true → per-item LIVE badge shows on everything): badge only for `PRE`/`POST`, dot color by state.
- Add clock-based authority so status flips at 9:30 ET even with cached/empty quotes: extend `backend/app/market_calendar.py` with NYSE intraday session logic (9:30–16:00 ET + existing holidays, pre 4:00–9:30, post 16:00–20:00) and include a top-level `market_status` field in the `/api/quotes` response; `LiveTicker` as-of strip + `WatchlistPanel` state cell (L108-110) prefer it over per-quote state.
- `useLiveQuotes.js`: add `visibilitychange` listener → immediate refetch on tab refocus (currently only a fixed `setInterval`).
- Test: pytest for the session-hours function (open/close/holiday/half-day boundaries).

## Phase E — Stock-view navigation bug (task 10) (`App.jsx`)

Diagnosis (confirmed): detail view renders solely off `detailTicker` (L225-232) and all views are gated behind `!detailTicker` (L234); `navigate()` (L92) only calls `setView(v)` — so in a `#/stock/T` tab, sidebar clicks change the TopBar title (`TITLES[view]`) but the overlay stays. Back button → `closeDetail` (L115-119) tries `window.close()` (no-op for `noopener` tabs), then strips the hash and clears state, revealing whichever view was last selected (hence "lands on portfolio").

Fix:
- `navigate(v)`: if `detailTicker` is set, strip the hash via `history.replaceState` and `setDetailTicker(null)` before `setView(v)` (reuse/extract the non-closing part of `closeDetail`).
- While a detail is open, TopBar title shows the ticker (e.g. `TSLA — analysis`) instead of the stale view title.
- `closeDetail`: keep `window.close()` attempt, but when the tab survives, fall back to the dashboard default view (`sentiment`) rather than a stale `view`.
- Animate detail open/close with a `motion` fade/slide (AnimatePresence), per `motionConfig`.

## Phase F — X Watch behaviors (tasks 1, 15, 17, 18, 19)

**19 — "All" sorted by date.** SQL is already `ORDER BY posted_at DESC, rowid DESC` (`db.get_x_posts` db.py L1360-63) and the panel preserves API order — the user-visible account grouping almost certainly comes from **mixed `posted_at` formats** on the mirror path (`_iso_from_pubdate` falls back to the raw RFC-822 string when unparseable, which string-sorts by weekday name). Fix: normalize `posted_at` to strict UTC ISO at parse time (drop the raw fallback — use `fetched_at` and flag), add a one-time normalization pass for existing rows (or simply let upserts heal), and add a defensive date-parse sort in `XPostsPanel` for "all". Unit test with mixed-format fixtures (`tests/test_x_posts.py` exists).

**15 — Tracked accounts editable in Settings.** Accounts are env-only (`config.X_ACCOUNTS`, config.py L176-180). Move to `app_settings`: `_try_add_column` an `x_accounts` TEXT (comma list, default seeded from env); extend `AppSettings` model, `get_app_settings`/`upsert_app_settings` (db.py ~L1410-1441 region), `SettingsUpdate` + admin-only `PUT /api/settings`; `x_posts_fetch` (main.py L90-94) reads accounts from settings with env fallback. Frontend: new "X Watch accounts" fieldset in `SettingsPanel.jsx` (tag-style add/remove of @handles, validate `^[A-Za-z0-9_]{1,15}$`), saved via existing `useAppSettings`.

**17 — Nicer post cards + real profile images.** `lib/avatar.js` is initials+gradient only. Add best-effort real avatars: `<img src="https://unavatar.io/x/{handle}" loading="lazy">` with `onError` fallback to the existing gradient initials (no key needed; degrades gracefully offline). Card polish in `XPostsPanel.jsx`/`module.css`: avatar + display handle header, larger readable text, cashtag chips kept, entrance stagger via `motion` (`staggerContainer/staggerItem` from motionConfig). Optionally have the mirror path capture the per-account avatar URL from the RSS `<channel><image>` and store it (nice-to-have; unavatar covers the default).

**1 — X tab in News.** `NewsPanel.jsx` tabs (L61-84) get an **X** tab: pass `xPosts` from App; when active, render date-sorted X posts using a compact variant of the X card (shared component extracted from `XPostsPanel`) instead of the article rows; other tabs unchanged.

**18 — Ticker-related X posts in analysis.** Add `db.get_x_posts_for(conn, ticker)` matching the comma-joined `tickers` column (`(',' || tickers || ',') LIKE '%,T,%'`) plus a Python-side word-boundary text match for tickers not tagged at ingest; include `"x_posts": [...]` in the `GET /api/analyze/{ticker}` response (same seam as `seasonality_anchors`); render a new "X Watch" pane in `StockDetailPanel.jsx` (after the existing panes) with the shared post card. Pytest for the matcher.

## Phase G — Settings additions (tasks 11, 16)

**11 — User info in Settings.** New "Account" fieldset at the top of `SettingsPanel.jsx`: gradient avatar (`lib/avatar.js`), full email, Admin badge, member-since. Expose `created_at` in `User.public()` (`models.py` L293-295) so `/api/auth/me` carries it; pass `user` down from App (UserMenu already receives it via TopBar).

**16 — Retro + warm themes.** Visual themes are dark|light via `useTheme.js` + `[data-theme=…]` token blocks in `index.css` (L93-147). (Note: backend `themes.py` is an unrelated portfolio-sector classifier — leave it alone.) Add `[data-theme="retro"]` (green-phosphor terminal: dark greens, scanline-adjacent accents, mono-leaning) and `[data-theme="warm"]` (cream/amber paper-like light theme) token blocks covering the full custom-property set; extend `useTheme` from a toggle to a validated 4-theme list; TopBar sun/moon button becomes a small theme menu (motion popover) and a matching picker with preview swatches goes in the Settings "Reading & focus"/appearance area. Verify contrast per theme (charts/recharts read CSS vars where applicable).

## Phase H — Carousel hover-drag (task 20) (`LiveTicker.jsx` + module.css)

Replace the CSS keyframe marquee (`.track` 48s loop) with a JS-driven offset so control can hand over smoothly:
- One `translateX` driven by `motion`'s `useAnimationFrame` + `useMotionValue`, advancing at marquee speed, wrapping modulo half-width (list stays duplicated).
- On hover: pause auto-advance; enable `drag="x"` on the track (motion) mapping onto the same motion value with momentum; wrap the value so dragging is infinite.
- On mouse leave: resume auto-scroll **from the current offset** (no jump).
- Reduced motion: keep today's static, natively scrollable fallback.
- context7: motion docs (`useAnimationFrame`, `useMotionValue`, drag); animejs v4 stays for non-gesture tweens elsewhere.

## Phase I — OAuth login: GitHub, Google, Facebook (task 12)

Backend (new `backend/app/routes_oauth.py`, router mounted under `/api/auth/oauth/*` — already exempt from the auth middleware):
- Add `authlib` to `requirements.txt` (context7 for docs). Providers: GitHub (`read:user user:email`), Google (OIDC + PKCE), Facebook (`email public_profile`).
- `GET /api/auth/oauth/providers` → which providers have credentials configured (frontend hides unconfigured buttons; app runs fine with none — matches the "no-op when unset" convention).
- `GET /api/auth/oauth/{provider}/start` → provider redirect with `state` in a short-lived signed cookie; `GET /api/auth/oauth/{provider}/callback` → code exchange, fetch **verified** email.
- DB: new `oauth_identities` table `(provider, provider_user_id) PK, user_id, email, created_at` in `init_schema` + helpers. Resolution order: existing identity → user by verified email (link) → create user (random unusable password hash; first-ever user still becomes admin via existing logic).
- **TOTP preserved**: after resolution, `totp_enabled` ? start `pending_totp` session : `totp_setup` session (reuse `auth.start_session`), set the session cookie, then 302 to the frontend origin — `AuthGate`'s existing status routing takes over (TOTP challenge or enrollment).
- Env (documented in `backend/.env.example`): `STOCKS_OAUTH_{GITHUB,GOOGLE,FACEBOOK}_CLIENT_ID/SECRET`, `STOCKS_OAUTH_REDIRECT_BASE`.
- Frontend: provider buttons (with logos) in `AuthGate.jsx::LoginRegister`, full-page redirect (no popup), rendered from `/providers`; on return `useAuth` re-fetches status.
- Tests: pytest with monkeypatched httpx fake provider — new-user → `totp_setup`, existing linked user → `pending_totp`, email-collision linking. **Risk**: Facebook email scope needs app review in production; live e2e needs real client IDs — verified via fake-provider tests + button gating only.

## Phase J — Verification (user's check→fix→check loop)

1. Static: `cd backend && .venv/bin/python -m pytest`; `cd frontend && npm run lint && npm run build`.
2. Run both apps (uvicorn :8000 single worker; vite :5173). Invoke the **playwright skill** to drive chromium (preinstalled at `/opt/pw-browsers`).
3. E2E sweep: register + enroll TOTP (pyotp generates codes); visit every view (7 sidebar + palette-only: overview, boom-score, fear-greed, short, social, analyst, fundamentals, seasonality, signals, contracts, yield-curve, x, info, settings); screenshot each. Assert per task: no nav numbers, no Settings/Info in sidebar (but reachable via UserMenu), sentiment fits viewport (no scrollbar), aligned table headers in all 10 tables, 2+2 delivery log, chart type switcher + exact hover volume + one-screen chart, market status coherent, nav-away closes stock view + title correct, News X tab, X "all" date-ordered, avatars with fallback, X pane in analysis, account fieldset in Settings, 4 themes switch, OAuth buttons hidden when unconfigured, carousel drags on hover and resumes.
4. Beyond the 20: audit every view for broken/rough UI or functionality, append findings to a fix list, fix, re-run the sweep — iterate until clean.
5. Commit per phase (clear messages), push `-u origin claude/dashboard-ui-planning-tsyyry` (network retries w/ backoff).

## Risks / notes

- Nitter mirrors are flaky and may be blocked by the sandbox proxy — X data may show the by-design "unofficial mirror" warning status or an honest error during verification; don't fabricate fixtures in the app (tests use canned RSS).
- unavatar.io is best-effort; the gradient-initials fallback must always render.
- OAuth can't be live-tested without real provider credentials (covered by fake-provider tests).
- Sentiment "fits one screen" is viewport-dependent — target ≥900px-tall viewports, degrade gracefully below.