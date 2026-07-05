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

    return LiveQuote(
        ticker=ticker.upper(),
        price=round(float(price), 4),
        change_pct=change_pct,
        previous_close=prev,
        market_state=normalize_market_state(meta.get("marketState")),
        fetched_at=fetched_at,
    )


def fetch_quotes(tickers: list[str]) -> list[LiveQuote]:
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    quotes: list[LiveQuote] = []
    with httpx.Client(timeout=config.QUOTES_TIMEOUT_SECONDS) as client:
        for ticker in tickers:
            try:
                resp = client.get(
                    _YAHOO_URL.format(ticker=ticker),
                    params={"interval": "1m", "range": "1d", "includePrePost": "true"},
                    headers=_YAHOO_HEADERS,
                )
                resp.raise_for_status()
                quote = parse_quote(resp.json(), ticker, fetched_at)
            except (httpx.HTTPError, ValueError):
                continue
            if quote is not None:
                quotes.append(quote)
    return quotes


# ---- TTL cache ----
# ticker -> (expires_at_monotonic, quote-or-None). A None value is a negative
# entry: Yahoo failed for that ticker, don't retry it until the TTL lapses.
_cache: dict[str, tuple[float, LiveQuote | None]] = {}
_lock = threading.Lock()


def get_quotes(tickers: list[str]) -> list[LiveQuote]:
    now = time.monotonic()
    hits: list[LiveQuote] = []
    missing: list[str] = []

    with _lock:
        for t in tickers:
            entry = _cache.get(t)
            if entry is not None and entry[0] > now:
                if entry[1] is not None:
                    hits.append(entry[1])
            else:
                missing.append(t)

    fetched: list[LiveQuote] = []
    if missing:
        # Fetch outside the lock: two concurrent cold requests may both hit
        # Yahoo (last write wins) — benign, and better than serializing every
        # client behind network latency.
        fetched = fetch_quotes(missing)
        expires = time.monotonic() + config.QUOTES_TTL_SECONDS
        by_ticker = {q.ticker: q for q in fetched}
        with _lock:
            for t in missing:
                _cache[t] = (expires, by_ticker.get(t.upper()))

    return sorted(hits + fetched, key=lambda q: q.ticker)
