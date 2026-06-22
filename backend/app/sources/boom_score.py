"""Composite Boom Score — pure DB computation, no external API.

Must run AFTER all other sources have stored their data (registered last in SOURCES).
Dict insertion order (Python 3.7+) guarantees this when boom_score is the final entry.
"""
import json
from datetime import datetime, timezone

from app import db
from app.models import BoomScore

WEIGHTS = {
    "golden_cross": 20,
    "insider_cluster_buy": 20,
    "congress_buy": 15,
    "analyst_upgrade": 15,
    "short_squeeze": 10,
    "wsb_rising": 10,
    "rsi_recovery": 10,
}


def _score_ticker(ticker: str, conn, now: str) -> BoomScore:
    components: dict[str, int] = {}

    sig = db.get_technical_signal_for(conn, ticker)
    if sig and sig.golden_cross:
        components["golden_cross"] = WEIGHTS["golden_cross"]
    if sig and sig.rsi14 is not None and 30 <= sig.rsi14 <= 50:
        components["rsi_recovery"] = WEIGHTS["rsi_recovery"]

    if db.count_insider_buys(conn, ticker) >= 2:
        components["insider_cluster_buy"] = WEIGHTS["insider_cluster_buy"]

    if db.has_congress_buy(conn, ticker):
        components["congress_buy"] = WEIGHTS["congress_buy"]

    si = db.get_short_interest_for(conn, ticker)
    if si and si.squeeze_flag:
        components["short_squeeze"] = WEIGHTS["short_squeeze"]

    soc = db.get_social_for(conn, ticker)
    if soc and soc.rank_change is not None and soc.rank_change >= 5:
        components["wsb_rising"] = WEIGHTS["wsb_rising"]

    analyst = db.get_analyst_for(conn, ticker)
    if analyst and analyst.recent_upgrades > 0:
        components["analyst_upgrade"] = WEIGHTS["analyst_upgrade"]

    return BoomScore(
        ticker=ticker,
        computed_at=now,
        score=sum(components.values()),
        components=json.dumps(components),
        golden_cross="golden_cross" in components,
        rsi_recovery="rsi_recovery" in components,
        insider_cluster_buy="insider_cluster_buy" in components,
        congress_buy="congress_buy" in components,
        short_squeeze="short_squeeze" in components,
        wsb_rising="wsb_rising" in components,
        analyst_upgrade="analyst_upgrade" in components,
    )


def compute_all(tickers: list[str], conn) -> list[BoomScore]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return [_score_ticker(t, conn, now) for t in tickers]
