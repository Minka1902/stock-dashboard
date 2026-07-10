"""Live quotes (incl. pre/post-market) via the Yahoo 1-minute chart API.

On-demand and TTL-cached in memory — never persisted, never in the SOURCES
registry. Price is the last non-null 1m close with includePrePost=true (so
pre/post bars count), falling back to meta.regularMarketPrice. change_pct is
measured against the previous regular-session close (chartPreviousClose) for
every market state, including POST — i.e. after hours it still shows the move
since yesterday's close, like most ticker strips.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

from app import config
from app.models import LiveQuote
from app.sources.technical import _YAHOO_HEADERS, _YAHOO_URL

# Yahoo marketState values outside these three (PREPRE, POSTPOST, CLOSED, ...)
# all mean "no session trading right now".
_STATE_MAP = {"PRE": "PRE", "REGULAR": "LIVE", "POST": "POST"}


def normalize_market_state(raw) -> str:
    return _STATE_MAP.get(str(raw or "").upper(), "CLOSED")


def parse_quote(payload: dict, ticker: str, fetched_at: str) -> LiveQuote | None:
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        return None
    meta = result[0].get("meta") or {}
    closes = ((result[0].get("indicators") or {}).get("quote") or [{}])[0].get("close") or []

    price = next((c for c in reversed(closes) if c is not None), None)
    if price is None:
        price = meta.get("regularMarketPrice")
    if not isinstance(price, (int, float)):
        return None

    prev = meta.get("chartPreviousClose")
    if not isinstance(prev, (int, float)):
        prev = meta.get("previousClose")
    if not isinstance(prev, (int, float)) or prev == 0:
        prev = None

    change_pct = round((price - prev) / prev * 100, 2) if prev is not None else None

    state = normalize_market_state(meta.get("marketState"))
    regular = meta.get("regularMarketPrice")
    regular = round(float(regular), 4) if isinstance(regular, (int, float)) else None

    # Extended-hours move: in PRE the latest price is a pre-market trade vs the
    # previous session close; in POST it is an after-hours trade vs today's
    # regular close. Outside extended hours there is no separate move to show.
    extended_change_pct = None
    if state == "PRE" and prev:
        extended_change_pct = round((price - prev) / prev * 100, 2)
    elif state == "POST" and regular:
        extended_change_pct = round((price - regular) / regular * 100, 2)

    return LiveQuote(
        ticker=ticker.upper(),
        price=round(float(price), 4),
        change_pct=change_pct,
        previous_close=prev,
        market_state=state,
        regular_price=regular,
        extended_change_pct=extended_change_pct,
        fetched_at=fetched_at,
    )


def _fetch_one(client: httpx.Client, ticker: str, fetched_at: str) -> LiveQuote | None:
    try:
        resp = client.get(
            _YAHOO_URL.format(ticker=ticker),
            params={"interval": "1m", "range": "1d", "includePrePost": "true"},
            headers=_YAHOO_HEADERS,
        )
        resp.raise_for_status()
        return parse_quote(resp.json(), ticker, fetched_at)
    except (httpx.HTTPError, ValueError):
        return None


def fetch_quotes(tickers: list[str]) -> list[LiveQuote]:
    """Fetch quotes for `tickers` concurrently (bounded pool) so a cold miss for
    N tickers costs ~one timeout, not N sequential timeouts."""
    if not tickers:
        return []
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    workers = max(1, min(config.QUOTES_MAX_WORKERS, len(tickers)))
    with httpx.Client(timeout=config.QUOTES_TIMEOUT_SECONDS) as client:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = pool.map(lambda t: _fetch_one(client, t, fetched_at), tickers)
    return [q for q in results if q is not None]


# ---- TTL cache (stale-while-revalidate) ----
# ticker -> (expires_at_monotonic, quote-or-None). A None value is a negative
# entry: Yahoo failed for that ticker last time. On expiry we keep serving the
# stale value and refresh it in the background, so a request never blocks on a
# network round-trip once a ticker has been seen once.
_cache: dict[str, tuple[float, LiveQuote | None]] = {}
_lock = threading.Lock()
_refreshing: set[str] = set()  # tickers with an in-flight background refresh


def _store(tickers: list[str], fetched: list[LiveQuote], ttl_seconds: float) -> None:
    expires = time.monotonic() + ttl_seconds
    by_ticker = {q.ticker: q for q in fetched}
    with _lock:
        for t in tickers:
            newq = by_ticker.get(t.upper())
            if newq is not None:
                _cache[t] = (expires, newq)
            else:
                # This fetch missed the ticker — keep any prior (stale) value
                # rather than dropping it, but push the expiry out.
                prev = _cache.get(t)
                _cache[t] = (expires, prev[1] if prev else None)


def _background_refresh(tickers: list[str], ttl_seconds: float) -> None:
    try:
        _store(tickers, fetch_quotes(tickers), ttl_seconds)
    finally:
        with _lock:
            _refreshing.difference_update(tickers)


def get_quotes(tickers: list[str], ttl_seconds: float | None = None) -> list[LiveQuote]:
    if ttl_seconds is None:
        ttl_seconds = config.QUOTES_TTL_SECONDS
    now = time.monotonic()
    hits: list[LiveQuote] = []
    cold: list[str] = []   # never seen — must fetch now so first paint isn't empty
    stale: list[str] = []  # expired — serve stale, refresh in background

    with _lock:
        for t in tickers:
            entry = _cache.get(t)
            if entry is None:
                cold.append(t)
                continue
            if entry[1] is not None:
                hits.append(entry[1])  # serve fresh OR stale value immediately
            if entry[0] <= now:
                stale.append(t)
        to_refresh = [t for t in stale if t not in _refreshing]
        _refreshing.update(to_refresh)

    if to_refresh:
        threading.Thread(
            target=_background_refresh, args=(to_refresh, ttl_seconds), daemon=True
        ).start()

    fetched: list[LiveQuote] = []
    if cold:
        fetched = fetch_quotes(cold)
        _store(cold, fetched, ttl_seconds)

    return sorted(hits + fetched, key=lambda q: q.ticker)
