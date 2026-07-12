"""Minimal NYSE trading-day calendar — no external dependency.

Weekends plus a hardcoded set of observed NYSE market holidays. The set covers
the current and next couple of years; extend `_HOLIDAYS` as needed. This is
deliberately simple: we only need "is the next session a trading day" for the
daily suggestion digest, not a full exchange calendar.
"""
from datetime import date, datetime, timedelta, timezone

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

# Early-close sessions (regular close 13:00 ET instead of 16:00): typically the
# day before Independence Day, the day after Thanksgiving, and Christmas Eve.
_HALF_DAYS: set[str] = {
    "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-11-27", "2026-12-24",
    "2027-11-26", "2027-12-23",
}

# Session boundaries in minutes-from-midnight, US Eastern.
_PRE_OPEN = 4 * 60          # 04:00 pre-market open
_REGULAR_OPEN = 9 * 60 + 30  # 09:30 regular open
_REGULAR_CLOSE = 16 * 60     # 16:00 regular close (13:00 on half days)
_HALF_CLOSE = 13 * 60
_POST_CLOSE = 20 * 60        # 20:00 after-hours close


def is_trading_day(d: date) -> bool:
    """True if `d` is a weekday and not a known NYSE holiday."""
    if d.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        return False
    return d.isoformat() not in _HOLIDAYS


def _is_us_eastern_dst(d: date) -> bool:
    """US DST runs 2nd Sunday of March → 1st Sunday of November.

    Transitions happen at 02:00 local, but the market is always closed then, so
    treating the whole transition day by its post-2am offset is exact for every
    session boundary we care about.
    """
    march = date(d.year, 3, 1)
    second_sunday_march = march + timedelta(days=(6 - march.weekday()) % 7 + 7)
    nov = date(d.year, 11, 1)
    first_sunday_nov = nov + timedelta(days=(6 - nov.weekday()) % 7)
    return second_sunday_march <= d < first_sunday_nov


def _to_eastern(now: datetime) -> datetime:
    """Convert an aware (or assumed-UTC) datetime to US Eastern wall time."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    utc = now.astimezone(timezone.utc)
    offset = -4 if _is_us_eastern_dst(utc.date()) else -5
    return utc.astimezone(timezone(timedelta(hours=offset)))


def market_status(now: datetime | None = None) -> str:
    """Clock-based NYSE session for `now` (default: current UTC time).

    Returns one of PRE | LIVE | POST | CLOSED, matching the per-quote
    `market_state` enum so the frontend can treat either as authoritative.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    et = _to_eastern(now)
    if not is_trading_day(et.date()):
        return "CLOSED"
    minutes = et.hour * 60 + et.minute
    close = _HALF_CLOSE if et.date().isoformat() in _HALF_DAYS else _REGULAR_CLOSE
    if _PRE_OPEN <= minutes < _REGULAR_OPEN:
        return "PRE"
    if _REGULAR_OPEN <= minutes < close:
        return "LIVE"
    if close <= minutes < _POST_CLOSE:
        return "POST"
    return "CLOSED"


def next_trading_day(after: date | None = None) -> date:
    """The next trading day strictly after `after` (default today)."""
    if after is None:
        after = date.today()
    d = after + timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d
