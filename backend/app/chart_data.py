"""On-demand OHLCV bars for the pro chart (Yahoo chart API, TTL-cached).

Like app/quotes.py this is never in the SOURCES registry: bars are fetched
when a chart asks for them and cached in memory — 30s for intraday intervals
(so an open chart follows the live tape), an hour for daily and up. Intraday
bars keep their epoch timestamps; daily+ bars collapse to dates, matching what
lightweight-charts expects for each resolution.
"""
import threading
import time
from datetime import datetime, timezone

import httpx

from app.sources.ohlc import _HEADERS, _URL

# interval -> (yahoo interval, yahoo range, cache ttl seconds, intraday?)
INTERVALS: dict[str, tuple[str, str, int, bool]] = {
    "1m":  ("1m",  "1d",  30,   True),
    "5m":  ("5m",  "5d",  30,   True),
    "15m": ("15m", "1mo", 60,   True),
    "1h":  ("60m", "3mo", 120,  True),
    "1d":  ("1d",  "2y",  3600, False),
    "1wk": ("1wk", "10y", 3600, False),
    "1mo": ("1mo", "max", 3600, False),
}

_TIMEOUT_SECONDS = 15.0


def parse_chart_bars(payload: dict, intraday: bool) -> list[dict]:
    """Yahoo chart payload -> [{time, open, high, low, close, volume}].

    `time` is epoch seconds for intraday resolutions and "YYYY-MM-DD" for
    daily+ (the two time formats lightweight-charts accepts). Bars with any
    missing OHLC value are dropped, never interpolated.
    """
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        return []
    r = result[0]
    ts = r.get("timestamp") or []
    q = (r.get("indicators") or {}).get("quote", [{}])[0]
    o, h, l, c, v = (q.get(k) or [] for k in ("open", "high", "low", "close", "volume"))
    bars: list[dict] = []
    for i, t in enumerate(ts):
        oo, hh, ll, cc = (arr[i] if i < len(arr) else None for arr in (o, h, l, c))
        if None in (oo, hh, ll, cc):
            continue
        vol = v[i] if i < len(v) and v[i] is not None else 0
        bars.append({
            "time": int(t) if intraday
            else datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat(),
            "open": round(float(oo), 4), "high": round(float(hh), 4),
            "low": round(float(ll), 4), "close": round(float(cc), 4),
            "volume": float(vol),
        })
    if not intraday:
        # Daily+ payloads can repeat the live bar's date; keep the last one.
        dedup: dict[str, dict] = {}
        for b in bars:
            dedup[b["time"]] = b
        bars = sorted(dedup.values(), key=lambda b: b["time"])
    return bars


def fetch_bars(ticker: str, interval: str) -> list[dict]:
    yahoo_interval, yahoo_range, _, intraday = INTERVALS[interval]
    with httpx.Client(timeout=_TIMEOUT_SECONDS, headers=_HEADERS, follow_redirects=True) as client:
        resp = client.get(
            _URL.format(ticker=ticker),
            params={"interval": yahoo_interval, "range": yahoo_range,
                    "includePrePost": "false"},
        )
        resp.raise_for_status()
        return parse_chart_bars(resp.json(), intraday)


# ---- TTL cache: (ticker, interval) -> (expires_at_monotonic, payload) ----
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_lock = threading.Lock()


def get_bars(ticker: str, interval: str) -> dict:
    """Cached bars payload: {ticker, interval, as_of, bars}. Raises KeyError
    for an unknown interval and httpx errors for a failed (uncached) fetch."""
    ticker = ticker.strip().upper()
    key = (ticker, interval)
    ttl = INTERVALS[interval][2]
    now = time.monotonic()

    with _lock:
        entry = _cache.get(key)
        if entry is not None and entry[0] > now:
            return entry[1]

    bars = fetch_bars(ticker, interval)
    payload = {
        "ticker": ticker,
        "interval": interval,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "bars": bars,
    }
    # Cache only non-empty results so a transient upstream failure doesn't
    # blank the chart for a whole TTL window.
    if bars:
        with _lock:
            _cache[key] = (time.monotonic() + ttl, payload)
    return payload
