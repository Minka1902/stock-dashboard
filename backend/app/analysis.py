"""Explainable, rule-based technical analysis for a single ticker.

Pure functions only — no network, no DB. Takes OHLCV bars (oldest first) and
returns a StockAnalysis: moving averages, ATR, support/resistance, gaps, chart
patterns, and a directive trade plan (entry/stop/target ladder/size) with the
reasoning enumerated. Everything is a heuristic *signal*, never a prediction;
detected patterns always carry a confidence and the exact pivots they used.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.models import (
    GapEvent, OHLCBar, PatternHit, SRLevel, StockAnalysis, TargetRung,
)
from app.sources.technical import compute_ma, compute_macd, compute_rsi

# --- tunables ---
_ATR_PERIOD = 14
_ATR_STOP_MULT = 2.0
_PIVOT_K = 5            # bars on each side to qualify a swing pivot
_SR_TOL = 0.02         # cluster pivots within 2% into one level
_GAP_MIN_PCT = 0.02    # open vs prior close beyond 2% is a gap
_LEVEL_TOL = 0.02      # "similar price" tolerance for pattern tops/bottoms


# ============================ indicators ============================

def true_ranges(bars: list[OHLCBar]) -> list[float]:
    out: list[float] = []
    for i, b in enumerate(bars):
        if i == 0:
            out.append(b.high - b.low)
        else:
            pc = bars[i - 1].close
            out.append(max(b.high - b.low, abs(b.high - pc), abs(b.low - pc)))
    return out


def atr(bars: list[OHLCBar], period: int = _ATR_PERIOD) -> float | None:
    """Wilder's Average True Range."""
    if len(bars) < period + 1:
        return None
    tr = true_ranges(bars)
    a = sum(tr[1:period + 1]) / period  # seed on first `period` true ranges
    for t in tr[period + 1:]:
        a = (a * (period - 1) + t) / period
    return round(a, 4)


# ============================ swing structure ============================

def swing_pivots(bars: list[OHLCBar], k: int = _PIVOT_K) -> list[dict]:
    """Local swing highs/lows: extreme within +/-k bars. Oldest first.

    Adjacent same-kind pivots (plateaus / ties) are merged into one, keeping the
    most extreme, so a flat top does not register as two peaks.
    """
    raw: list[dict] = []
    n = len(bars)
    for i in range(k, n - k):
        window = bars[i - k:i + k + 1]
        hi = bars[i].high
        lo = bars[i].low
        if hi >= max(b.high for b in window):
            raw.append({"index": i, "date": bars[i].date, "price": round(hi, 4), "kind": "high"})
        if lo <= min(b.low for b in window):
            raw.append({"index": i, "date": bars[i].date, "price": round(lo, 4), "kind": "low"})

    merged: list[dict] = []
    for p in sorted(raw, key=lambda x: x["index"]):
        dup = next((r for r in merged if r["kind"] == p["kind"] and abs(r["index"] - p["index"]) <= k), None)
        if dup is None:
            merged.append(dict(p))
        elif (p["kind"] == "high" and p["price"] > dup["price"]) or \
             (p["kind"] == "low" and p["price"] < dup["price"]):
            dup.update(p)  # keep the more extreme point as the single pivot
    return merged


def support_resistance(pivots: list[dict], price: float, tol: float = _SR_TOL) -> tuple[list[SRLevel], list[SRLevel]]:
    """Cluster swing pivots into horizontal levels, split by current price."""
    clusters: list[dict] = []
    for p in sorted(pivots, key=lambda x: x["price"]):
        placed = False
        for c in clusters:
            if abs(p["price"] - c["avg"]) / c["avg"] <= tol:
                c["prices"].append(p["price"])
                c["touches"] += 1
                c["last"] = max(c["last"], p["date"])
                c["avg"] = sum(c["prices"]) / len(c["prices"])
                placed = True
                break
        if not placed:
            clusters.append({"avg": p["price"], "prices": [p["price"]], "touches": 1, "last": p["date"]})

    support, resistance = [], []
    for c in clusters:
        lvl = SRLevel(price=round(c["avg"], 4), kind="", touches=c["touches"], last_touch=c["last"])
        if c["avg"] < price:
            lvl.kind = "support"
            support.append(lvl)
        else:
            lvl.kind = "resistance"
            resistance.append(lvl)
    # strongest (most-touched) first, then nearest to price
    support.sort(key=lambda l: (-l.touches, price - l.price))
    resistance.sort(key=lambda l: (-l.touches, l.price - price))
    return support, resistance


def nearest_support(support: list[SRLevel], price: float) -> SRLevel | None:
    below = [l for l in support if l.price < price]
    return max(below, key=lambda l: l.price) if below else None


def nearest_resistance(resistance: list[SRLevel], price: float) -> SRLevel | None:
    above = [l for l in resistance if l.price > price]
    return min(above, key=lambda l: l.price) if above else None


def gaps(bars: list[OHLCBar], min_pct: float = _GAP_MIN_PCT) -> list[GapEvent]:
    """Unfilled-aware up/down gaps (open vs prior close beyond min_pct)."""
    out: list[GapEvent] = []
    for i in range(1, len(bars)):
        pc = bars[i - 1].close
        op = bars[i].open
        if pc <= 0:
            continue
        change = (op - pc) / pc
        if abs(change) < min_pct:
            continue
        kind = "up" if change > 0 else "down"
        # filled if any later bar trades back through the prior close
        later = bars[i + 1:]
        if kind == "up":
            filled = any(b.low <= pc for b in later)
        else:
            filled = any(b.high >= pc for b in later)
        out.append(GapEvent(
            date=bars[i].date, from_price=round(pc, 4), to_price=round(op, 4),
            pct=round(change * 100, 2), kind=kind, filled=filled,
        ))
    return out


# ============================ trend / MAs ============================

def moving_averages(closes: list[float]) -> dict[str, float | None]:
    return {
        "ma20": compute_ma(closes, 20),
        "ma50": compute_ma(closes, 50),
        "ma150": compute_ma(closes, 150),
        "ma200": compute_ma(closes, 200),
    }


def ma_alignment(mas: dict[str, float | None]) -> str:
    vals = [mas["ma20"], mas["ma50"], mas["ma150"], mas["ma200"]]
    if any(v is None for v in vals):
        # fall back to whatever is present
        present = [v for v in vals if v is not None]
        if len(present) < 2:
            return "mixed"
        if all(present[i] > present[i + 1] for i in range(len(present) - 1)):
            return "stacked_bull"
        if all(present[i] < present[i + 1] for i in range(len(present) - 1)):
            return "stacked_bear"
        return "mixed"
    if vals[0] > vals[1] > vals[2] > vals[3]:
        return "stacked_bull"
    if vals[0] < vals[1] < vals[2] < vals[3]:
        return "stacked_bear"
    return "mixed"


def trend(closes: list[float], mas: dict[str, float | None]) -> str:
    price = closes[-1]
    ma50, ma200 = mas["ma50"], mas["ma200"]
    slope = None
    if len(closes) >= 70 and ma50 is not None:
        prior = compute_ma(closes[:-20], 50)
        if prior:
            slope = ma50 - prior
    if ma50 and ma200:
        if price > ma50 > ma200 and (slope is None or slope > 0):
            return "up"
        if price < ma50 < ma200 and (slope is None or slope < 0):
            return "down"
    return "sideways"


# ============================ patterns ============================

def _line(points: list[tuple[int, float]]) -> tuple[float, float]:
    """Least-squares slope, intercept for (x, y) points."""
    n = len(points)
    sx = sum(x for x, _ in points)
    sy = sum(y for _, y in points)
    sxx = sum(x * x for x, _ in points)
    sxy = sum(x * y for x, y in points)
    denom = n * sxx - sx * sx
    if denom == 0:
        return 0.0, sy / n
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


def _piv(kind: str, pivots: list[dict]) -> list[dict]:
    return [p for p in pivots if p["kind"] == kind]


def _pivot_ref(p: dict, role: str) -> dict:
    return {"date": p["date"], "price": p["price"], "role": role}


def detect_double_top(pivots: list[dict], price: float) -> PatternHit | None:
    highs = _piv("high", pivots)
    lows = _piv("low", pivots)
    if len(highs) < 2 or not lows:
        return None
    a, b = highs[-2], highs[-1]
    if abs(a["price"] - b["price"]) / a["price"] > _LEVEL_TOL:
        return None
    trough = [lo for lo in lows if a["index"] < lo["index"] < b["index"]]
    if not trough:
        return None
    neck = min(trough, key=lambda x: x["price"])
    if price >= min(a["price"], b["price"]):
        return None  # not yet rolling over
    top = (a["price"] + b["price"]) / 2
    conf = 0.55 + 0.25 * (1 - abs(a["price"] - b["price"]) / a["price"] / _LEVEL_TOL)
    return PatternHit(
        name="double_top", label="Double Top", direction="bearish",
        confidence=round(min(conf, 0.9), 2),
        pivots=[_pivot_ref(a, "peak 1"), _pivot_ref(neck, "neckline"), _pivot_ref(b, "peak 2")],
        measured_move=round(neck["price"] - (top - neck["price"]), 2),
        note="Two failed pushes at the same ceiling.",
    )


def detect_double_bottom(pivots: list[dict], price: float) -> PatternHit | None:
    highs = _piv("high", pivots)
    lows = _piv("low", pivots)
    if len(lows) < 2 or not highs:
        return None
    a, b = lows[-2], lows[-1]
    if abs(a["price"] - b["price"]) / a["price"] > _LEVEL_TOL:
        return None
    peak = [hi for hi in highs if a["index"] < hi["index"] < b["index"]]
    if not peak:
        return None
    neck = max(peak, key=lambda x: x["price"])
    if price <= max(a["price"], b["price"]):
        return None
    bottom = (a["price"] + b["price"]) / 2
    conf = 0.55 + 0.25 * (1 - abs(a["price"] - b["price"]) / a["price"] / _LEVEL_TOL)
    return PatternHit(
        name="double_bottom", label="Double Bottom", direction="bullish",
        confidence=round(min(conf, 0.9), 2),
        pivots=[_pivot_ref(a, "low 1"), _pivot_ref(neck, "neckline"), _pivot_ref(b, "low 2")],
        measured_move=round(neck["price"] + (neck["price"] - bottom), 2),
        note="Two successful defenses of the same floor.",
    )


def detect_head_shoulders(pivots: list[dict], price: float) -> PatternHit | None:
    highs = _piv("high", pivots)
    lows = _piv("low", pivots)
    if len(highs) >= 3 and len(lows) >= 2:
        ls, head, rs = highs[-3], highs[-2], highs[-1]
        if head["price"] > ls["price"] and head["price"] > rs["price"] \
           and abs(ls["price"] - rs["price"]) / ls["price"] <= _LEVEL_TOL * 1.5:
            necks = [lo for lo in lows if ls["index"] < lo["index"] < rs["index"]]
            if necks:
                neck = sum(n["price"] for n in necks) / len(necks)
                return PatternHit(
                    name="head_shoulders", label="Head & Shoulders", direction="bearish",
                    confidence=0.6,
                    pivots=[_pivot_ref(ls, "left shoulder"), _pivot_ref(head, "head"),
                            _pivot_ref(rs, "right shoulder")],
                    measured_move=round(neck - (head["price"] - neck), 2),
                    note="Topping structure; break of neckline confirms.",
                )
    # inverse
    if len(lows) >= 3 and len(highs) >= 2:
        ls, head, rs = lows[-3], lows[-2], lows[-1]
        if head["price"] < ls["price"] and head["price"] < rs["price"] \
           and abs(ls["price"] - rs["price"]) / ls["price"] <= _LEVEL_TOL * 1.5:
            necks = [hi for hi in highs if ls["index"] < hi["index"] < rs["index"]]
            if necks:
                neck = sum(n["price"] for n in necks) / len(necks)
                return PatternHit(
                    name="inverse_head_shoulders", label="Inverse Head & Shoulders",
                    direction="bullish", confidence=0.6,
                    pivots=[_pivot_ref(ls, "left shoulder"), _pivot_ref(head, "head"),
                            _pivot_ref(rs, "right shoulder")],
                    measured_move=round(neck + (neck - head["price"]), 2),
                    note="Bottoming structure; break of neckline confirms.",
                )
    return None


def detect_cup_handle(bars: list[OHLCBar], pivots: list[dict]) -> PatternHit | None:
    """Rounded bottom between two similar rims, then a shallow handle near the right rim."""
    highs = _piv("high", pivots)
    if len(highs) < 2 or len(bars) < 40:
        return None
    left_rim, right_rim = highs[-2], highs[-1]
    if abs(left_rim["price"] - right_rim["price"]) / left_rim["price"] > _LEVEL_TOL * 1.5:
        return None
    lo, hi = left_rim["index"], right_rim["index"]
    if hi - lo < 20:
        return None
    cup = bars[lo:hi + 1]
    cup_low = min(cup, key=lambda b: b.low)
    depth = left_rim["price"] - cup_low.low
    if depth <= 0:
        return None
    # bottom should sit near the middle (rounded, not a V or a spike at an edge)
    low_pos = (cup.index(cup_low)) / len(cup)
    if not 0.3 <= low_pos <= 0.7:
        return None
    # handle: mild pullback after the right rim
    handle = bars[hi:]
    if len(handle) < 3:
        return None
    handle_low = min(b.low for b in handle)
    if not (right_rim["price"] * 0.85 <= handle_low < right_rim["price"]):
        return None
    return PatternHit(
        name="cup_handle", label="Cup & Handle", direction="bullish", confidence=0.62,
        pivots=[_pivot_ref(left_rim, "left rim"),
                {"date": cup_low.date, "price": round(cup_low.low, 4), "role": "cup low"},
                _pivot_ref(right_rim, "right rim")],
        measured_move=round(right_rim["price"] + depth, 2),
        note="Rounded base with a shallow handle; breakout over the rim targets the cup depth.",
    )


def _trendlines(pivots: list[dict]) -> tuple[float, float] | None:
    highs = _piv("high", pivots)[-4:]
    lows = _piv("low", pivots)[-4:]
    if len(highs) < 2 or len(lows) < 2:
        return None
    hs, _ = _line([(p["index"], p["price"]) for p in highs])
    ls, _ = _line([(p["index"], p["price"]) for p in lows])
    return hs, ls


def detect_triangle(pivots: list[dict]) -> PatternHit | None:
    tl = _trendlines(pivots)
    if tl is None:
        return None
    hs, ls = tl
    highs = _piv("high", pivots)[-4:]
    lows = _piv("low", pivots)[-4:]
    avg = (highs[-1]["price"] + lows[-1]["price"]) / 2
    flat = 0.0005 * avg  # near-zero slope threshold, scaled to price
    piv = [_pivot_ref(highs[-1], "upper"), _pivot_ref(lows[-1], "lower")]
    if hs < -flat and ls > flat:
        return PatternHit(name="triangle_sym", label="Symmetrical Triangle", direction="neutral",
                          confidence=0.5, pivots=piv, note="Converging range; trade the breakout.")
    if abs(hs) <= flat and ls > flat:
        return PatternHit(name="triangle_asc", label="Ascending Triangle", direction="bullish",
                          confidence=0.55, pivots=piv, note="Flat highs, rising lows — usually resolves up.")
    if hs < -flat and abs(ls) <= flat:
        return PatternHit(name="triangle_desc", label="Descending Triangle", direction="bearish",
                          confidence=0.55, pivots=piv, note="Falling highs, flat lows — usually resolves down.")
    return None


def detect_channel(pivots: list[dict]) -> PatternHit | None:
    tl = _trendlines(pivots)
    if tl is None:
        return None
    hs, ls = tl
    highs = _piv("high", pivots)[-4:]
    lows = _piv("low", pivots)[-4:]
    avg = (highs[-1]["price"] + lows[-1]["price"]) / 2
    flat = 0.0008 * avg
    # parallel = similar slope, same sign
    if hs * ls <= 0 or abs(hs - ls) > abs(hs) * 0.6 + flat:
        return None
    piv = [_pivot_ref(highs[-1], "upper rail"), _pivot_ref(lows[-1], "lower rail")]
    if hs > flat:
        return PatternHit(name="channel_up", label="Ascending Channel", direction="bullish",
                          confidence=0.5, pivots=piv, note="Higher highs and higher lows in a parallel channel.")
    if hs < -flat:
        return PatternHit(name="channel_down", label="Descending Channel", direction="bearish",
                          confidence=0.5, pivots=piv, note="Lower highs and lower lows in a parallel channel.")
    return PatternHit(name="channel_flat", label="Horizontal Channel", direction="neutral",
                      confidence=0.45, pivots=piv, note="Sideways range between support and resistance.")


def detect_flag(bars: list[OHLCBar]) -> PatternHit | None:
    """Sharp pole then a tight, shallow counter-trend consolidation."""
    if len(bars) < 20:
        return None
    pole = bars[-15:-5]
    flag = bars[-5:]
    if len(pole) < 5 or len(flag) < 3:
        return None
    pole_move = (pole[-1].close - pole[0].close) / pole[0].close
    flag_hi = max(b.high for b in flag)
    flag_lo = min(b.low for b in flag)
    flag_range = (flag_hi - flag_lo) / flag[-1].close
    if abs(pole_move) < 0.08 or flag_range > 0.06:
        return None
    direction = "bullish" if pole_move > 0 else "bearish"
    return PatternHit(
        name="flag", label=("Bull Flag" if pole_move > 0 else "Bear Flag"),
        direction=direction, confidence=0.5,
        pivots=[{"date": pole[0].date, "price": round(pole[0].close, 4), "role": "pole start"},
                {"date": pole[-1].date, "price": round(pole[-1].close, 4), "role": "pole end"}],
        measured_move=round(flag[-1].close + (pole[-1].close - pole[0].close), 2),
        note="Tight pause after a sharp move; usually continues in the pole's direction.",
    )


def detect_patterns(bars: list[OHLCBar], pivots: list[dict], price: float) -> list[PatternHit]:
    hits = [
        detect_head_shoulders(pivots, price),
        detect_double_top(pivots, price),
        detect_double_bottom(pivots, price),
        detect_cup_handle(bars, pivots),
        detect_triangle(pivots),
        detect_channel(pivots),
        detect_flag(bars),
    ]
    found = [h for h in hits if h is not None]
    found.sort(key=lambda h: h.confidence, reverse=True)
    return found


# ============================ trade plan / advice ============================

def compute_stop(entry: float, atr_val: float | None, support: list[SRLevel]) -> tuple[float | None, float | None, float | None, str]:
    """Return (stop, stop_atr, stop_structure, basis). Tighter (closer) of the two."""
    stop_atr = round(entry - _ATR_STOP_MULT * atr_val, 4) if atr_val else None
    sup = nearest_support(support, entry)
    buffer = (atr_val * 0.25) if atr_val else entry * 0.005
    stop_structure = round(sup.price - buffer, 4) if sup else None
    candidates = [(s, b) for s, b in [(stop_atr, "atr"), (stop_structure, "structure")]
                  if s is not None and s < entry]
    if not candidates:
        return None, stop_atr, stop_structure, ""
    stop, basis = max(candidates, key=lambda x: x[0])  # highest stop = tightest risk
    return stop, stop_atr, stop_structure, basis


def target_ladder(entry: float, risk: float, resistance: list[SRLevel], trend_dir: str,
                  measured_move: float | None) -> list[TargetRung]:
    """3R base plus 4/5/6R feasibility from runway to resistance, trend and measured move."""
    res_prices = sorted(l.price for l in resistance if l.price > entry)
    rungs: list[TargetRung] = []
    for r in (3, 4, 5, 6):
        price = round(entry + r * risk, 2)
        if r == 3:
            feas, why = "base", "Standard 3:1 objective."
        else:
            capping = next((rp for rp in res_prices if rp < price), None)
            runway = capping is None
            if runway and (trend_dir == "up" or (measured_move and measured_move >= price)):
                feas = "likely"
                why = "Clear runway above; trend and structure support the extension."
            elif runway:
                feas = "possible"
                why = "Open air to this level, but momentum must keep up."
            else:
                feas = "unlikely"
                why = f"Resistance near {capping} is likely to cap this before {price}."
        rungs.append(TargetRung(r=r, price=price, feasibility=feas, why=why))
    return rungs


def build(ticker: str, daily: list[OHLCBar], price: float | None,
          account_size: float | None, risk_pct: float | None) -> StockAnalysis:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    closes = [b.close for b in daily]
    px = price if price is not None else (closes[-1] if closes else None)

    mas = moving_averages(closes)
    align = ma_alignment(mas)
    tr = trend(closes, mas)
    atr_val = atr(daily)
    pivots = swing_pivots(daily)
    support, resistance = support_resistance(pivots, px) if px else ([], [])
    gap_events = gaps(daily)
    patterns = detect_patterns(daily, pivots, px) if px else []
    rsi = compute_rsi(closes)
    _, _, macd_cross = compute_macd(closes)

    reasons: list[str] = []
    conviction = 0

    # trend / MA structure
    if align == "stacked_bull":
        conviction += 30; reasons.append("Moving averages stacked bullishly (20>50>150>200).")
    elif align == "stacked_bear":
        conviction -= 30; reasons.append("Moving averages stacked bearishly (20<50<150<200).")
    if px and mas["ma200"]:
        if px > mas["ma200"]:
            conviction += 10; reasons.append("Price is above the 200-day average (long-term uptrend).")
        else:
            conviction -= 10; reasons.append("Price is below the 200-day average (long-term downtrend).")
    if tr == "up":
        conviction += 12; reasons.append("Trend is up (price over a rising 50-day, above the 200-day).")
    elif tr == "down":
        conviction -= 12; reasons.append("Trend is down (price under a falling 50-day, below the 200-day).")

    # strongest pattern
    if patterns:
        p = patterns[0]
        w = round(p.confidence * 25)
        if p.direction == "bullish":
            conviction += w; reasons.append(f"{p.label} detected ({int(p.confidence*100)}% confidence) — bullish.")
        elif p.direction == "bearish":
            conviction -= w; reasons.append(f"{p.label} detected ({int(p.confidence*100)}% confidence) — bearish.")
        else:
            reasons.append(f"{p.label} forming ({int(p.confidence*100)}% confidence) — direction pending breakout.")

    # momentum
    if rsi is not None:
        if rsi > 70:
            conviction -= 8; reasons.append(f"RSI {rsi} is overbought (>70) — pullback risk.")
        elif 30 <= rsi <= 50:
            conviction += 8; reasons.append(f"RSI {rsi} is in the oversold-recovery zone (30–50).")
        elif rsi < 30:
            conviction += 4; reasons.append(f"RSI {rsi} is oversold (<30).")
    if macd_cross:
        conviction += 10; reasons.append("MACD crossed up within the last few sessions (momentum turning).")

    # position vs support/gaps
    if px:
        ns = nearest_support(support, px)
        if ns and (px - ns.price) / px < 0.03:
            conviction += 6; reasons.append(f"Sitting on support near {ns.price} ({ns.touches} touches).")
    unfilled_up = [g for g in gap_events if g.kind == "up" and not g.filled]
    if unfilled_up:
        reasons.append(f"{len(unfilled_up)} unfilled up-gap(s) below act as support.")

    conviction = max(-100, min(100, conviction))
    if conviction >= 45:
        directive = "Accumulate"
    elif conviction <= -45:
        directive = "Avoid"
    elif conviction <= -15:
        directive = "Reduce"
    else:
        directive = "Hold"

    # trade plan
    stop = stop_atr = stop_structure = risk_ps = target = reward_ps = rr = None
    basis = ""
    rungs: list[TargetRung] = []
    shares = None
    if px:
        stop, stop_atr, stop_structure, basis = compute_stop(px, atr_val, support)
        if stop is not None:
            risk_ps = round(px - stop, 4)
            if risk_ps > 0:
                mm = patterns[0].measured_move if patterns else None
                rungs = target_ladder(px, risk_ps, resistance, tr, mm)
                target = rungs[0].price
                reward_ps = round(target - px, 4)
                rr = round(reward_ps / risk_ps, 2)
                if account_size and risk_pct and risk_pct > 0:
                    shares = int((account_size * (risk_pct / 100.0)) / risk_ps)
                    reasons.append(
                        f"Sized for {risk_pct}% of ${account_size:,.0f} = "
                        f"${account_size * risk_pct / 100:,.0f} risk -> {shares} shares."
                    )
        if stop is None:
            reasons.append("No stop below price yet (need a nearby support or ATR floor) — plan pending.")

    return StockAnalysis(
        ticker=ticker.upper(), computed_at=now, price=round(px, 4) if px else None,
        ma20=_r(mas["ma20"]), ma50=_r(mas["ma50"]), ma150=_r(mas["ma150"]), ma200=_r(mas["ma200"]),
        ma_alignment=align, trend=tr,
        atr14=atr_val, atr_pct=round(atr_val / px * 100, 2) if atr_val and px else None,
        support=support[:5], resistance=resistance[:5], gaps=gap_events[-6:], patterns=patterns,
        directive=directive, conviction=conviction,
        entry=round(px, 4) if px else None, stop=stop, stop_basis=basis,
        stop_atr=stop_atr, stop_structure=stop_structure, risk_per_share=risk_ps,
        target=target, reward_per_share=reward_ps, rr=rr, targets=rungs,
        suggested_shares=shares, account_size=account_size, risk_pct=risk_pct,
        reasons=reasons,
    )


def apply_sizing(a: StockAnalysis, account_size: float | None,
                 risk_pct: float | None) -> StockAnalysis:
    """Fill per-user position sizing into a globally-computed analysis.

    Analyses are stored unsized (shared across users); the requesting user's
    account size / risk tolerance is applied at read time.
    """
    out = a.model_copy(deep=True)
    out.account_size = account_size
    out.risk_pct = risk_pct
    out.suggested_shares = None
    if (account_size and risk_pct and risk_pct > 0
            and out.risk_per_share and out.risk_per_share > 0):
        out.suggested_shares = int((account_size * (risk_pct / 100.0)) / out.risk_per_share)
    return out


def _r(v: float | None) -> float | None:
    return round(v, 4) if v is not None else None
