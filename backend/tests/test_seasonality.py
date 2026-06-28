import json
from datetime import date, timedelta

from app.sources.seasonality import (
    compute_seasonality,
    parse_response,
    _forward_return,
    _calendar_window_return,
)


def _daily_series(start: date, days: int, start_price: float = 100.0, step: float = 0.1):
    """A continuous daily (date, close) series — weekends included for simplicity."""
    series = []
    price = start_price
    for i in range(days):
        series.append((start + timedelta(days=i), round(price, 4)))
        price += step
    return series


def test_forward_return_uses_nearest_trading_day():
    # Rising 1/day from 2020-01-01.
    series = _daily_series(date(2020, 1, 1), 400, start_price=100.0, step=1.0)
    # Next-week (7 cal days) return anchored at Jan 10, 2020.
    r = _forward_return(series, 2020, (1, 10), 7)
    assert r is not None
    # close at day index 9 = 109, +7 days = 116 → 116/109 - 1 (rounded to 4 dp).
    assert r == round(116 / 109 - 1, 4)


def test_forward_return_none_before_ticker_existed():
    series = _daily_series(date(2022, 1, 1), 100)
    # Anchor in 2019 — no data that year.
    assert _forward_return(series, 2019, (3, 15), 7) is None


def test_calendar_month_return():
    series = _daily_series(date(2021, 1, 1), 365, start_price=100.0, step=1.0)
    anchor = date(2026, 3, 15)  # March
    r = _calendar_window_return(series, 2021, "month", anchor)
    assert r is not None
    # March 2021 spans index 59 (Mar 1) .. index 89 (Mar 31): prices 159..189.
    assert r > 0  # rising series → positive month


def test_compute_seasonality_builds_all_windows():
    series = _daily_series(date(2018, 1, 1), 365 * 6, start_price=100.0, step=0.05)
    today = date(2026, 6, 15)
    windows = compute_seasonality(series, today)
    keys = {w["key"] for w in windows}
    assert keys == {"fwd_day", "fwd_week", "fwd_month", "cal_week", "cal_month"}
    # Multiple prior years should be present for the monthly window.
    cal_month = next(w for w in windows if w["key"] == "cal_month")
    assert len(cal_month["per_year"]) >= 3
    assert all("year" in e and "return" in e for e in cal_month["per_year"])


def test_compute_seasonality_excludes_current_year():
    series = _daily_series(date(2018, 1, 1), 365 * 9, start_price=100.0, step=0.05)
    today = date(2026, 6, 15)
    windows = compute_seasonality(series, today)
    years = {e["year"] for w in windows for e in w["per_year"]}
    assert 2026 not in years
    assert max(years) <= 2025


def test_parse_response_from_yahoo_timestamps():
    series = _daily_series(date(2019, 1, 1), 365 * 6, start_price=50.0, step=0.05)
    # Build a Yahoo-shaped payload with unix timestamps.
    import calendar
    timestamps = [calendar.timegm(d.timetuple()) for d, _ in series]
    closes = [c for _, c in series]
    payload = {
        "chart": {"result": [{
            "timestamp": timestamps,
            "indicators": {"quote": [{"close": closes}]},
        }]}
    }
    season = parse_response(payload, "test", "2026-06-15T00:00:00+00:00", today=date(2026, 6, 15))
    assert season is not None
    assert season.ticker == "TEST"
    assert season.as_of == "06-15"
    windows = json.loads(season.windows_json)
    assert len(windows) == 5
    assert season.history_years >= 3


def test_parse_response_none_on_empty():
    payload = {"chart": {"result": []}}
    assert parse_response(payload, "x", "2026-06-15T00:00:00+00:00") is None


def test_parse_response_none_on_insufficient_history():
    # Only one prior year of data → no window reaches 2 years.
    series = _daily_series(date(2025, 1, 1), 200, start_price=100.0, step=0.1)
    import calendar
    timestamps = [calendar.timegm(d.timetuple()) for d, _ in series]
    closes = [c for _, c in series]
    payload = {
        "chart": {"result": [{
            "timestamp": timestamps,
            "indicators": {"quote": [{"close": closes}]},
        }]}
    }
    season = parse_response(payload, "x", "2026-06-15T00:00:00+00:00", today=date(2026, 6, 15))
    assert season is None
