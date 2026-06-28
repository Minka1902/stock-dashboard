"""Minimal NYSE trading-day calendar — no external dependency.

Weekends plus a hardcoded set of observed NYSE market holidays. The set covers
the current and next couple of years; extend `_HOLIDAYS` as needed. This is
deliberately simple: we only need "is the next session a trading day" for the
daily suggestion digest, not a full exchange calendar.
"""
from datetime import date, timedelta

# Observed NYSE full-day closures (New Year's, MLK, Presidents', Good Friday,
# Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas).
_HOLIDAYS: set[str] = {
    # 2025
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    # 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    # 2027
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
}


def is_trading_day(d: date) -> bool:
    """True if `d` is a weekday and not a known NYSE holiday."""
    if d.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        return False
    return d.isoformat() not in _HOLIDAYS


def next_trading_day(after: date | None = None) -> date:
    """The next trading day strictly after `after` (default today)."""
    if after is None:
        after = date.today()
    d = after + timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d
