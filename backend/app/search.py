"""Ticker / company-name search via Yahoo's keyless search endpoint.

Like quotes.py and chart_data.py this is on-demand (never in SOURCES):
results are fetched when the user types and TTL-cached per query.
"""
import threading
import time

import httpx

from app.sources.ohlc import _HEADERS

_URL = "https://query1.finance.yahoo.com/v1/finance/search"
_TIMEOUT_SECONDS = 10.0
_TTL_SECONDS = 300
_ALLOWED_TYPES = {"EQUITY", "ETF", "INDEX"}


def parse_results(payload: dict, limit: int = 8) -> list[dict]:
    """Yahoo search payload -> [{symbol, name, exchange, type}] (tradables only)."""
    out: list[dict] = []
    for q in payload.get("quotes") or []:
        symbol = (q.get("symbol") or "").strip()
        qtype = (q.get("quoteType") or "").upper()
        if not symbol or qtype not in _ALLOWED_TYPES:
            continue
        out.append({
            "symbol": symbol.upper(),
            "name": q.get("longname") or q.get("shortname") or symbol,
            "exchange": q.get("exchDisp") or q.get("exchange") or "",
            "type": qtype,
        })
        if len(out) >= limit:
            break
    return out


def fetch(query: str, limit: int = 8) -> list[dict]:
    with httpx.Client(timeout=_TIMEOUT_SECONDS, headers=_HEADERS) as client:
        resp = client.get(_URL, params={
            "q": query, "quotesCount": max(limit, 8),
            "newsCount": 0, "listsCount": 0,
        })
        resp.raise_for_status()
        return parse_results(resp.json(), limit)


# ---- TTL cache: normalized query -> (expires_at_monotonic, results) ----
_cache: dict[str, tuple[float, list[dict]]] = {}
_lock = threading.Lock()


def search(query: str, limit: int = 8) -> list[dict]:
    key = query.strip().lower()
    now = time.monotonic()
    with _lock:
        entry = _cache.get(key)
        if entry is not None and entry[0] > now:
            return entry[1]
    results = fetch(query, limit)
    if results:  # don't cache empties: a transient failure shouldn't stick
        with _lock:
            _cache[key] = (now + _TTL_SECONDS, results)
    return results
