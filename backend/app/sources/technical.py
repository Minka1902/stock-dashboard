"""Technical signals (RSI, moving averages, 52-week range) per watchlist ticker.

Primary data source: Alpha Vantage TIME_SERIES_DAILY (requires free API key).
Fallback: Yahoo Finance chart API (no key needed).
"""
import json
from datetime import datetime, timezone

import httpx

from app.models import TechnicalSignal

_AV_URL = "https://www.alphavantage.co/query"
_YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}


# ---------- math ----------

def compute_ma(closes: list[float], period: int) -> float | None:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def compute_rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder's smoothed RSI. Returns None if fewer than period+1 closes."""
    if len(closes) < period + 1:
        return None
    deltas = [closes[i + 1] - closes[i] for i in range(len(closes) - 1)]
    gains = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    for g, l in zip(gains[period:], losses[period:]):
        avg_g = (avg_g * (period - 1) + g) / period
        avg_l = (avg_l * (period - 1) + l) / period
    if avg_l == 0.0:
        return 100.0
    return round(100.0 - (100.0 / (1.0 + avg_g / avg_l)), 2)


# ---------- parsers ----------

def _parse_alphavantage(payload: dict) -> list[float]:
    ts = payload.get("Time Series (Daily)", {})
    return [float(ts[d]["4. close"]) for d in sorted(ts.keys()) if ts[d].get("4. close")]


def _parse_yahoo(payload: dict) -> list[float]:
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        return []
    closes = (result[0].get("indicators") or {}).get("quote", [{}])[0].get("close", [])
    return [c for c in closes if c is not None]


def parse_response(payload: dict, ticker: str, fetched_at: str) -> TechnicalSignal | None:
    closes: list[float] = []
    if "Time Series (Daily)" in payload:
        closes = _parse_alphavantage(payload)
    elif "chart" in payload:
        closes = _parse_yahoo(payload)

    if len(closes) < 15:
        return None

    price = closes[-1]
    prev = closes[-2] if len(closes) >= 2 else price
    change_pct = round((price - prev) / prev * 100, 2) if prev else None

    ma50 = compute_ma(closes, 50)
    ma200 = compute_ma(closes, 200)
    golden_cross = (ma50 > ma200) if (ma50 is not None and ma200 is not None) else None
    rsi14 = compute_rsi(closes, 14)
    high_52w = max(closes[-252:]) if len(closes) >= 252 else max(closes)
    low_52w = min(closes[-252:]) if len(closes) >= 252 else min(closes)

    return TechnicalSignal(
        ticker=ticker.upper(),
        fetched_at=fetched_at,
        price=round(price, 4),
        change_pct=change_pct,
        ma50=round(ma50, 4) if ma50 is not None else None,
        ma200=round(ma200, 4) if ma200 is not None else None,
        golden_cross=golden_cross,
        rsi14=rsi14,
        high_52w=round(high_52w, 4),
        low_52w=round(low_52w, 4),
        prices_json=json.dumps([round(c, 4) for c in closes[-100:]]),
    )


# ---------- fetch ----------

def fetch(tickers: list[str], av_api_key: str | None) -> list[TechnicalSignal]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    signals: list[TechnicalSignal] = []

    with httpx.Client(timeout=30.0) as client:
        for ticker in tickers:
            payload = None

            # Try Alpha Vantage first if a key is configured.
            if av_api_key:
                try:
                    r = client.get(
                        _AV_URL,
                        params={
                            "function": "TIME_SERIES_DAILY",
                            "symbol": ticker,
                            "outputsize": "compact",
                            "apikey": av_api_key,
                        },
                    )
                    r.raise_for_status()
                    data = r.json()
                    if "Time Series (Daily)" in data:
                        payload = data
                    # AV rate-limit returns {"Note": ...} or {"Information": ...}
                except (httpx.HTTPError, ValueError):
                    pass

            # Fall back to Yahoo Finance.
            if payload is None:
                try:
                    r = client.get(
                        _YAHOO_URL.format(ticker=ticker),
                        params={"interval": "1d", "range": "1y"},
                        headers=_YAHOO_HEADERS,
                    )
                    r.raise_for_status()
                    payload = r.json()
                except (httpx.HTTPError, ValueError):
                    continue  # skip this ticker entirely if both sources fail

            sig = parse_response(payload, ticker, now)
            if sig:
                signals.append(sig)

    return signals
