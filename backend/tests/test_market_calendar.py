from datetime import date, datetime, timezone

from app.market_calendar import is_trading_day, market_status, next_trading_day


def test_weekend_is_not_a_trading_day():
    assert is_trading_day(date(2026, 1, 3)) is False  # Saturday
    assert is_trading_day(date(2026, 1, 4)) is False  # Sunday


def test_holiday_is_not_a_trading_day():
    assert is_trading_day(date(2026, 1, 1)) is False  # New Year's Day (Thu)
    assert is_trading_day(date(2026, 7, 3)) is False   # Independence Day observed


def test_normal_weekday_is_a_trading_day():
    assert is_trading_day(date(2026, 1, 2)) is True   # Friday
    assert is_trading_day(date(2026, 1, 5)) is True   # Monday


def test_next_trading_day_skips_weekend():
    # Friday Jan 2 -> Monday Jan 5 (Jan 3/4 are the weekend).
    assert next_trading_day(date(2026, 1, 2)) == date(2026, 1, 5)


def test_next_trading_day_skips_holiday():
    # Wed Dec 31 2025 -> Jan 1 2026 is a holiday -> Fri Jan 2.
    assert next_trading_day(date(2025, 12, 31)) == date(2026, 1, 2)


# ---- clock-based session status (market_status) ----
# All inputs are UTC; summer dates are EDT (UTC-4), winter dates EST (UTC-5).

def _utc(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def test_premarket_open_boundary():
    # 2025-07-07 Monday (EDT): 04:00 ET = 08:00 UTC opens pre-market.
    assert market_status(_utc(2025, 7, 7, 8, 0)) == "PRE"
    assert market_status(_utc(2025, 7, 7, 7, 59)) == "CLOSED"


def test_regular_open_boundary():
    # 09:29 ET → PRE, 09:30 ET (13:30 UTC) → LIVE.
    assert market_status(_utc(2025, 7, 7, 13, 29)) == "PRE"
    assert market_status(_utc(2025, 7, 7, 13, 30)) == "LIVE"


def test_regular_close_boundary():
    # 15:59 ET → LIVE, 16:00 ET (20:00 UTC) → POST.
    assert market_status(_utc(2025, 7, 7, 19, 59)) == "LIVE"
    assert market_status(_utc(2025, 7, 7, 20, 0)) == "POST"


def test_post_close_boundary():
    # 19:59 ET → POST, 20:00 ET (00:00 UTC next day) → CLOSED.
    assert market_status(_utc(2025, 7, 7, 23, 59)) == "POST"
    assert market_status(_utc(2025, 7, 8, 0, 0)) == "CLOSED"


def test_regular_open_in_winter_est():
    # 2026-01-05 Monday (EST): 09:30 ET = 14:30 UTC → LIVE.
    assert market_status(_utc(2026, 1, 5, 14, 29)) == "PRE"
    assert market_status(_utc(2026, 1, 5, 14, 30)) == "LIVE"


def test_holiday_is_closed_midday():
    # 2025-07-04 Independence Day, noon ET = 16:00 UTC.
    assert market_status(_utc(2025, 7, 4, 16, 0)) == "CLOSED"


def test_weekend_is_closed_midday():
    # 2025-07-05 Saturday, noon ET = 16:00 UTC.
    assert market_status(_utc(2025, 7, 5, 16, 0)) == "CLOSED"


def test_half_day_early_close():
    # 2025-07-03 half day: 12:59 ET → LIVE, 13:00 ET (17:00 UTC) → POST.
    assert market_status(_utc(2025, 7, 3, 16, 59)) == "LIVE"
    assert market_status(_utc(2025, 7, 3, 17, 0)) == "POST"
