"""Build a tailored daily trading-suggestion digest from existing signals.

Pure and network-free: everything is read from the DB, so this is fully
unit-testable by seeding an in-memory connection. The same digest powers the
in-app Suggestions panel (`GET /api/suggestions`) and the email/SMS delivery.

Nothing here is financial advice; every rendering carries that disclaimer.
"""
import json
from datetime import date, datetime, timezone

from app import config, db
from app.market_calendar import next_trading_day

DISCLAIMER = "Signals, not financial advice. Do your own research."

# BoomScore boolean flags → short human labels.
_BEARISH_LABELS = {
    "death_cross": "death cross",
    "insider_cluster_sell": "insider selling",
    "congress_sale": "congress selling",
    "overbought_rsi": "overbought RSI",
    "analyst_downgrade_cluster": "analyst downgrades",
    "extreme_greed": "market euphoria",
}
_BULLISH_LABELS = {
    "golden_cross": "golden cross",
    "near_52w_high": "near 52w high",
    "macd_crossover": "MACD crossover",
    "volume_confirmed": "volume breakout",
    "insider_cluster_buy": "insider buying",
    "congress_buy": "congress buying",
    "analyst_upgrade": "analyst upgrade",
    "short_squeeze": "squeeze setup",
    "wsb_rising": "WSB momentum",
    "rsi_recovery": "RSI recovery",
    "fear_greed_contrarian": "fear contrarian",
    "yield_uninversion": "curve normalizing",
    "contracts_catalyst": "gov contract",
}

# Primary forward window used for the seasonality tailwind check.
_PRIMARY_WINDOW = "fwd_week"
_SEASONALITY_LOOKBACK = 10


def _fg_rating(score: float | None) -> str | None:
    if score is None:
        return None
    if score < 25:
        return "Extreme Fear"
    if score < 45:
        return "Fear"
    if score < 55:
        return "Neutral"
    if score < 75:
        return "Greed"
    return "Extreme Greed"


def _fired(boom, labels: dict) -> list[str]:
    """Human labels for the flags set True on a BoomScore."""
    return [label for key, label in labels.items() if getattr(boom, key, False)]


def _days_until(iso_date: str | None, ref: date) -> int | None:
    if not iso_date:
        return None
    try:
        d = date.fromisoformat(iso_date[:10])
    except ValueError:
        return None
    return (d - ref).days


def _summarize_window(per_year: list[dict], lookback: int = _SEASONALITY_LOOKBACK):
    """avg return + win-rate over the last `lookback` years (mirrors the UI)."""
    if not per_year:
        return None
    sliced = per_year[-lookback:]
    returns = [e["return"] for e in sliced]
    n = len(returns)
    if n == 0:
        return None
    avg = sum(returns) / n
    ups = sum(1 for r in returns if r > 0)
    return {"avg": avg, "win_rate": ups / n, "n": n}


def _seasonality_signal(season, primary=_PRIMARY_WINDOW):
    """Return (avg, win_rate, n, label) for the primary window, or None."""
    if season is None:
        return None
    try:
        windows = json.loads(season.windows_json)
    except (json.JSONDecodeError, TypeError):
        return None
    win = next((w for w in windows if w.get("key") == primary), None)
    if not win:
        return None
    stats = _summarize_window(win.get("per_year", []))
    if not stats:
        return None
    return stats["avg"], stats["win_rate"], stats["n"], win.get("label", primary)


def build_digest(conn, for_date: str | None = None, user_id: int = 0) -> dict:
    """Digest scoped to one user's holdings + watchlist (market data is shared)."""
    if for_date is None:
        for_date = next_trading_day().isoformat()
    ref = date.fromisoformat(for_date)

    boom = {b.ticker: b for b in db.get_boom_scores(conn)}
    tech = {t.ticker: t for t in db.get_technical_signals(conn)}
    analyst = {a.ticker: a for a in db.get_analyst_signals(conn)}
    portfolio = db.get_portfolio(conn, user_id)
    held = {h.ticker for h in portfolio}
    watchlist = [w.ticker for w in db.get_watchlist(conn, user_id)]

    fg_score = db.get_latest_fear_greed_score(conn)
    uninversion = db.has_yield_uninversion(conn)
    hot_count = sum(1 for t in watchlist if t in boom and boom[t].score >= 50)

    rating = _fg_rating(fg_score)
    ctx_bits = []
    if rating is not None:
        ctx_bits.append(f"{rating} ({fg_score:.0f})")
    if uninversion:
        ctx_bits.append("yield curve normalizing")
    ctx_bits.append(f"{hot_count} watchlist name{'s' if hot_count != 1 else ''} hot (Boom ≥ 50)")
    market_context = {
        "fear_greed_score": fg_score,
        "fear_greed_rating": rating,
        "yield_uninversion": uninversion,
        "hot_count": hot_count,
        "summary": "Market: " + " · ".join(ctx_bits) + ".",
    }

    # --- Holdings alerts ---
    holdings_alerts = []
    for h in portfolio:
        b = boom.get(h.ticker)
        t = tech.get(h.ticker)
        price = t.price if t and t.price is not None else None
        pl_pct = round((price - h.avg_cost) / h.avg_cost * 100, 1) if (price and h.avg_cost) else None

        reasons: list[str] = []
        bearish: list[str] = []
        bullish: list[str] = []
        if b:
            bearish = _fired(b, _BEARISH_LABELS)
            bullish = _fired(b, _BULLISH_LABELS)
            reasons += bearish
        a = analyst.get(h.ticker)
        edays = _days_until(a.next_earnings, ref) if a else None
        earnings_soon = edays is not None and 0 <= edays <= 7
        if earnings_soon:
            reasons.append(f"earnings in {edays}d")
        mixed = bool(b and b.mixed_signals)

        if earnings_soon:
            action = "Earnings risk — consider hedging or trimming size"
        elif bearish and (pl_pct is not None and pl_pct > 0):
            action = "Trim — lock gains into weakening signals"
        elif bearish:
            action = "Watch — review your stop"
        elif mixed:
            action = "Hold & watch — signals are mixed"
        elif bullish:
            reasons += bullish
            action = "Trend intact — hold / add on dips"
        else:
            action = "Hold"

        holdings_alerts.append({
            "ticker": h.ticker,
            "action": action,
            "reasons": reasons,
            "pl_pct": pl_pct,
            "score": b.score if b else None,
            "shares": h.shares,
            "avg_cost": h.avg_cost,
            "price": price,
        })
    # Surface the most actionable holdings first (risk before hold).
    holdings_alerts.sort(key=lambda x: (x["score"] if x["score"] is not None else 0))

    # --- New opportunities (watchlist, not held) ---
    opportunities = []
    candidates = sorted(
        (boom[t] for t in watchlist if t in boom and t not in held),
        key=lambda b: b.score, reverse=True,
    )
    for b in candidates[: config.SUGGESTIONS_COUNT]:
        if b.score <= 0:
            continue
        opportunities.append({
            "ticker": b.ticker,
            "score": b.score,
            "signals": _fired(b, _BULLISH_LABELS),
        })

    # --- Seasonality tailwinds / headwinds ---
    seasonality = []
    universe = list(held) + [t for t in watchlist if t not in held]
    for t in universe:
        season = db.get_seasonality_for(conn, t)
        sig = _seasonality_signal(season)
        if not sig:
            continue
        avg, win_rate, n, label = sig
        is_held = t in held
        tailwind = avg >= 0.02 and win_rate >= 0.6
        headwind = avg <= -0.02 and win_rate <= 0.4
        if tailwind or (headwind and is_held):
            seasonality.append({
                "ticker": t,
                "window_label": label,
                "avg_pct": round(avg * 100, 1),
                "win_rate": round(win_rate, 2),
                "n": n,
                "kind": "tailwind" if tailwind else "headwind",
                "held": is_held,
            })
    seasonality.sort(key=lambda x: x["avg_pct"], reverse=True)
    seasonality = seasonality[: config.SUGGESTIONS_COUNT]

    return {
        "for_date": for_date,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "disclaimer": DISCLAIMER,
        "market_context": market_context,
        "holdings_alerts": holdings_alerts,
        "opportunities": opportunities,
        "seasonality": seasonality,
    }


# ---------- renderers ----------

def _alert_line(a: dict) -> str:
    parts = [a["ticker"]]
    if a["pl_pct"] is not None:
        parts.append(f"({a['pl_pct']:+.1f}%)")
    parts.append(f"→ {a['action']}")
    if a["reasons"]:
        parts.append(f"[{', '.join(a['reasons'])}]")
    return " ".join(parts)


def render_email(digest: dict) -> tuple[str, str, str]:
    """Returns (subject, text, html)."""
    d = digest
    subject = f"Trading suggestions for {d['for_date']}"

    lines = [d["market_context"]["summary"], ""]
    if d["holdings_alerts"]:
        lines.append("YOUR HOLDINGS")
        lines += [f"  • {_alert_line(a)}" for a in d["holdings_alerts"]]
        lines.append("")
    if d["opportunities"]:
        lines.append("NEW OPPORTUNITIES (watchlist)")
        for o in d["opportunities"]:
            sig = f" — {', '.join(o['signals'])}" if o["signals"] else ""
            lines.append(f"  • {o['ticker']} · Boom {o['score']}{sig}")
        lines.append("")
    if d["seasonality"]:
        lines.append("SEASONAL EDGE (this time of year)")
        for s in d["seasonality"]:
            arrow = "tailwind" if s["kind"] == "tailwind" else "headwind ⚠"
            lines.append(
                f"  • {s['ticker']} {s['window_label']}: avg {s['avg_pct']:+.1f}%, "
                f"win {int(s['win_rate']*100)}% over {s['n']}y ({arrow})"
            )
        lines.append("")
    lines.append(d["disclaimer"])
    text = "\n".join(lines)

    def esc(x):
        return str(x).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    html_parts = [
        f"<h2 style='margin:0 0 4px'>Suggestions for {esc(d['for_date'])}</h2>",
        f"<p style='color:#555'>{esc(d['market_context']['summary'])}</p>",
    ]
    if d["holdings_alerts"]:
        html_parts.append("<h3>Your holdings</h3><ul>")
        html_parts += [f"<li>{esc(_alert_line(a))}</li>" for a in d["holdings_alerts"]]
        html_parts.append("</ul>")
    if d["opportunities"]:
        html_parts.append("<h3>New opportunities</h3><ul>")
        for o in d["opportunities"]:
            sig = f" — {esc(', '.join(o['signals']))}" if o["signals"] else ""
            html_parts.append(f"<li><b>{esc(o['ticker'])}</b> · Boom {o['score']}{sig}</li>")
        html_parts.append("</ul>")
    if d["seasonality"]:
        html_parts.append("<h3>Seasonal edge</h3><ul>")
        for s in d["seasonality"]:
            arrow = "tailwind" if s["kind"] == "tailwind" else "headwind ⚠"
            html_parts.append(
                f"<li>{esc(s['ticker'])} {esc(s['window_label'])}: avg {s['avg_pct']:+.1f}%, "
                f"win {int(s['win_rate']*100)}% / {s['n']}y ({arrow})</li>"
            )
        html_parts.append("</ul>")
    html_parts.append(f"<p style='color:#888;font-size:12px'>{esc(d['disclaimer'])}</p>")
    html = "".join(html_parts)
    return subject, text, html


def render_sms(digest: dict, max_len: int = 320) -> str:
    d = digest
    bits = []
    if d["market_context"]["fear_greed_rating"]:
        bits.append(f"Mkt {d['market_context']['fear_greed_rating']} "
                    f"{d['market_context']['fear_greed_score']:.0f}.")
    if d["holdings_alerts"]:
        a = d["holdings_alerts"][0]
        short = a["action"].split(" —")[0].split(" -")[0]
        bits.append(f"⚠ {a['ticker']}→{short}.")
    if d["opportunities"]:
        o = d["opportunities"][0]
        sig = f" {o['signals'][0]}" if o["signals"] else ""
        bits.append(f"💡 {o['ticker']} Boom {o['score']}{sig}.")
    bits.append("Full digest in app.")
    msg = " ".join(bits)
    return msg if len(msg) <= max_len else msg[: max_len - 1] + "…"
