from datetime import date

from app.market_calendar import is_trading_day, next_trading_day


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
