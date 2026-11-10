import importlib
from datetime import datetime as dt, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db
from app.ingest import SourceDeferred
from app.models import MarginDebtPoint
from app.sources import margin_debt
from tests.conftest import authenticate, drain_refresh


@pytest.fixture(autouse=True)
def _no_real_browser(monkeypatch):
    """No test may launch Chromium or reach FINRA. Tests that exercise the
    browser tier replace these stubs with their own."""
    def _blocked(*a, **kw):
        raise RuntimeError("browser disabled in tests")
    monkeypatch.setattr(margin_debt, "_run_browser_session", _blocked)

SAMPLE_HTML = """
<html><body>
<h1>Margin Statistics</h1>
<table>
  <tr><th>Month/Year</th><th>Debit Balances in Customers' Securities Margin Accounts</th>
      <th>Free Credit Balances in Customers' Cash Accounts</th></tr>
  <tr><td>May 2026</td><td>1,050,123</td><td>180,000</td></tr>
  <tr><td>April 2026</td><td>1,010,500</td><td>175,250</td></tr>
  <tr><td>March 2026</td><td>995,000</td><td>170,000</td></tr>
</table>
<table>
  <tr><td>May-25</td><td>677,499</td><td>160,000</td></tr>
  <tr><td>Apr-25</td><td>650,000</td><td>158,000</td></tr>
</table>
</body></html>
"""


def test_parse_extracts_first_column_per_month():
    points = margin_debt.parse_response(SAMPLE_HTML)
    by_month = {p.month: p.debit_balances for p in points}
    assert by_month["2026-05"] == 1_050_123.0  # not the 180,000 credit column
    assert by_month["2026-04"] == 1_010_500.0
    assert by_month["2025-05"] == 677_499.0


def test_parse_handles_both_month_formats_sorted_asc():
    points = margin_debt.parse_response(SAMPLE_HTML)
    months = [p.month for p in points]
    assert months == sorted(months)
    assert "2025-04" in months  # "Apr-25" abbreviated form
    assert "2026-03" in months  # "March 2026" full form


def test_parse_drops_implausible_values():
    html = "<table><tr><td>May 2026</td><td>1,234</td></tr></table>"  # < 10,000 → junk
    assert margin_debt.parse_response(html) == []


def test_parse_returns_empty_on_garbage():
    assert margin_debt.parse_response("") == []
    assert margin_debt.parse_response("<html><p>maintenance page</p></html>") == []


def _point(month, value):
    return MarginDebtPoint(month=month, debit_balances=value)


def test_compute_yoy_math():
    points = [_point("2025-05", 677_499.0), _point("2026-05", 1_050_123.0)]
    rows = margin_debt.compute_yoy(points)
    assert rows[0]["yoy_pct"] is None  # no 2024-05
    assert rows[1]["yoy_pct"] == round((1_050_123.0 / 677_499.0 - 1) * 100, 1)  # ≈ 55.0


def test_compute_yoy_missing_prior_year_is_none():
    rows = margin_debt.compute_yoy([_point("2026-05", 1_000_000.0), _point("2026-04", 990_000.0)])
    assert all(r["yoy_pct"] is None for r in rows)


def test_compute_yoy_zero_prior_is_none():
    rows = margin_debt.compute_yoy([_point("2025-05", 0.0), _point("2026-05", 1_000_000.0)])
    assert rows[1]["yoy_pct"] is None


def test_compute_yoy_preserves_month_and_balance():
    rows = margin_debt.compute_yoy([_point("2026-05", 1_000_000.0)])
    assert rows == [{"month": "2026-05", "debit_balances": 1_000_000.0, "yoy_pct": None}]


# ---------- workbook tier ----------

def test_find_workbook_url_relative_and_absolute():
    html = '<a href="/sites/default/files/2026-06/margin-statistics.xlsx">xlsx</a>'
    assert margin_debt.find_workbook_url(html) == \
        "https://www.finra.org/sites/default/files/2026-06/margin-statistics.xlsx"
    html2 = '<a href="https://cdn.finra.org/margin_stats.xlsx">xlsx</a>'
    assert margin_debt.find_workbook_url(html2) == "https://cdn.finra.org/margin_stats.xlsx"
    assert margin_debt.find_workbook_url("<p>no link</p>") is None


def test_rows_to_points_handles_datetime_and_text_months():
    rows = [
        ["Month", "Debit Balances"],                    # header skipped
        [dt(2026, 5, 1), 1_050_123.0],
        ["Apr-26", 1_020_000.0],
        ["March 2026", 990_000.0],
        ["2026-02", 970_000.0],
        ["not a month", 960_000.0],                     # no month -> skipped
        [dt(2026, 1, 1), 12.5],                         # implausible value -> skipped
    ]
    points = margin_debt.rows_to_points(rows)
    assert [(p.month, p.debit_balances) for p in points] == [
        ("2026-02", 970_000.0), ("2026-03", 990_000.0),
        ("2026-04", 1_020_000.0), ("2026-05", 1_050_123.0),
    ]


def test_parse_workbook_roundtrip():
    # Build a real xlsx in memory and run it through the workbook tier.
    import io
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Month", "Debit Balances in Customers' Securities Margin Accounts"])
    ws.append([dt(2026, 4, 1), 1_020_000])
    ws.append([dt(2026, 5, 1), 1_050_123])
    buf = io.BytesIO()
    wb.save(buf)

    points = margin_debt.parse_workbook(buf.getvalue())
    assert [(p.month, p.debit_balances) for p in points] == [
        ("2026-04", 1_020_000.0), ("2026-05", 1_050_123.0),
    ]


# ---- tier fallback wiring ----------------------------------------------------
# FINRA answers plain HTTP with a 403 Cloudflare challenge on the statistics
# page and on the workbook alike. These lock down that the workbook tier is
# still *reached* and still *reported* in that state — it used to be skipped
# silently, so the status string claimed fewer tiers had been tried.

class _Resp:
    def __init__(self, text="", content=b"", status=200):
        self.text = text
        self.content = content
        self.status_code = status
        self.headers = {"cf-mitigated": "challenge"} if status == 403 else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"Client error '{self.status_code}'", request=None, response=self)


class _BlockedClient:
    """Page 403; the workbook 403 too unless a file is handed in."""

    def __init__(self, workbook: bytes | None = None, page: str | None = None):
        self.workbook = workbook
        self.page = page
        self.requested = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, **kwargs):
        self.requested.append(url)
        if url.endswith((".xlsx", ".xls")):
            return _Resp(content=self.workbook) if self.workbook else _Resp(status=403)
        return _Resp(text=self.page) if self.page is not None else _Resp(status=403)


def _client_factory(client):
    def _factory(*a, **kw):
        return client
    return _factory


def test_blocked_page_still_reports_the_workbook_tier(monkeypatch):
    """The old code appended nothing for the workbook when the page failed."""
    client = _BlockedClient()
    monkeypatch.setattr(margin_debt.httpx, "Client", _client_factory(client))
    monkeypatch.setattr(margin_debt.config, "MARGIN_DEBT_WORKBOOK_URL", "")

    with pytest.raises(RuntimeError) as excinfo:
        margin_debt.fetch()

    message = str(excinfo.value)
    assert "page: HTTP 403 (Cloudflare challenge)" in message
    assert "workbook: no URL" in message, "the workbook tier must not be silently omitted"


def test_default_workbook_url_is_tried_when_the_page_is_blocked(monkeypatch):
    """Tier 2 needs no page: out of the box it asks FINRA's workbook URL."""
    client = _BlockedClient(workbook=_xlsx([["Month", "Debit Balances"], [dt(2026, 6, 1), 1_060_000]]))
    monkeypatch.setattr(margin_debt.httpx, "Client", _client_factory(client))

    points = margin_debt.fetch()
    assert [(p.month, p.debit_balances) for p in points] == [("2026-06", 1_060_000.0)]
    assert points.note == "fallback: workbook"
    assert client.requested[-1] == margin_debt.config.MARGIN_DEBT_WORKBOOK_URL
    assert client.requested[-1].startswith("https://www.finra.org/")


def test_the_pages_own_workbook_link_wins_over_the_configured_url(monkeypatch):
    link = "/sites/default/files/2027-01/margin-statistics.xlsx"
    client = _BlockedClient(workbook=_xlsx([["Month", "Debit Balances"], [dt(2026, 6, 1), 1_060_000]]),
                            page=f'<a href="{link}">Margin statistics</a>')
    monkeypatch.setattr(margin_debt.httpx, "Client", _client_factory(client))

    margin_debt.fetch()
    assert client.requested == [margin_debt._URL, f"https://www.finra.org{link}"]


def test_margin_debt_cadence_is_weekly_with_a_short_retry():
    """Cadence is about when we ASK; the retry gate is a separate clock, so one
    401 can't freeze the source for the full week."""
    from app import config as app_config

    assert app_config.MARGIN_DEBT_MIN_INTERVAL_SECONDS == 7 * 86400
    assert app_config.MARGIN_DEBT_RETRY_INTERVAL_SECONDS < 86400


def test_margin_debt_and_gdelt_are_not_forced_by_the_daily_run():
    """force_on_daily=True would bypass both gates every weekday."""
    from app import main as main_module

    sources = main_module.build_sources(main_module.conn)
    for name in ("margin_debt", "gdelt"):
        assert sources[name].force_on_daily is False, name
        assert sources[name].retry_interval is not None, name


# ---- tier 4: headless browser ------------------------------------------------
# The Playwright layer (_run_browser_session) is mocked; these cover what we do
# with its output and how its failures are reported.

def _xlsx(rows):
    import io
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _fake_browser(monkeypatch, html="", workbook=None, wb_error=None):
    calls = []

    def _session(api, timeout_s):
        calls.append(timeout_s)
        return html, workbook, wb_error

    monkeypatch.setattr(margin_debt, "_import_playwright", lambda: object())
    monkeypatch.setattr(margin_debt, "_run_browser_session", _session)
    return calls


def test_browser_tier_prefers_the_workbook(monkeypatch):
    book = _xlsx([["Month", "Debit Balances"],
                  [dt(2026, 7, 1), 1_417_225], [dt(2026, 8, 1), 1_453_832]])
    _fake_browser(monkeypatch, html=SAMPLE_HTML, workbook=book)

    points = margin_debt.fetch_via_browser()
    assert [(p.month, p.debit_balances) for p in points] == [
        ("2026-07", 1_417_225.0), ("2026-08", 1_453_832.0)]
    assert points.note == "source: headless browser (workbook)"


def test_browser_tier_falls_back_to_the_page_table(monkeypatch):
    _fake_browser(monkeypatch, html=SAMPLE_HTML, workbook=None, wb_error="HTTP 404")

    points = margin_debt.fetch_via_browser()
    by_month = {p.month: p.debit_balances for p in points}
    assert by_month["2026-05"] == 1_050_123.0
    assert "page table" in points.note and "HTTP 404" in points.note


def test_browser_tier_unreadable_workbook_still_uses_the_table(monkeypatch):
    _fake_browser(monkeypatch, html=SAMPLE_HTML, workbook=b"not an xlsx")
    points = margin_debt.fetch_via_browser()
    assert points and "page table" in points.note


def test_browser_tier_with_nothing_parseable_raises(monkeypatch):
    _fake_browser(monkeypatch, html="<p>nothing</p>", workbook=None,
                  wb_error="no link found on page")
    with pytest.raises(RuntimeError, match="no rows parsed"):
        margin_debt.fetch_via_browser()


def test_fetch_uses_the_browser_when_every_http_tier_is_blocked(monkeypatch):
    client = _BlockedClient()
    monkeypatch.setattr(margin_debt.httpx, "Client", _client_factory(client))
    _fake_browser(monkeypatch, html=SAMPLE_HTML, wb_error="HTTP 403")

    points = margin_debt.fetch()
    assert len(points) == 5
    assert points.note.startswith("source: headless browser")


def test_missing_playwright_package_is_a_clear_error(monkeypatch):
    import sys
    # A None entry in sys.modules makes `import` raise ImportError.
    monkeypatch.setitem(sys.modules, "playwright", None)
    monkeypatch.setitem(sys.modules, "playwright.async_api", None)

    with pytest.raises(RuntimeError) as excinfo:
        margin_debt.fetch_via_browser()
    msg = str(excinfo.value)
    assert msg.startswith("headless browser not installed — run: ")
    assert "pip install playwright" in msg
    assert "playwright install chromium" in msg


def test_missing_browser_binary_maps_to_the_install_command(monkeypatch):
    monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
    exc = Exception(
        "BrowserType.launch: Executable doesn't exist at C:/pw/chrome.exe\n"
        "╔════╗\n║ Looks like Playwright was just installed ║")
    assert margin_debt.describe_browser_error(exc) == (
        "headless browser not installed — run: "
        r".venv\Scripts\python.exe -m playwright install chromium")

    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", r"C:\ProgramData\SignalDashboard\ms-playwright")
    assert r"PLAYWRIGHT_BROWSERS_PATH=C:\ProgramData\SignalDashboard\ms-playwright" in \
        margin_debt.describe_browser_error(exc)


def test_browser_launch_failure_is_reported_not_raised_raw(monkeypatch):
    def _session(api, timeout_s):
        raise Exception("BrowserType.launch: Executable doesn't exist at C:/nope\n=====")
    monkeypatch.setattr(margin_debt, "_import_playwright", lambda: object())
    monkeypatch.setattr(margin_debt, "_run_browser_session", _session)

    with pytest.raises(RuntimeError, match="headless browser not installed"):
        margin_debt.fetch_via_browser()


def test_describe_browser_error_keeps_the_first_line():
    exc = Exception("Page.goto: net::ERR_NAME_NOT_RESOLVED\nCall log:\n  - navigating")
    assert margin_debt.describe_browser_error(exc) == "Page.goto: net::ERR_NAME_NOT_RESOLVED"


def test_every_tier_failing_aggregates_every_reason(monkeypatch):
    client = _BlockedClient()
    monkeypatch.setattr(margin_debt.httpx, "Client", _client_factory(client))

    def _session(api, timeout_s):
        raise RuntimeError(
            "page never cleared Cloudflare (HTTP 403, title 'Attention Required! | Cloudflare')")
    monkeypatch.setattr(margin_debt, "_import_playwright", lambda: object())
    monkeypatch.setattr(margin_debt, "_run_browser_session", _session)

    with pytest.raises(RuntimeError) as excinfo:
        margin_debt.fetch()
    message = str(excinfo.value)
    assert message.startswith(
        "page: HTTP 403 (Cloudflare challenge); workbook: HTTP 403 (Cloudflare challenge); "
        "browser: page never cleared Cloudflare")


def test_browser_user_agent_drops_the_headless_token():
    ua = margin_debt._browser_user_agent("153.0.8010.12")
    assert "Headless" not in ua
    assert "Chrome/153.0.0.0" in ua


# ---- release cadence: no request while the stored data is current -------------

def test_next_release_is_the_third_week_of_the_month_after_next():
    # September's figure came out in October; October's is due mid-November.
    assert margin_debt.next_release("2026-09") == dt(2026, 11, 15, tzinfo=timezone.utc)
    assert margin_debt.next_release("2026-11") == dt(2027, 1, 15, tzinfo=timezone.utc)
    assert margin_debt.next_release("2026-12") == dt(2027, 2, 15, tzinfo=timezone.utc)


def test_current_data_defers_until_the_next_release_without_calling_out(monkeypatch):
    def _no_network(*a, **kw):
        raise AssertionError("a current source must not reach FINRA")
    monkeypatch.setattr(margin_debt.httpx, "Client", _no_network)

    now = dt(2026, 11, 10, 6, 0, tzinfo=timezone.utc)
    with pytest.raises(SourceDeferred) as excinfo:
        margin_debt.fetch("2026-09", now=now)
    assert excinfo.value.reason == "up to date through 2026-09; the next month is due from 2026-11-15"
    assert excinfo.value.retry_after_seconds == (dt(2026, 11, 15, tzinfo=timezone.utc) - now).total_seconds()


@pytest.mark.parametrize("latest, now", [
    ("2026-09", dt(2026, 11, 15, tzinfo=timezone.utc)),    # the window opened
    ("2026-07", dt(2026, 11, 10, tzinfo=timezone.utc)),    # releases missed
    (None, dt(2026, 11, 10, tzinfo=timezone.utc)),         # nothing stored / forced
])
def test_due_or_forced_runs_go_to_finra(monkeypatch, latest, now):
    client = _BlockedClient(workbook=_xlsx([["Month", "Debit Balances"], [dt(2026, 10, 1), 1_500_000]]))
    monkeypatch.setattr(margin_debt.httpx, "Client", _client_factory(client))

    points = margin_debt.fetch(latest, now=now)
    assert [p.month for p in points] == ["2026-10"]
    assert client.requested


# ---- manual import ------------------------------------------------------------

_BOOK = [["Year-Month", "Debit Balances in Customers' Securities Margin Accounts"],
         ["2026-09", 1_480_054], ["2026-08", 1_453_832]]


def test_import_workbook_notes_what_it_read():
    points = margin_debt.import_workbook(_xlsx(_BOOK))
    assert [p.month for p in points] == ["2026-08", "2026-09"]
    assert points.note == "manual import: 2 months through 2026-09"


@pytest.mark.parametrize("content, reason", [
    (b"not a workbook", "not a readable .xlsx workbook"),
    (_xlsx([["Ticker", "Price"], ["AAPL", 190]]), "no monthly debit balances found"),
])
def test_import_workbook_rejects_with_a_reason(content, reason):
    with pytest.raises(ValueError, match=reason):
        margin_debt.import_workbook(content)


@pytest.fixture
def app_module(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "margin.db"))
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)
    return main_module


@pytest.fixture
def client(app_module):
    with TestClient(app_module.app) as c:
        authenticate(c)  # the first account is the admin
        yield c


def _import(client, content, source="margin_debt"):
    return client.post(f"/api/server/sources/{source}/import", content=content)


def test_import_is_admin_only(client, app_module):
    other = TestClient(app_module.app)
    authenticate(other, email="notadmin@example.com")
    assert _import(other, _xlsx(_BOOK)).status_code == 403
    assert db.get_margin_debt(app_module.conn) == []


def test_import_of_an_unknown_or_non_importable_source_is_404(client):
    assert _import(client, b"x", "bogus").status_code == 404
    assert _import(client, b"x", "vix").status_code == 404


def test_import_over_the_size_cap_is_413_with_or_without_a_length(client, app_module):
    big = b"x" * (app_module._IMPORT_MAX_BYTES + 1)
    assert _import(client, big).status_code == 413

    def chunked():  # no Content-Length: the stream itself is capped
        for _ in range(6):
            yield b"x" * (1024 * 1024)
    resp = _import(client, chunked())
    assert resp.status_code == 413
    assert resp.json()["detail"]["errors"]["file"] == "file is larger than 5 MB"


def test_an_unparsable_import_is_422_with_the_reason(client, app_module):
    resp = _import(client, b"<html>Just a moment...</html>")
    assert resp.status_code == 422
    assert resp.json()["detail"]["errors"]["file"].startswith("not a readable .xlsx workbook")
    assert db.get_margin_debt(app_module.conn) == []


def test_a_good_import_stores_rows_status_and_run_and_pulls_derived(client, app_module, monkeypatch):
    pulled = []
    monkeypatch.setattr(app_module, "_request_derived", lambda: pulled.append(True))

    resp = _import(client, _xlsx(_BOOK))
    assert resp.status_code == 200, resp.text
    status = "ok (manual import: 2 months through 2026-09)"
    assert resp.json() == {"source": "margin_debt", "queued": False, "status": status}

    assert [r["month"] for r in client.get("/api/margin-debt").json()] == ["2026-08", "2026-09"]
    row = next(r for r in client.get("/api/server/sources").json() if r["source"] == "margin_debt")
    assert row["importable"] is True and row["status"] == status and row["record_count"] == 2
    run = client.get("/api/server/sources/margin_debt/runs").json()[0]
    assert (run["outcome"], run["record_count"], run["detail"]) == (
        "ok", 2, "manual import: 2 months through 2026-09")
    assert pulled == [True]
    assert not any(r["importable"] for r in client.get("/api/server/sources").json()
                   if r["source"] != "margin_debt")


def test_scheduled_runs_defer_on_current_data_but_run_now_still_fetches(client, app_module, monkeypatch):
    """The import must stick: the next ordinary run defers instead of failing
    against Cloudflare, while an admin's run-now still asks FINRA."""
    asked = []

    def fake_fetch(latest_month=None):
        asked.append(latest_month)
        if latest_month:
            raise SourceDeferred(f"up to date through {latest_month}", 3600)
        return []
    monkeypatch.setattr(app_module.margin_debt_source, "fetch", fake_fetch)
    assert _import(client, _xlsx(_BOOK)).status_code == 200

    app_module._enqueue("margin_debt", "scheduled-stand-in")
    drain_refresh()
    row = next(r for r in client.get("/api/server/sources").json() if r["source"] == "margin_debt")
    assert row["status"] == "deferred: up to date through 2026-09"
    assert row["record_count"] == 2  # the imported data is untouched

    assert client.post("/api/server/schedules/margin_debt/run-now").status_code == 202
    drain_refresh()
    assert client.post("/api/refresh/margin_debt?force=1").status_code == 202
    drain_refresh()
    assert asked == ["2026-09", None, None]
