# Stock Signal Dashboard — Design Spec

**Date:** 2026-06-22
**Status:** Approved design, pre-implementation
**Working name:** Stock Signal Dashboard

## 1. Purpose

A personal, locally-run web dashboard that aggregates **public signals** about
companies and surfaces early "something is happening here" indicators. It pulls
from government contracts, SEC filings, insider/politician trades, Donald Trump's
social-media posts, and geopolitical news, and produces an on-demand report per
stock.

Built first for personal use; designed cleanly enough to share publicly later.

### Explicit framing: signals, not predictions
This app does **not** claim to predict market booms. No reliable public tool
does. Instead it detects and surfaces **transparent, explainable signals** (e.g.
"won a $2B federal contract," "cluster of insider buys," "Trump posted positively
about this sector"). The user draws their own conclusions. Every signal shows its
source and reasoning — never a black-box score.

## 2. Users & scope

- **Primary user:** the owner, for personal investing research.
- **Future:** possibly public, so avoid choices that block sharing (no hard-coded
  secrets, clean separation of data/UI).
- **v1 is single-user, local, no authentication.**

## 3. Data sources

| Source | Data | Cost / Access | Update cadence |
|--------|------|---------------|----------------|
| SEC EDGAR | Filings (10-K, 10-Q, 8-K), insider trades (Form 4) | Free, no key | A few times/day |
| USASpending.gov | Federal government contracts/awards | Free, no key | Daily-ish |
| Congressional / OGE disclosures | Politician trades; Trump annual disclosure | Free, public | Trades: ~45-day lag. Trump: annual PDF (coarse) |
| Truth Social | Trump's posts → company/sector mentions + sentiment | No official API (scrape/3rd-party feed; fragile) | Frequent (high value) |
| GDELT | Geopolitical news & world events | Free | Continuous |
| Stock prices | Quotes / history | Free option (TBD at impl) | Frequent |
| Claude API | AI-written report summaries | Paid (~cents/report), **opt-in per report** | On demand |

**Honesty notes baked into design:**
- Trump's *personal investments* are annual disclosure PDFs (stale). The real
  Trump signal is his **Truth Social posts**, ingested and NLP-analyzed.
- Truth Social has no official API; ingestion may break if their site changes and
  must respect rate limits. Treated as best-effort.

## 4. Architecture

Three isolated layers:

### 4.1 Data ingestion layer
One small, independent module per source. Each module: fetches → normalizes to a
common schema → writes to SQLite. Each is testable in isolation with a clear
interface (`fetch() -> list[NormalizedRecord]`). Adding/removing a source does not
touch the others.

### 4.2 Backend — FastAPI + SQLite
- Serves a JSON API to the frontend.
- **SQLite single-file DB** (no server to manage).
- **Background scheduler** runs ingestion + the full-market scan on per-source
  intervals (fast sources every few minutes; slow sources a few times/day to
  respect rate limits).
- **Signal computation:** rules that turn normalized records into explainable
  signals.

### 4.3 Frontend — React + Vite
Single-page dashboard:
- **News recap panel** — geopolitical/world-news summary.
- **Signal feed** — ranked, explainable signals across all sources.
- **Discovery panels** — biggest new contracts, latest notable politician/insider
  trades, top Trump mentions (market-wide, since these feeds are small).
- **Watchlist** — user-controlled tickers, deep-dived.
- **Per-stock report page** — combines contracts, filings, trades, Trump mentions,
  and news for one ticker; with **optional AI summary (opt-in per request)**.
- **Per-source "last refreshed" timestamps** visible throughout.

## 5. Two-speed scanning

- **Fast path (instant on load):** watchlist deep-dive + discovery panels, served
  from already-ingested data in SQLite.
- **Background worker (continuous):** full-market scan that progressively
  populates signals for companies the user didn't know to look for.

## 6. Refresh behavior

- Configurable refresh interval, **default 3 minutes** for fast feeds (prices,
  Trump posts, news).
- Slow feeds (contracts, filings) refresh a few times per day (rate-limit aware).
- **Per-source last-updated timestamp shown in the UI** so freshness is always
  transparent.

## 7. AI report summaries

- Powered by the Claude API.
- **Opt-in per report:** before generating any report, the app asks whether to
  include the AI summary (because it costs money). Everything else in the report
  works without AI.

## 8. Per-stock report contents

For a given ticker:
1. Recent government contracts won
2. Key recent SEC filings (with highlights)
3. Insider (Form 4) + politician trade activity
4. Trump social-media mentions (if any)
5. Relevant geopolitical/company news
6. Price context
7. *(Optional)* AI-written narrative tying it together

## 9. Out of scope for v1 (YAGNI)

- User accounts / multi-user auth
- Hosting / deployment (runs locally)
- Mobile app
- Real-time streaming (scheduled refresh is enough)
- Automated trading / brokerage integration
- The "predict the boom" black box (replaced by explainable signals)

## 10. Tech stack summary

- **Backend:** Python, FastAPI, SQLite, a scheduler (e.g. APScheduler).
- **Frontend:** React + Vite.
- **AI:** Claude API (optional, opt-in).
- **Data:** EDGAR, USASpending, GDELT, congressional/OGE disclosures, Truth
  Social ingestion, a free price source.

## 11. Build order (each its own spec → plan → implementation)

Suggested sequence (user had no strong preference):
1. **Skeleton:** FastAPI + SQLite + React shell + per-source "last refreshed"
   plumbing + one ingestion module end-to-end (USASpending contracts — clean free
   API).
2. SEC EDGAR ingestion (filings + Form 4 insider trades).
3. Politician/Trump disclosed trades.
4. Truth Social ingestion + NLP mention/sentiment.
5. GDELT news recap.
6. Signal computation + signal feed + discovery panels.
7. Per-stock report page + optional AI summary.
8. Background full-market scan worker.

## Open questions / risks

- Truth Social ingestion is fragile (no official API) — confirm a viable feed at
  implementation time.
- Free price-data source to be chosen at implementation.
- Congressional trade data has inherent reporting lag (~45 days) — acceptable.
