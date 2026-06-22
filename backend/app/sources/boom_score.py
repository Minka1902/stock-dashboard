"""Composite Boom Score — pure DB computation, no external API.

Must run AFTER all other sources have stored their data (registered last in SOURCES).
Dict insertion order (Python 3.7+) guarantees this when boom_score is the final entry.

Score range: −90 … +100 (negative scores mean net bearish evidence).
"""
import json
from datetime import datetime, timezone

from app import db
from app.models import BoomScore

WEIGHTS: dict[str, int] = {
    # Bullish
    "golden_cross":           20,
    "insider_cluster_buy":    20,
    "congress_buy":           15,
    "analyst_upgrade":        15,
    "near_52w_high":          10,
    "macd_crossover":         10,
    "volume_confirmed":       10,
    "short_squeeze":          10,
    "wsb_rising":             10,
    "rsi_recovery":           10,
    "fear_greed_contrarian":  10,
    "yield_uninversion":      15,
    "contracts_catalyst":     10,
    # Bearish (negative values)
    "death_cross":                -20,
    "insider_cluster_sell":       -20,
    "overbought_rsi":             -10,
    "congress_sale":              -15,
    "analyst_downgrade_cluster":  -15,
    "extreme_greed":              -10,
}

# Weight multipliers for congressional trade amount ranges.
_AMOUNT_WEIGHTS: dict[str, float] = {
    "< $15,000":               0.5,
    "$1,001 - $15,000":        0.5,
    "$15,001 - $50,000":       1.0,
    "$50,001 - $100,000":      1.5,
    "$100,001 - $250,000":     1.5,
    "$250,001 - $500,000":     2.0,
    "> $500,000":               2.0,
    "$500,001 - $1,000,000":   2.0,
    "$1,000,001 - $5,000,000": 2.0,
}


def _decay(date_str: str, window_days: int = 30) -> float:
    """1.0 for today → 0.0 at window_days ago."""
    try:
        then = datetime.fromisoformat(date_str).date()
        days_ago = (datetime.now(timezone.utc).date() - then).days
        return max(0.0, 1.0 - days_ago / window_days)
    except Exception:
        return 1.0


def _parse_amount_weight(amount_range: str) -> float:
    return _AMOUNT_WEIGHTS.get(amount_range.strip(), 1.0)


def _is_earnings_soon(next_earnings: str | None, days: int = 7) -> bool:
    if not next_earnings:
        return False
    try:
        then = datetime.fromisoformat(next_earnings).date()
        days_until = (then - datetime.now(timezone.utc).date()).days
        return 0 <= days_until <= days
    except Exception:
        return False


def _score_ticker(
    ticker: str,
    conn,
    now: str,
    fg_score: float | None,
    has_uninversion: bool,
) -> BoomScore:
    components: dict[str, int] = {}

    # --- Technical signals ---
    sig = db.get_technical_signal_for(conn, ticker)
    if sig:
        if sig.golden_cross is True:
            components["golden_cross"] = WEIGHTS["golden_cross"]
        elif sig.golden_cross is False:
            components["death_cross"] = WEIGHTS["death_cross"]

        if sig.rsi14 is not None:
            if 30 <= sig.rsi14 <= 50:
                components["rsi_recovery"] = WEIGHTS["rsi_recovery"]
            elif sig.rsi14 > 70:
                components["overbought_rsi"] = WEIGHTS["overbought_rsi"]

        if sig.macd_crossover:
            components["macd_crossover"] = WEIGHTS["macd_crossover"]

        if (
            sig.rel_volume is not None
            and sig.rel_volume > 1.5
            and sig.change_pct is not None
            and sig.change_pct > 0
        ):
            components["volume_confirmed"] = WEIGHTS["volume_confirmed"]

        if sig.price is not None and sig.high_52w is not None and sig.high_52w > 0:
            if sig.price >= sig.high_52w * 0.97:
                components["near_52w_high"] = WEIGHTS["near_52w_high"]

    # --- Insider trades ---
    buy_count = db.count_insider_buys(conn, ticker)
    sell_count = db.count_insider_sells(conn, ticker)
    if buy_count >= 2:
        components["insider_cluster_buy"] = WEIGHTS["insider_cluster_buy"]
    if sell_count >= 2:
        components["insider_cluster_sell"] = WEIGHTS["insider_cluster_sell"]

    # --- Congress (weighted by amount + time decay) ---
    congress_buys = db.get_congress_buys_for(conn, ticker)
    if congress_buys:
        best = max(
            _parse_amount_weight(b["amount_range"]) * _decay(b["transaction_date"])
            for b in congress_buys
        )
        if best > 0:
            components["congress_buy"] = round(WEIGHTS["congress_buy"] * best)
    if db.has_congress_sale(conn, ticker):
        components["congress_sale"] = WEIGHTS["congress_sale"]

    # --- Short interest ---
    si = db.get_short_interest_for(conn, ticker)
    if si and si.squeeze_flag:
        components["short_squeeze"] = WEIGHTS["short_squeeze"]

    # --- Social sentiment ---
    soc = db.get_social_for(conn, ticker)
    if soc and soc.rank_change is not None and soc.rank_change >= 5:
        components["wsb_rising"] = WEIGHTS["wsb_rising"]

    # --- Analyst ---
    analyst = db.get_analyst_for(conn, ticker)
    earnings_soon = False
    if analyst:
        if analyst.recent_upgrades > 0:
            components["analyst_upgrade"] = WEIGHTS["analyst_upgrade"]
        if analyst.recent_downgrades >= 2:
            components["analyst_downgrade_cluster"] = WEIGHTS["analyst_downgrade_cluster"]
        earnings_soon = _is_earnings_soon(analyst.next_earnings)

    # --- Macro: Fear & Greed (market-wide, applied once per compute_all call) ---
    if fg_score is not None:
        if fg_score < 25:
            components["fear_greed_contrarian"] = WEIGHTS["fear_greed_contrarian"]
        elif fg_score > 78:
            components["extreme_greed"] = WEIGHTS["extreme_greed"]

    # --- Macro: Yield curve un-inversion ---
    if has_uninversion:
        components["yield_uninversion"] = WEIGHTS["yield_uninversion"]

    # --- Federal contracts catalyst ---
    if db.has_major_contract_for(conn, ticker):
        components["contracts_catalyst"] = WEIGHTS["contracts_catalyst"]

    # --- Mixed signal detection ---
    bullish_keys = {k for k, v in components.items() if v > 0}
    bearish_keys = {k for k, v in components.items() if v < 0}
    mixed_signals = bool(bullish_keys and bearish_keys)

    score = sum(components.values())

    return BoomScore(
        ticker=ticker,
        computed_at=now,
        score=score,
        components=json.dumps(components),
        # bullish
        golden_cross="golden_cross" in components,
        rsi_recovery="rsi_recovery" in components,
        insider_cluster_buy="insider_cluster_buy" in components,
        congress_buy="congress_buy" in components,
        short_squeeze="short_squeeze" in components,
        wsb_rising="wsb_rising" in components,
        analyst_upgrade="analyst_upgrade" in components,
        near_52w_high="near_52w_high" in components,
        macd_crossover="macd_crossover" in components,
        volume_confirmed="volume_confirmed" in components,
        fear_greed_contrarian="fear_greed_contrarian" in components,
        yield_uninversion="yield_uninversion" in components,
        contracts_catalyst="contracts_catalyst" in components,
        # bearish
        death_cross="death_cross" in components,
        insider_cluster_sell="insider_cluster_sell" in components,
        overbought_rsi="overbought_rsi" in components,
        congress_sale="congress_sale" in components,
        analyst_downgrade_cluster="analyst_downgrade_cluster" in components,
        extreme_greed="extreme_greed" in components,
        # flags
        earnings_soon=earnings_soon,
        mixed_signals=mixed_signals,
    )


def compute_all(tickers: list[str], conn) -> list[BoomScore]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    fg_score = db.get_latest_fear_greed_score(conn)
    has_uninversion = db.has_yield_uninversion(conn)
    scores = [_score_ticker(t, conn, now, fg_score, has_uninversion) for t in tickers]
    db.insert_boom_score_history(conn, scores)
    return scores
