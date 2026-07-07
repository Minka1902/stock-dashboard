"""On-demand technical analysis for ANY ticker, watched/held or not.

Portfolio tickers reuse the stored (scheduled) analysis and OHLC. Everything
else is computed live from Yahoo chart bars, TTL-cached in memory and never
persisted — stock_analysis stays "portfolio only" and no fabricated rows land
in the DB. Results are unsized; callers apply the requesting user's sizing
via analysis.apply_sizing.
"""
import threading
import time

from app import analysis, chart_data, db, quotes
from app.models import OHLCBar, StockAnalysis

_TTL_SECONDS = 600
_MIN_BARS = 30


def bars_to_ohlc(bars: list[dict]) -> list[OHLCBar]:
    """chart_data bar dicts (daily+: time == 'YYYY-MM-DD') -> OHLCBar models."""
    return [
        OHLCBar(date=str(b["time"]), open=b["open"], high=b["high"],
                low=b["low"], close=b["close"], volume=b.get("volume") or 0)
        for b in bars
    ]


# ---- TTL cache: ticker -> (expires_at_monotonic, result dict) ----
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def analyze(conn, ticker: str) -> dict:
    """{analysis: StockAnalysis|None, daily: [OHLCBar], weekly: [OHLCBar], source}.

    Raises httpx errors when a live fetch fails outright (route maps to 502).
    `analysis` is None when there is not enough history to analyze honestly.
    """
    ticker = ticker.strip().upper()

    # Fast path: scheduled pipeline already covers portfolio tickers.
    stored = db.get_analysis(conn, ticker)
    if stored is not None:
        return {
            "analysis": stored,
            "daily": db.get_ohlc(conn, ticker, "daily"),
            "weekly": db.get_ohlc(conn, ticker, "weekly"),
            "source": "stored",
        }

    now = time.monotonic()
    with _lock:
        entry = _cache.get(ticker)
        if entry is not None and entry[0] > now:
            return entry[1]

    daily = bars_to_ohlc(chart_data.get_bars(ticker, "1d")["bars"])
    weekly = bars_to_ohlc(chart_data.get_bars(ticker, "1wk")["bars"])

    built: StockAnalysis | None = None
    if len(daily) >= _MIN_BARS:
        price = None
        try:
            quote = quotes.get_quotes([ticker])
            price = quote[0].price if quote else None
        except Exception:
            price = None  # fall back to last close below
        built = analysis.build(ticker, daily, price or daily[-1].close, None, None)

    result = {"analysis": built, "daily": daily, "weekly": weekly, "source": "live"}
    if daily:  # don't cache empty fetches
        with _lock:
            _cache[ticker] = (time.monotonic() + _TTL_SECONDS, result)
    return result
