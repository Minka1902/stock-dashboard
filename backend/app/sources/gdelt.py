"""GDELT news source (geopolitical / market news).

`parse_response` is pure (no network) so it can be tested directly.
`fetch` is a thin HTTP wrapper around the GDELT DOC 2.0 API.
"""
import json
import re

import httpx

from app.models import NewsArticle

API_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
# GDELT throttles / blocks requests without a descriptive User-Agent.
HEADERS = {"User-Agent": "Mozilla/5.0 (Signal Dashboard; minka.scharff@gmail.com)"}

# GDELT occasionally emits raw control characters inside JSON string values,
# which strict JSON parsers reject. Strip them before parsing.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _loads_lenient(text: str) -> dict:
    try:
        return json.loads(text)
    except ValueError:
        return json.loads(_CONTROL_CHARS.sub("", text))


def _normalize_seendate(raw: str) -> str:
    # GDELT format: 20260622T124500Z -> 2026-06-22T12:45:00Z
    if raw and len(raw) >= 15 and "T" in raw:
        d, t = raw.split("T", 1)
        t = t.rstrip("Z")
        if len(d) == 8 and len(t) >= 6:
            iso = f"{d[0:4]}-{d[4:6]}-{d[6:8]}T{t[0:2]}:{t[2:4]}:{t[4:6]}Z"
            return iso
    return raw


def parse_response(payload: dict) -> list[NewsArticle]:
    articles = []
    seen = set()
    for row in payload.get("articles", []):
        url = row.get("url") or ""
        if not url or url in seen:
            continue
        seen.add(url)
        articles.append(
            NewsArticle(
                url=url,
                title=row.get("title") or "(untitled)",
                domain=row.get("domain") or "",
                seendate=_normalize_seendate(row.get("seendate") or ""),
                sourcecountry=row.get("sourcecountry") or "",
                image=row.get("socialimage") or "",
            )
        )
    return articles


def fetch(query: str, limit: int) -> list[NewsArticle]:
    """Call the live GDELT API and return normalized articles."""
    params = {
        "query": query,
        "mode": "ArtList",
        "maxrecords": limit,
        "format": "json",
        "sort": "DateDesc",
    }
    with httpx.Client(headers=HEADERS, timeout=30.0) as client:
        resp = client.get(API_URL, params=params).raise_for_status()
        body = resp.text.strip()
        if not body:
            return []  # GDELT returns an empty body when it has nothing
        payload = _loads_lenient(body)
    return parse_response(payload)
