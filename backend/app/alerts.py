"""Alert detection — fires on notable state changes, runs last in the refresh.

Compares the freshly-computed Boom Score / signals against a per-ticker
`alert_state` snapshot from the previous run, so transition events (score
crossing a threshold, a golden cross newly forming, an insider cluster appearing)
fire exactly once. Every alert carries a deterministic dedup_key, so the 3-minute
refresh cadence never produces duplicates. High-severity alerts are pushed via
the existing email/SMS rails.
"""
from datetime import datetime, timezone

from app import config, db, notify
from app.models import Alert
from app.sources.boom_score import _parse_amount_weight

_SEVERITY = {
    "boom_cross": "high",
    "insider_cluster": "high",
    "golden_cross": "medium",
    "earnings_soon": "medium",
    "congress_buy": "medium",
}


def _alert(now: str, ticker: str, type_: str, key: str, title: str, message: str) -> Alert:
    return Alert(
        dedup_key=key, created_at=now, ticker=ticker, type=type_,
        severity=_SEVERITY[type_], title=title, message=message,
    )


def detect(conn) -> list[Alert]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    today = now[:10]
    threshold = config.ALERT_BOOM_THRESHOLD

    boom = {b.ticker: b for b in db.get_boom_scores(conn)}
    watchlist = [w.ticker for w in db.get_watchlist(conn)]
    new_alerts: list[Alert] = []

    for ticker in watchlist:
        bs = boom.get(ticker)
        if bs is None:
            continue
        prev = db.get_alert_state(conn, ticker)
        prev_score = prev["score"] if prev else None
        prev_golden = bool(prev["golden_cross"]) if prev and prev["golden_cross"] is not None else False
        prev_insider = bool(prev["insider_cluster_buy"]) if prev and prev["insider_cluster_buy"] is not None else False

        candidates: list[Alert] = []

        # Boom Score crossed up through the threshold.
        if prev_score is not None and prev_score < threshold <= bs.score:
            candidates.append(_alert(
                now, ticker, "boom_cross", f"boom_cross|{ticker}|{today}",
                f"Boom Score crossed {threshold}",
                f"{ticker} Boom Score is now {bs.score} (was {prev_score}).",
            ))

        # Golden cross newly formed.
        if prev is not None and not prev_golden and bs.golden_cross:
            candidates.append(_alert(
                now, ticker, "golden_cross", f"golden_cross|{ticker}|{today}",
                "Golden cross formed",
                f"{ticker}'s 50-day average crossed above its 200-day average.",
            ))

        # Insider cluster buy newly formed.
        if prev is not None and not prev_insider and bs.insider_cluster_buy:
            candidates.append(_alert(
                now, ticker, "insider_cluster", f"insider_cluster|{ticker}|{today}",
                "Insider cluster buy",
                f"Two or more insiders bought {ticker} on the open market recently.",
            ))

        # Earnings within 7 days (dedup per earnings date, no prev needed).
        if bs.earnings_soon:
            analyst = db.get_analyst_for(conn, ticker)
            ed = analyst.next_earnings if analyst else None
            if ed:
                candidates.append(_alert(
                    now, ticker, "earnings_soon", f"earnings|{ticker}|{ed}",
                    "Earnings within 7 days",
                    f"{ticker} reports earnings on {ed} — elevated event risk.",
                ))

        # Large congressional purchase (> $50k).
        for buy in db.get_congress_buys_for(conn, ticker):
            if _parse_amount_weight(buy["amount_range"]) >= 1.5:
                candidates.append(_alert(
                    now, ticker, "congress_buy",
                    f"congress|{ticker}|{buy['transaction_date']}|{buy['amount_range']}",
                    "Congress bought > $50K",
                    f"A legislator purchased {ticker} ({buy['amount_range']}) on {buy['transaction_date']}.",
                ))

        for c in candidates:
            if not db.alert_exists(conn, c.dedup_key):
                new_alerts.append(c)

        db.upsert_alert_state(conn, ticker, bs.score, bs.golden_cross, bs.insider_cluster_buy, now)

    # Push high-severity new alerts (resilient; no-op without creds).
    for a in new_alerts:
        if a.severity == "high":
            try:
                notify.push_alert(conn, a)
            except Exception:
                pass

    return new_alerts
