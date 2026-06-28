"""Fundamental valuation data per watchlist ticker via Yahoo Finance quoteSummary."""
from datetime import datetime, timezone

import httpx

from app.models import Fundamentals

_YF_URL = (
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
    "?modules=defaultKeyStatistics,summaryProfile,summaryDetail"
)
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}


def _raw(d: dict, key: str) -> float | None:
    v = d.get(key)
    if isinstance(v, dict):
        v = v.get("raw")
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def parse_response(payload: dict, ticker: str, fetched_at: str) -> "Fundamentals | None":
    try:
        result = payload["quoteSummary"]["result"]
        if not result:
            return None
        r = result[0]
    except (KeyError, TypeError, IndexError):
        return None

    profile = r.get("summaryProfile") or {}
    detail = r.get("summaryDetail") or {}
    stats = r.get("defaultKeyStatistics") or {}

    return Fundamentals(
        ticker=ticker.upper(),
        fetched_at=fetched_at,
        sector=profile.get("sector") or None,
        industry=profile.get("industry") or None,
        pe_ratio=_raw(detail, "trailingPE"),
        forward_pe=_raw(detail, "forwardPE"),
        peg_ratio=_raw(stats, "pegRatio"),
        pb_ratio=_raw(detail, "priceToBook"),
        revenue_growth=_raw(stats, "revenueGrowth"),
        profit_margin=_raw(stats, "profitMargins"),
        market_cap=_raw(detail, "marketCap"),
    )


def fetch(tickers: list[str]) -> list[Fundamentals]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    results: list[Fundamentals] = []
    with httpx.Client(headers=_HEADERS, timeout=30.0) as client:
        for ticker in tickers:
            try:
                r = client.get(_YF_URL.format(ticker=ticker))
                r.raise_for_status()
                f = parse_response(r.json(), ticker, now)
                if f:
                    results.append(f)
            except (httpx.HTTPError, ValueError, KeyError):
                continue
    return results
