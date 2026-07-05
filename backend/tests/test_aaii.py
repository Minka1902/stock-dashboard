from app.sources import aaii

FETCHED_AT = "2026-07-02T10:00:00+00:00"

SAMPLE_HTML = """
<html><body>
<h1>AAII Investor Sentiment Survey</h1>
<p>Week Ending 6/24/2026</p>
<table>
  <tr><td>Bullish</td><td>21.3%</td></tr>
  <tr><td>Neutral</td><td>27.5%</td></tr>
  <tr><td>Bearish</td><td>51.2%</td></tr>
</table>
</body></html>
"""


def test_parse_extracts_percentages():
    records = aaii.parse_response(SAMPLE_HTML, FETCHED_AT)
    assert len(records) == 1
    r = records[0]
    assert r.bullish == 21.3
    assert r.neutral == 27.5
    assert r.bearish == 51.2
    assert r.fetched_at == FETCHED_AT


def test_parse_extracts_week_ending_us_format():
    records = aaii.parse_response(SAMPLE_HTML, FETCHED_AT)
    assert records[0].week_ending == "2026-06-24"


def test_parse_long_date_fallback():
    html = SAMPLE_HTML.replace("Week Ending 6/24/2026", "Results for June 24, 2026")
    records = aaii.parse_response(html, FETCHED_AT)
    assert records[0].week_ending == "2026-06-24"


def test_parse_missing_date_falls_back_to_fetched_at():
    html = SAMPLE_HTML.replace("Week Ending 6/24/2026", "")
    records = aaii.parse_response(html, FETCHED_AT)
    assert records[0].week_ending == "2026-07-02"


def test_parse_returns_empty_on_missing_label():
    html = SAMPLE_HTML.replace("Bearish", "Something")
    assert aaii.parse_response(html, FETCHED_AT) == []


def test_parse_returns_empty_when_percentages_do_not_sum():
    html = SAMPLE_HTML.replace("51.2%", "5.2%")  # sum ≈ 54 → reject
    assert aaii.parse_response(html, FETCHED_AT) == []


def test_parse_returns_empty_on_out_of_range_pct():
    html = SAMPLE_HTML.replace("51.2%", "151.2%")
    assert aaii.parse_response(html, FETCHED_AT) == []


def test_parse_returns_empty_on_blank_page():
    assert aaii.parse_response("<html></html>", FETCHED_AT) == []
