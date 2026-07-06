"""FINRA margin statistics — monthly margin-account debit balances, layered.

Tier 1: the FINRA Query API (public dataset, no auth). Tier 2: the public
statistics page, with the monthly "Debit Balances in Customers' Securities
Margin Accounts" figures ($ millions) parsed defensively out of the HTML.
Tier 3: the Excel workbook linked from that page. Whichever tier succeeds is
recorded in the source status; if all fail, the combined errors surface via
the source-status UI. %YoY (the signal input) is computed at read time vs the
same month a year earlier.
"""
import io
import re
from datetime import datetime

import httpx

from app.ingest import FetchResult
from app.models import MarginDebtPoint

_URL = "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics"
# FINRA Query API (https://developer.finra.org): public datasets allow
# unauthenticated reads. Group/name candidates are tried in order — dataset
# naming has shifted over time.
_API_URLS = [
    "https://api.finra.org/data/group/finra/name/marginStatistics",
    "https://api.finra.org/data/group/FINRA/name/marginStatistics",
]
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


def _normalize_debit(value) -> float | None:
    """Coerce a debit-balance cell to $ millions, or None if implausible."""
    try:
        v = float(str(value).replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return None
    if v > _MAX_VALUE and _MIN_VALUE <= v / 1_000_000 <= _MAX_VALUE:
        v = v / 1_000_000  # dataset published in dollars, not millions
    return v if _MIN_VALUE <= v <= _MAX_VALUE else None


_ISO_MONTH = re.compile(r"^(\d{4})-(\d{2})")


def parse_api_rows(rows: list) -> list[MarginDebtPoint]:
    """Rows from the FINRA Query API -> points. Field names are matched
    defensively (a month-ish key + a debit/margin key) so schema drift
    degrades to 'no rows' instead of wrong numbers."""
    by_month: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        month = None
        debit = None
        for key, value in row.items():
            lk = key.lower()
            if month is None and isinstance(value, str) and ("month" in lk or "date" in lk or lk.endswith("dt")):
                m = _ISO_MONTH.match(value.strip())
                if m:
                    month = f"{m.group(1)}-{m.group(2)}"
            if debit is None and "debit" in lk and ("margin" in lk or "securities" in lk):
                debit = _normalize_debit(value)
        if month and debit is not None:
            by_month.setdefault(month, debit)
    return [MarginDebtPoint(month=m, debit_balances=v) for m, v in sorted(by_month.items())]


_XLSX_HREF = re.compile(r'href="([^"]*margin[^"]*\.xlsx?)"', re.IGNORECASE)


def find_workbook_url(html: str) -> str | None:
    m = _XLSX_HREF.search(html)
    if not m:
        return None
    url = m.group(1)
    return url if url.startswith("http") else f"https://www.finra.org{url}"


def rows_to_points(rows: list[list]) -> list[MarginDebtPoint]:
    """Excel rows (raw cell values) -> points: month cell + first plausible
    debit figure per row. Shared by the workbook tier and its tests."""
    by_month: dict[str, float] = {}
    for cells in rows:
        month = None
        debit = None
        for value in cells:
            if month is None and isinstance(value, datetime):
                month = value.strftime("%Y-%m")
            elif month is None and isinstance(value, str):
                s = value.strip()
                m = _ISO_MONTH.match(s)
                if m:
                    month = f"{m.group(1)}-{m.group(2)}"
                else:
                    fm = re.match(rf"({_MONTHS_FULL})\s+(\d{{4}})", s) or re.match(r"([A-Z][a-z]{2})-(\d{2})$", s)
                    if fm:
                        month = _month_key(fm.group(1), fm.group(2))
            elif debit is None and isinstance(value, (int, float)):
                debit = _normalize_debit(value)
        if month and debit is not None:
            by_month.setdefault(month, debit)
    return [MarginDebtPoint(month=m, debit_balances=v) for m, v in sorted(by_month.items())]


def parse_workbook(content: bytes) -> list[MarginDebtPoint]:
    """Thin openpyxl shell around rows_to_points."""
    import openpyxl

    book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    rows: list[list] = []
    for sheet in book.worksheets:
        for row in sheet.iter_rows(values_only=True):
            rows.append(list(row))
    return rows_to_points(rows)


def fetch() -> list[MarginDebtPoint]:
    errors: list[str] = []
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        # Tier 1: the Query API (structured, complete history).
        for api_url in _API_URLS:
            try:
                resp = client.get(api_url, params={"limit": 1000},
                                  headers={**_HEADERS, "Accept": "application/json"})
                resp.raise_for_status()
                points = parse_api_rows(resp.json())
                if points:
                    return FetchResult(points, note="source: finra query api")
                errors.append(f"api {api_url.rsplit('/', 1)[-1]}: no usable rows")
            except Exception as exc:
                errors.append(f"api: {exc}")
                break  # same host; don't hammer it with the second candidate
        # Tier 2: the public statistics page.
        page_html = None
        try:
            resp = client.get(_URL, headers=_HEADERS)
            resp.raise_for_status()
            page_html = resp.text
            points = parse_response(page_html)
            if points:
                return points
            errors.append("page: no rows parsed")
        except httpx.HTTPError as exc:
            errors.append(f"page: {exc}")
        # Tier 3: the Excel workbook linked from the page.
        try:
            wb_url = find_workbook_url(page_html) if page_html else None
            if wb_url:
                resp = client.get(wb_url, headers=_HEADERS)
                resp.raise_for_status()
                points = parse_workbook(resp.content)
                if points:
                    return FetchResult(points, note="fallback: workbook")
                errors.append("workbook: no valid rows")
            elif page_html is not None:
                errors.append("workbook: no link found on page")
        except Exception as exc:
            errors.append(f"workbook: {exc}")
    raise RuntimeError("; ".join(errors))


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
