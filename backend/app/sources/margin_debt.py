"""FINRA margin statistics — monthly margin-account debit balances, layered.

Tier 1: the public statistics page, with the monthly "Debit Balances in
Customers' Securities Margin Accounts" figures ($ millions) parsed defensively
out of the HTML. Tier 2: the Excel workbook (the page's link, else
config.MARGIN_DEBT_WORKBOOK_URL). Tier 3: a real headless Chromium
(Playwright) loading the page and fetching the workbook from inside it —
FINRA's Cloudflare front answers plain HTTP clients with a 403 challenge but
serves a real browser. Whichever tier succeeds is recorded in the source
status; if all fail, the combined errors surface via the source-status UI.

There is no Query API tier: verified live (2026-11) that api.finra.org
answers 401 without an OAuth token and its metadata endpoint has no
marginStatistics dataset at all.

FINRA publishes once a month, so a run whose stored data is already current
defers to the next release window instead of asking (next_release). When
every tier is blocked, an admin imports the workbook on the Server page
(import_workbook). %YoY (the signal input) is computed at read time vs the
same month a year earlier.
"""
import asyncio
import io
import os
import re
import sys
import time
from datetime import datetime, timezone

import httpx

from app import config
from app.ingest import FetchResult, SourceDeferred
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


def import_workbook(content: bytes) -> FetchResult:
    """The Server page's manual import: margin-statistics.xlsx as downloaded
    from the statistics page. ValueError says why a file is unusable."""
    try:
        points = parse_workbook(content)
    except Exception as exc:
        raise ValueError(f"not a readable .xlsx workbook ({exc})") from None
    if not points:
        raise ValueError("no monthly debit balances found in this workbook")
    return FetchResult(
        points, note=f"manual import: {len(points)} months through {points[-1].month}")


def next_release(latest_month: str) -> datetime:
    """When the month after `latest_month` ("YYYY-MM") can be out.

    FINRA publishes month M in the third week of month M+1, so the figure after
    the latest stored one is due from the 15th (the third week's first day) of
    the month after that one.
    """
    index = int(latest_month[:4]) * 12 + int(latest_month[5:7]) + 1  # 0-based month of M+2
    return datetime(index // 12, index % 12 + 1, 15, tzinfo=timezone.utc)


def _why(exc: Exception) -> str:
    """'HTTP 403 (Cloudflare challenge)' instead of httpx's two-line banner,
    so every tier's reason fits in the brief status line."""
    resp = getattr(exc, "response", None)
    if resp is None:
        return str(exc)
    challenge = " (Cloudflare challenge)" if resp.headers.get("cf-mitigated") == "challenge" else ""
    return f"HTTP {resp.status_code}{challenge}"


# ---- Tier 3: headless browser --------------------------------------------------
#
# Verified live (2026-09): FINRA's Cloudflare hard-blocks ("Sorry, you have been
# blocked") a headless Chromium that announces itself as "HeadlessChrome" in its
# User-Agent, and serves the page normally to the same browser with an ordinary
# Chrome UA. So the only disguise here is dropping the "Headless" token from the
# real browser's own version string — no stealth plugins, no captcha solving.
# If Cloudflare ever escalates to an interactive challenge, this tier fails
# with the page title in the error rather than working around it.

_INSTALL_CMD = r".venv\Scripts\python.exe -m playwright install chromium"
_NOT_INSTALLED = "headless browser not installed — run: "

# Challenge interstitials ("Just a moment...") clear themselves; the hard block
# page ("Attention Required! | Cloudflare") never does. Either way we wait for
# evidence of the real page: the workbook link or the statistics table text.
_READY_JS = """() => {
  if (/just a moment|attention required|checking your browser/i.test(document.title)) return false;
  if (document.querySelector('a[href*=".xls"]')) return true;
  const body = document.body ? document.body.innerText : '';
  return /Debit Balances/i.test(body);
}"""
# The workbook is fetched by the page itself, not by context.request: that
# client lives in Playwright's Node driver, with its own DNS, proxy and TLS
# fingerprint, which Cloudflare may challenge even with the page's clearance
# cookie. Verified live (2026-11): this returns the workbook (HTTP 200).
_FETCH_JS = """async ([url, ms]) => {
  const r = await fetch(url, {signal: AbortSignal.timeout(ms)});
  return r.ok ? {bytes: Array.from(new Uint8Array(await r.arrayBuffer()))} : {status: r.status};
}"""


def _browser_user_agent(version: str) -> str:
    """The launched browser's real Chrome major, minus the HeadlessChrome token."""
    major = (version or "").split(".", 1)[0] or "120"
    if sys.platform == "darwin":
        platform = "Macintosh; Intel Mac OS X 10_15_7"
    elif sys.platform.startswith("linux"):
        platform = "X11; Linux x86_64"
    else:
        platform = "Windows NT 10.0; Win64; x64"
    return (f"Mozilla/5.0 ({platform}) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36")


def _install_hint() -> str:
    hint = _NOT_INSTALLED + _INSTALL_CMD
    browsers_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if browsers_path:
        # The Windows service installs browsers machine-wide; a plain install
        # would land in the installing user's profile, which LocalSystem can't see.
        hint += f" (with PLAYWRIGHT_BROWSERS_PATH={browsers_path} set)"
    return hint


def _import_playwright():
    """Lazy import so the module (and the other tiers) work without playwright."""
    try:
        import playwright.async_api as api
    except ImportError:
        raise RuntimeError(
            _NOT_INSTALLED + r".venv\Scripts\python.exe -m pip install playwright, then "
            + _INSTALL_CMD) from None
    return api


def describe_browser_error(exc: BaseException) -> str:
    """Playwright errors are multi-line banners; keep them status-sized, and
    turn 'no browser binary' into the command that fixes it."""
    msg = str(exc)
    if "Executable doesn't exist" in msg or "playwright install" in msg:
        return _install_hint()
    first = next((ln.strip() for ln in msg.splitlines() if ln.strip()), type(exc).__name__)
    return first[:300]


async def _browser_session(api, timeout_s: float) -> tuple[str, bytes | None, str | None]:
    """Load the statistics page in headless Chromium and, if possible, fetch
    the workbook from inside it (so Cloudflare's clearance carries). Returns
    (page_html, workbook_bytes | None, workbook_error)."""
    deadline = time.monotonic() + timeout_s

    def left_ms() -> float:
        ms = (deadline - time.monotonic()) * 1000
        if ms <= 0:
            raise TimeoutError(f"browser budget of {timeout_s:g}s exhausted")
        return ms

    async with api.async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, timeout=left_ms())
        try:
            context = await browser.new_context(
                user_agent=_browser_user_agent(browser.version),
                locale="en-US",
                viewport={"width": 1366, "height": 900},
            )
            page = await context.new_page()
            resp = await page.goto(_URL, wait_until="domcontentloaded", timeout=left_ms())
            status = resp.status if resp else None
            try:
                await page.wait_for_function(_READY_JS, timeout=left_ms())
            except (api.TimeoutError, TimeoutError):
                title = await page.title()
                raise RuntimeError(
                    f"page never cleared Cloudflare (HTTP {status}, title {title!r})") from None
            html = await page.content()

            workbook: bytes | None = None
            wb_error: str | None = None
            wb_url = find_workbook_url(html) or config.MARGIN_DEBT_WORKBOOK_URL
            if not wb_url:
                wb_error = "no link found on page"
            else:
                try:
                    got = await page.evaluate(_FETCH_JS, [wb_url, left_ms()])
                    if "bytes" in got:
                        workbook = bytes(got["bytes"])
                    else:
                        wb_error = f"HTTP {got['status']}"
                except Exception as exc:  # the page html is still usable
                    wb_error = describe_browser_error(exc)
            return html, workbook, wb_error
        finally:
            await browser.close()


def _run_browser_session(api, timeout_s: float) -> tuple[str, bytes | None, str | None]:
    # An explicit loop, not sync_playwright(): the sync API builds its loop from
    # the global policy, and `uvicorn --reload` on Windows installs
    # WindowsSelectorEventLoopPolicy, whose loops cannot spawn the browser
    # subprocess (NotImplementedError). Proactor always can. Runs on the
    # scheduler/refresh worker thread, which has no loop of its own.
    loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
    try:
        # Hard ceiling on top of the per-step budgets (launch/close overheads).
        return loop.run_until_complete(
            asyncio.wait_for(_browser_session(api, timeout_s), timeout_s + 15))
    finally:
        loop.close()


def fetch_via_browser() -> FetchResult:
    """Tier 3. Prefers the workbook (full history back to 1997) and falls back
    to the page's table (last ~13 months). Raises with a readable reason."""
    api = _import_playwright()
    try:
        html, workbook, wb_error = _run_browser_session(
            api, config.MARGIN_DEBT_BROWSER_TIMEOUT_SECONDS)
    except NotImplementedError:  # a RuntimeError subclass with an empty message
        raise RuntimeError("event loop cannot spawn the browser subprocess") from None
    except RuntimeError:
        raise
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"timed out after {config.MARGIN_DEBT_BROWSER_TIMEOUT_SECONDS:g}s") from None
    except Exception as exc:
        raise RuntimeError(describe_browser_error(exc)) from None

    if workbook is not None:
        try:
            points = parse_workbook(workbook)
        except Exception as exc:
            points, wb_error = [], f"unreadable ({exc})"
        if points:
            return FetchResult(points, note="source: headless browser (workbook)")
        wb_error = wb_error or "no valid rows"
    points = parse_response(html)
    if points:
        return FetchResult(
            points, note=f"source: headless browser (page table; workbook: {wb_error})")
    raise RuntimeError(f"page loaded but no rows parsed (workbook: {wb_error})")


def fetch(latest_month: str | None = None, now: datetime | None = None) -> list[MarginDebtPoint]:
    """`latest_month` is the newest stored month (None on a forced run): while
    FINRA cannot have published the next one yet, the run defers instead of
    asking — which is also what keeps a manual import from being followed by
    a futile, failing fetch."""
    if latest_month:
        due = next_release(latest_month)
        wait = (due - (now or datetime.now(timezone.utc))).total_seconds()
        if wait > 0:
            raise SourceDeferred(
                f"up to date through {latest_month}; the next month is due from "
                f"{due:%Y-%m-%d}", wait)
    errors: list[str] = []
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        # Tier 1: the public statistics page.
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
            errors.append(f"page: {_why(exc)}")
        # Tier 2: the workbook — the page's own link, else the configured URL,
        # so the tier is still tried while the page itself is blocked.
        wb_url = (find_workbook_url(page_html) if page_html else None) or config.MARGIN_DEBT_WORKBOOK_URL
        if not wb_url:
            errors.append("workbook: no URL (none on the page, STOCKS_MARGIN_DEBT_WORKBOOK_URL empty)")
        else:
            try:
                resp = client.get(wb_url, headers=_HEADERS)
                resp.raise_for_status()
                points = parse_workbook(resp.content)
                if points:
                    return FetchResult(points, note="fallback: workbook")
                errors.append("workbook: no valid rows")
            except Exception as exc:
                errors.append(f"workbook: {_why(exc)}")
    # Tier 3: a real browser, outside the httpx client so it isn't held open.
    try:
        return fetch_via_browser()
    except Exception as exc:
        errors.append(f"browser: {exc}")
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
