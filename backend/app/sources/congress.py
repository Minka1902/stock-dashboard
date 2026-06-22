"""Congressional trades via House Stock Watcher + Senate Stock Watcher APIs."""
import hashlib
from datetime import date, timedelta

import httpx

from app.models import CongressTrade

_HOUSE_URL = "https://housestockwatcher.com/api"
_SENATE_URL = "https://senatestockwatcher.com/api"
_HEADERS = {"User-Agent": "Mozilla/5.0 (Signal Dashboard)"}


def _make_hash(representative: str, ticker: str, transaction_date: str, trade_type: str) -> str:
    raw = f"{representative.upper()}|{ticker.upper()}|{transaction_date}|{trade_type.upper()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _parse_date(raw: str) -> str:
    """Normalize M/D/YYYY or YYYY-MM-DD to YYYY-MM-DD; return raw on failure."""
    if not raw:
        return ""
    raw = raw.strip()
    if len(raw) == 10 and raw[4] == "-":
        return raw
    parts = raw.split("/")
    if len(parts) == 3:
        m, d_str, y = parts
        return f"{y}-{m.zfill(2)}-{d_str.zfill(2)}"
    return raw


def _normalize_type(raw: str) -> str:
    tl = raw.lower()
    if "purchase" in tl or "buy" in tl:
        return "Purchase"
    if "sale" in tl or "sell" in tl:
        return "Sale"
    if "exchange" in tl:
        return "Exchange"
    return raw or "Unknown"


def parse_response(payload: list[dict], chamber: str) -> list[CongressTrade]:
    trades: list[CongressTrade] = []
    seen: set[str] = set()

    for row in payload:
        if not isinstance(row, dict):
            continue

        if chamber == "senate":
            fn = row.get("first_name") or ""
            ln = row.get("last_name") or ""
            representative = f"{fn} {ln}".strip()
        else:
            representative = (row.get("representative") or "").strip()

        ticker = (row.get("ticker") or "").strip().upper()
        if not ticker or not representative:
            continue

        transaction_date = _parse_date(row.get("transaction_date") or "")
        transaction_type = _normalize_type(row.get("type") or "")
        trade_hash = _make_hash(representative, ticker, transaction_date, transaction_type)

        if trade_hash in seen:
            continue
        seen.add(trade_hash)

        trades.append(CongressTrade(
            trade_hash=trade_hash,
            representative=representative,
            party=(row.get("party") or "").strip(),
            state=(row.get("state") or "").strip(),
            ticker=ticker,
            asset_description=(row.get("asset_description") or row.get("asset_type") or "").strip(),
            transaction_date=transaction_date,
            transaction_type=transaction_type,
            amount_range=(row.get("amount") or "").strip(),
            filed_at=_parse_date(row.get("disclosure_date") or ""),
            chamber=chamber,
        ))

    return trades


def fetch(lookback_days: int = 90) -> list[CongressTrade]:
    cutoff = date.today() - timedelta(days=lookback_days)
    all_trades: list[CongressTrade] = []
    seen: set[str] = set()

    with httpx.Client(timeout=30.0, headers=_HEADERS) as client:
        for url, chamber in [(_HOUSE_URL, "house"), (_SENATE_URL, "senate")]:
            try:
                resp = client.get(url)
                resp.raise_for_status()
                payload = resp.json()
                if not isinstance(payload, list):
                    continue
                for t in parse_response(payload, chamber):
                    if t.trade_hash in seen:
                        continue
                    seen.add(t.trade_hash)
                    # Filter to lookback window; include trades with unparseable dates.
                    try:
                        if date.fromisoformat(t.transaction_date) < cutoff:
                            continue
                    except (ValueError, TypeError):
                        pass
                    all_trades.append(t)
            except (httpx.HTTPError, ValueError):
                continue  # one chamber failing does not block the other

    return all_trades
