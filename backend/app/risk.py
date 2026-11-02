"""Account-level risk switches that pause new entries (STC-14).

The drawdown kill switch measures the manual account's time-weighted equity
(analytics.twr_index over equity_snapshots) against its high-water mark. Bots
and paper trade simulated money, so only the real book is measured; bot
allocations are external flows to it and never look like a loss.

A trip holds until the user acknowledges it. Acknowledging resets the high to
the snapshots from that day on, so a drawdown that is still there doesn't trip
again the next evening. While tripped, new-buy suggestions and new bot entries
are paused; sells, exits and stops carry on. Nothing is ever sold for you.
"""
from datetime import datetime, timezone

from app import analytics, db
from app.models import Alert, RiskSettings

MAX_DRAWDOWN_RANGE = (1.0, 90.0)
_ACCOUNT = "manual"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def is_tripped(s: RiskSettings) -> bool:
    return s.drawdown_tripped_at is not None and (
        s.drawdown_acknowledged_at is None or s.drawdown_acknowledged_at < s.drawdown_tripped_at)


def current_drawdown(conn, user_id: int, since: str | None = None) -> dict | None:
    """The manual account's drawdown now, from the high since `since` (a date)."""
    snaps = analytics.current_base_run(db.get_equity_snapshots(conn, user_id, _ACCOUNT, since))
    out = analytics.drawdown_from_peak(analytics.twr_index(snaps))
    if out is not None:
        out["base_currency"] = snaps[-1].base_currency
    return out


def _since(s: RiskSettings) -> str | None:
    return s.drawdown_acknowledged_at[:10] if s.drawdown_acknowledged_at else None


def check_user(conn, user_id: int, now: str | None = None) -> Alert | None:
    """Trip the user's kill switch if the drawdown has reached the limit.
    Returns the stored alert on a fresh trip, else None."""
    s = db.get_risk_settings(conn, user_id)
    if s.max_drawdown_pct is None or is_tripped(s):
        return None
    dd = current_drawdown(conn, user_id, _since(s))
    if dd is None or dd["pct"] < s.max_drawdown_pct:
        return None
    at = now or _now()
    db.upsert_risk_settings(conn, s.model_copy(update={
        "drawdown_tripped_at": at, "drawdown_pct": dd["pct"], "updated_at": at}))
    alert = Alert(
        dedup_key=f"risk||{user_id}|drawdown|{at}", created_at=at, ticker="", type="risk",
        severity="high", title="Drawdown kill switch tripped",
        message=(f"Your portfolio is {dd['pct']:.1f}% below its high of {dd['peak_date']} "
                 f"(your limit is {s.max_drawdown_pct:g}%). New-buy suggestions and new bot "
                 f"entries are paused until you acknowledge it on the Trading Bot page. "
                 f"Nothing is sold automatically."),
        user_id=user_id)
    db.upsert_alerts(conn, [alert])
    return alert


def check_drawdowns(conn, now: str | None = None) -> list[Alert]:
    """Run check_user for everyone with a limit set (after each equity snapshot)."""
    return [a for s in db.get_all_risk_settings(conn) if s.max_drawdown_pct is not None
            for a in [check_user(conn, s.user_id, now)] if a is not None]


def acknowledge(conn, user_id: int, now: str | None = None) -> bool:
    """Re-enable entries after a trip. False when nothing is tripped."""
    s = db.get_risk_settings(conn, user_id)
    if not is_tripped(s):
        return False
    at = now or _now()
    db.upsert_risk_settings(conn, s.model_copy(update={"drawdown_acknowledged_at": at, "updated_at": at}))
    return True


def set_max_drawdown(conn, user_id: int, pct: float | None) -> RiskSettings:
    s = db.get_risk_settings(conn, user_id)
    return db.upsert_risk_settings(conn, s.model_copy(update={"max_drawdown_pct": pct, "updated_at": _now()}))


def halt_reasons(conn, user_id: int) -> list[str]:
    """Why new entries are paused for this user right now (empty = they aren't)."""
    s = db.get_risk_settings(conn, user_id)
    if is_tripped(s):
        return [f"Drawdown kill switch: {s.drawdown_pct:.1f}% below the high "
                f"(limit {s.max_drawdown_pct:g}%)"]
    return []


def status(conn, user_id: int) -> dict:
    """Everything the Risk tab and the banner show."""
    s = db.get_risk_settings(conn, user_id)
    reasons = halt_reasons(conn, user_id)
    return {
        "halted": bool(reasons),
        "reasons": reasons,
        "drawdown": {
            "max_pct": s.max_drawdown_pct,
            "tripped": is_tripped(s),
            "tripped_at": s.drawdown_tripped_at,
            "tripped_pct": s.drawdown_pct,
            "acknowledged_at": s.drawdown_acknowledged_at,
            "current": current_drawdown(conn, user_id, _since(s)),
            "range": MAX_DRAWDOWN_RANGE,
        },
    }
