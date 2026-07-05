"""FINRA margin statistics — monthly margin-account debit balances, scraped.

No official API; the monthly "Debit Balances in Customers' Securities Margin
Accounts" figures ($ millions) are parsed defensively out of the public page.
Any failure returns [] and surfaces via the source-status UI. %YoY (the signal
input) is computed at read time vs the same month a year earlier.
"""
import re
from datetime import datetime

import httpx

from app.models import MarginDebtPoint

_URL = "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}

# "January 2026" or "Jan-26", followed within a few non-digit chars by the
# first dollar figure of the row (debit balances; later columns are free
# credit balances and get skipped by anchoring on the first match).
_MONTHS_FULL = (
    "January|February|March|April|May|June|July|August|September|October|November|December"
)
_ROW_FULL = re.compile(rf"({_MONTHS_FULL})\s+(\d{{4}})\D{{0,40}}?([\d,]{{4,}})")
_ROW_ABBR = re.compile(r"\b([A-Z][a-z]{2})-(\d{2})\D{0,40}?([\d,]{4,})")

# Plausibility bounds in $ millions (margin debt has been ~$50B–$1.1T historically).
_MIN_VALUE = 10_000
_MAX_VALUE = 10_000_000


def _month_key(name: str, year: str) -> str | None:
    month_fmt = "%B" if len(name) > 3 else "%b"  # "January" vs "Jan"/"May"
    year_fmt = "%Y" if len(year) == 4 else "%y"
    try:
        return datetime.strptime(f"{name} {year}", f"{month_fmt} {year_fmt}").strftime("%Y-%m")
    except ValueError:
        return None


def parse_response(html: str) -> list[MarginDebtPoint]:
    text = re.sub(r"<[^>]+>", " ", html)

    by_month: dict[str, float] = {}
    for pattern in (_ROW_FULL, _ROW_ABBR):
        for name, year, raw_value in pattern.findall(text):
            month = _month_key(name, year)
            if month is None:
                continue
            try:
                value = float(raw_value.replace(",", ""))
            except ValueError:
                continue
            if not _MIN_VALUE <= value <= _MAX_VALUE:
                continue
            by_month.setdefault(month, value)

    return [MarginDebtPoint(month=m, debit_balances=v) for m, v in sorted(by_month.items())]


def fetch() -> list[MarginDebtPoint]:
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        resp = client.get(_URL, headers=_HEADERS)
        resp.raise_for_status()
        return parse_response(resp.text)


def compute_yoy(points: list[MarginDebtPoint]) -> list[dict]:
    """[{month, debit_balances, yoy_pct|None}] — change vs same month prior year."""
    by_month = {p.month: p.debit_balances for p in points}
    out = []
    for p in points:
        prior_key = f"{int(p.month[:4]) - 1}{p.month[4:]}"
        prev = by_month.get(prior_key)
        yoy = round((p.debit_balances / prev - 1) * 100, 1) if prev and prev > 0 else None
        out.append({"month": p.month, "debit_balances": p.debit_balances, "yoy_pct": yoy})
    return out
