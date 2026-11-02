"""Portfolio performance maths over the daily equity snapshots.

Returns are time-weighted: each day's return strips out the external flows
(deposits, withdrawals, unfunded buys/sells, bot allocations) recorded on the
snapshot, so moving money in or out never looks like gaining or losing it.
"""
from app.models import EquitySnapshot


def current_base_run(snaps: list[EquitySnapshot]) -> list[EquitySnapshot]:
    """The trailing run of snapshots in the latest base currency. Values in two
    currencies can't be chained, so a base switch starts the series afresh."""
    if not snaps:
        return []
    base = snaps[-1].base_currency
    i = len(snaps)
    while i > 0 and snaps[i - 1].base_currency == base:
        i -= 1
    return snaps[i:]


def twr_index(snaps: list[EquitySnapshot]) -> list[tuple[str, float]]:
    """[(date, growth of 1)] through `snaps` (oldest first, one base currency).

    Day t's return is (value_t − flow_t) / value_{t−1} − 1. A previous value of
    zero (an empty account) carries the index forward unchanged."""
    out: list[tuple[str, float]] = []
    level, prev = 1.0, None
    for s in snaps:
        if prev is not None and prev > 0:
            level *= (s.value_base - s.flow_base) / prev
        out.append((s.date, level))
        prev = s.value_base
    return out


def drawdown_from_peak(index: list[tuple[str, float]]) -> dict | None:
    """The latest point's drawdown from the highest point before it:
    {pct (positive = below the peak), peak_date, as_of}. None for an empty or
    single-point series, where there is nothing to fall from."""
    if len(index) < 2:
        return None
    peak_date, peak = max(index, key=lambda p: p[1])
    as_of, last = index[-1]
    pct = (1 - last / peak) * 100 if peak > 0 else 0.0
    return {"pct": round(max(pct, 0.0), 2), "peak_date": peak_date, "as_of": as_of}
