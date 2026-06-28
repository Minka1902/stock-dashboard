"""Short interest data from Yahoo Finance quoteSummary."""
from datetime import datetime, timezone

import httpx

from app.models import ShortInterest

_YF_URL = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules=defaultKeyStatistics"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_response(payload: dict, ticker: str, fetched_at: str) -> ShortInterest | None:
    try:
        stats = payload["quoteSummary"]["result"][0]["defaultKeyStatistics"]
    except (KeyError, IndexError, TypeError):
        return None

    def _raw(key: str):
        entry = stats.get(key)
        if isinstance(entry, dict):
            return entry.get("raw")
        return None

    short_pct_float = _raw("shortPercentOfFloat")
    shares_short = _raw("sharesShort")
    days_to_cover = _raw("shortRatio")
    prior_month_shares = _raw("sharesShortPriorMonth")

    squeeze_flag = short_pct_float is not None and short_pct_float > 0.15

    return ShortInterest(
        ticker=ticker,
        fetched_at=fetched_at,
        shares_short=int(shares_short) if shares_short is not None else None,
        short_pct_float=short_pct_float,
        days_to_cover=days_to_cover,
        prior_month_shares=int(prior_month_shares) if prior_month_shares is not None else None,
        squeeze_flag=squeeze_flag,
    )


def fetch(tickers: list[str]) -> list[ShortInterest]:
    fetched_at = _now_iso()
    results: list[ShortInterest] = []
    with httpx.Client(headers=_HEADERS, timeout=15) as client:
        for ticker in tickers:
            try:
                resp = client.get(_YF_URL.format(ticker=ticker))
                resp.raise_for_status()
                record = parse_response(resp.json(), ticker, fetched_at)
                if record is not None:
                    results.append(record)
            except Exception:
                continue
    return results
