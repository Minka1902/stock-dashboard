"""Daily + weekly OHLCV history per portfolio ticker (Yahoo Finance chart API).

Unlike `technical.py` (which keeps only closes for a sparkline), this keeps full
open/high/low/close/volume so the analysis engine can find patterns, gaps and ATR.
`parse_bars` is pure; `fetch` is the throttled HTTP wrapper. Any failure yields
[] for that series and surfaces via the source-status UI (never fabricated data).
"""
import json
from datetime import datetime, timezone

import httpx

from app.models import OHLCBar, OHLCSeries

_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}
# (interval label, Yahoo interval, range)
_SERIES = [("daily", "1d", "2y"), ("weekly", "1wk", "2y")]


def parse_bars(payload: dict) -> list[OHLCBar]:
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        return []
    r = result[0]
    ts = r.get("timestamp") or []
    q = (r.get("indicators") or {}).get("quote", [{}])[0]
    o, h, l, c, v = (q.get(k, []) for k in ("open", "high", "low", "close", "volume"))
    bars: list[OHLCBar] = []
    for i, t in enumerate(ts):
        oo, hh, ll, cc = (arr[i] if i < len(arr) else None for arr in (o, h, l, c))
        if None in (oo, hh, ll, cc):
            continue
        vol = v[i] if i < len(v) and v[i] is not None else 0
        bars.append(OHLCBar(
            date=datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat(),
            open=round(float(oo), 4), high=round(float(hh), 4), low=round(float(ll), 4),
            close=round(float(cc), 4), volume=float(vol),
        ))
    return bars


def fetch(tickers: list[str]) -> list[OHLCSeries]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out: list[OHLCSeries] = []
    with httpx.Client(timeout=30.0, headers=_HEADERS, follow_redirects=True) as client:
        for ticker in tickers:
            for label, interval, rng in _SERIES:
                try:
                    r = client.get(_URL.format(ticker=ticker),
                                   params={"interval": interval, "range": rng})
                    r.raise_for_status()
                    bars = parse_bars(r.json())
                except (httpx.HTTPError, ValueError):
                    continue
                if bars:
                    out.append(OHLCSeries(
                        ticker=ticker.upper(), interval=label,
                        bars_json=json.dumps([b.model_dump() for b in bars]),
                        fetched_at=now,
                    ))
    return out
