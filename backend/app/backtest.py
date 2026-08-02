"""Backtesting over what the app actually recorded.

Two honest questions, and a hard limit on both.

The limit: suggestion history accrues from the day it shipped and boom-score
history from the day scoring started. Neither is backfilled, because
reconstructing calls we never made would be inventing them. So every result
here ships with a `coverage` block, and horizons that haven't elapsed are
counted as pending rather than quietly dropped — twelve samples over three
weeks must not read like a track record.

Explicitly NOT done: re-running analysis.build() over historical bars to
synthesize what we "would have" said. Today's weights, and today's
fundamentals/analyst/congress snapshots, applied to last year's prices is
look-ahead bias wearing a track record's clothes.
"""
from datetime import date, datetime, timedelta, timezone

from app import db, suggestion_history

# Forward windows for the signal replay, in calendar days.
REPLAY_HORIZONS = (7, 30)
# Threshold curve: the question "is 60 the right alert level?" is only
# answerable by comparing it against its neighbours.
REPLAY_THRESHOLDS = (40, 50, 60, 70)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def _stats(returns: list[float]) -> dict:
    """Summary of a bucket of realised returns. All None when empty — never 0."""
    if not returns:
        return {"n": 0, "hit_rate": None, "median": None, "mean": None,
                "best": None, "worst": None}
    wins = [r for r in returns if r > 0]
    return {
        "n": len(returns),
        "hit_rate": round(len(wins) / len(returns) * 100, 1),
        "median": round(_median(returns), 2),
        "mean": round(sum(returns) / len(returns), 2),
        "best": round(max(returns), 2),
        "worst": round(min(returns), 2),
    }


def _coverage(dates: list[str]) -> dict:
    """How much history this actually rests on. Always present, never implied."""
    if not dates:
        return {"first_date": None, "last_date": None, "days": 0, "distinct_days": 0}
    first, last = min(dates), max(dates)
    try:
        span = (date.fromisoformat(last) - date.fromisoformat(first)).days + 1
    except ValueError:
        span = 0
    return {
        "first_date": first, "last_date": last,
        "days": span, "distinct_days": len(set(dates)),
    }


def track_record(conn, user_id: int, months: int = 12) -> dict:
    """What was suggested, and what happened next — grouped by action and kind.

    Buckets report `n_pending` alongside `n`: an entry whose 7-day window hasn't
    elapsed is not a miss, and folding it into the hit rate either way would be
    wrong.
    """
    entries = db.get_suggestion_history(conn, user_id, months=max(1, months))
    rows = suggestion_history.with_outcomes(conn, entries)

    def bucket(label: str, subset: list[dict]) -> dict:
        out = {"label": label, "n": len(subset)}
        for days in suggestion_history.HORIZONS:
            key = f"d{days}"
            realised = [r["outcomes"][key] for r in subset if r["outcomes"].get(key) is not None]
            out[key] = _stats(realised)
            out[f"{key}_pending"] = len(subset) - len(realised)
        return out

    by_action: dict[str, list[dict]] = {}
    by_kind: dict[str, list[dict]] = {}
    for r in rows:
        by_action.setdefault(r.get("action") or "(none)", []).append(r)
        by_kind.setdefault(r.get("kind") or "(none)", []).append(r)

    return {
        "coverage": _coverage([r["for_date"] for r in rows]),
        "overall": bucket("All suggestions", rows),
        "by_action": [bucket(k, v) for k, v in sorted(by_action.items())],
        "by_kind": [bucket(k, v) for k, v in sorted(by_kind.items())],
        "benchmark": _benchmark(conn, rows),
        # Stated in the payload, not just the UI, so the caveat travels with
        # the numbers wherever they end up.
        "caveat": (
            "History starts when the app began recording; there is no backfill. "
            "Small samples are small — read the coverage block first."
        ),
    }


def _benchmark(conn, rows: list[dict]) -> dict:
    """Same-window SPY return, or an explicit reason it isn't available.

    A track record without a market comparison flatters itself in a rising
    market, so if SPY bars aren't stored the answer is "we can't say", not
    silence.
    """
    if not rows:
        return {"available": False, "reason": "no suggestions in range"}
    bars = db.get_ohlc(conn, "SPY", "daily")
    if not bars:
        return {
            "available": False,
            "reason": "SPY daily bars are not stored — add SPY to a watchlist to enable this",
        }
    closes = {b.date: b.close for b in bars}
    first = min(r["for_date"] for r in rows)
    start = next((closes[d] for d in sorted(closes) if d >= first), None)
    end = bars[-1].close
    if not start:
        return {"available": False, "reason": "no SPY bar on or after the first suggestion"}
    return {
        "available": True,
        "from": first, "to": bars[-1].date,
        "return_pct": round((end / start - 1) * 100, 2),
    }


def signal_replay(
    conn, horizon_days: int = 7, months: int = 12,
    thresholds: tuple[int, ...] = REPLAY_THRESHOLDS,
) -> dict:
    """Every upward boom-score threshold crossing, against what price did next.

    This is the closest thing to a real backtest the stored data supports: the
    scores were computed live, and the forward returns come from stored bars.
    It answers "is the alert threshold set at a useful level?" — which nothing
    else in the app does.
    """
    since = (date.today() - timedelta(days=30 * max(1, months))).isoformat()
    today = date.today().isoformat()
    history = db.get_boom_score_history_all(conn, since)

    # Group by ticker, ordered in time, so a "crossing" is a real transition
    # rather than two unrelated rows.
    by_ticker: dict[str, list[tuple[str, int]]] = {}
    for row in history:
        by_ticker.setdefault(row["ticker"], []).append((row["computed_at"], row["score"]))

    closes_cache: dict[str, dict[str, float]] = {}

    def closes_for(ticker: str) -> dict[str, float]:
        if ticker not in closes_cache:
            closes_cache[ticker] = {b.date: b.close for b in db.get_ohlc(conn, ticker, "daily")}
        return closes_cache[ticker]

    results = []
    all_dates: list[str] = []
    for threshold in thresholds:
        returns: list[float] = []
        pending = 0
        crossings = 0
        seen_days: set[tuple[str, str]] = set()

        for ticker, series in by_ticker.items():
            series.sort(key=lambda x: x[0])
            prev = None
            for stamp, score in series:
                day = stamp[:10]
                if prev is not None and prev < threshold <= score:
                    # One crossing per ticker per day: the score is recomputed
                    # every few minutes and would otherwise count dozens of
                    # times for a single move.
                    if (ticker, day) in seen_days:
                        prev = score
                        continue
                    seen_days.add((ticker, day))
                    crossings += 1
                    all_dates.append(day)

                    entry_close = _close_on_or_after(closes_for(ticker), day)
                    target_day = (date.fromisoformat(day) + timedelta(days=horizon_days)).isoformat()
                    if target_day > today:
                        pending += 1
                    else:
                        exit_close = _close_on_or_after(closes_for(ticker), target_day)
                        if entry_close and exit_close:
                            returns.append((exit_close / entry_close - 1) * 100)
                        else:
                            pending += 1  # no bar to measure against
                prev = score

        stats = _stats(returns)
        stats.update({"threshold": threshold, "crossings": crossings, "pending": pending})
        results.append(stats)

    return {
        "horizon_days": horizon_days,
        "coverage": _coverage(all_dates),
        "thresholds": results,
        "caveat": (
            "Boom-score history only exists from when scoring started, and a "
            "crossing is counted once per ticker per day. Forward returns whose "
            "window hasn't elapsed are reported as pending, not as zero."
        ),
    }


def _close_on_or_after(closes: dict[str, float], target: str) -> float | None:
    """First close on or after a date — markets are shut on plenty of days."""
    for d in sorted(closes):
        if d >= target:
            return closes[d]
    return None
