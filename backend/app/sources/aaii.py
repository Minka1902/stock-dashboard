"""AAII Investor Sentiment Survey — scraped from the public results page.

No official free API exists; the weekly bull/neutral/bear percentages are
parsed defensively out of the page text. Any failure returns [] and surfaces
via the source-status UI, like the other unofficial sources.
"""
import re
from datetime import datetime, timezone

import httpx

from app.models import AaiiSentiment

_URL = "https://www.aaii.com/sentimentsurvey/sent_results"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}

_PCT_PATTERNS = {
    "bullish": re.compile(r"Bullish\D{0,40}?([\d.]+)\s*%", re.IGNORECASE),
    "neutral": re.compile(r"Neutral\D{0,40}?([\d.]+)\s*%", re.IGNORECASE),
    "bearish": re.compile(r"Bearish\D{0,40}?([\d.]+)\s*%", re.IGNORECASE),
}
_DATE_US = re.compile(r"Week [Ee]nding\D{0,20}?(\d{1,2}/\d{1,2}/\d{2,4})")
_DATE_LONG = re.compile(r"([A-Z][a-z]+ \d{1,2}, \d{4})")


def _to_iso(raw: str) -> str | None:
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%B %d, %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_response(html: str, fetched_at: str) -> list[AaiiSentiment]:
    text = re.sub(r"<[^>]+>", " ", html)

    pcts: dict[str, float] = {}
    for key, pattern in _PCT_PATTERNS.items():
        m = pattern.search(text)
        if not m:
            return []
        try:
            value = float(m.group(1))
        except ValueError:
            return []
        if not 0 <= value <= 100:
            return []
        pcts[key] = value

    if not 95 <= sum(pcts.values()) <= 105:
        return []

    week_ending = None
    m = _DATE_US.search(text) or _DATE_LONG.search(text)
    if m:
        week_ending = _to_iso(m.group(1))
    if week_ending is None:
        # Weekly upsert key still converges on repeated fetches within a week.
        week_ending = fetched_at[:10]

    return [
        AaiiSentiment(
            week_ending=week_ending,
            bullish=pcts["bullish"],
            neutral=pcts["neutral"],
            bearish=pcts["bearish"],
            fetched_at=fetched_at,
        )
    ]


def fetch() -> list[AaiiSentiment]:
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        resp = client.get(_URL, headers=_HEADERS)
        resp.raise_for_status()
        return parse_response(resp.text, fetched_at)
