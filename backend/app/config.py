"""Central configuration. Override via environment variables."""
import os
from datetime import date, timedelta

# SQLite file location (one file, no server).
DB_PATH = os.environ.get("STOCKS_DB_PATH", "stocks.db")

# How often the scheduler re-runs fast ingestion, in seconds. Default 3 min.
REFRESH_INTERVAL_SECONDS = int(os.environ.get("STOCKS_REFRESH_SECONDS", "180"))

# How many days back to pull contracts on each run.
CONTRACTS_LOOKBACK_DAYS = int(os.environ.get("STOCKS_CONTRACTS_LOOKBACK_DAYS", "30"))

# Max contracts to pull per refresh.
CONTRACTS_LIMIT = int(os.environ.get("STOCKS_CONTRACTS_LIMIT", "50"))

# --- News (GDELT) ---
NEWS_QUERY = os.environ.get(
    "STOCKS_NEWS_QUERY",
    # GDELT requires multi-word phrases to be quoted.
    '("stock market" OR "federal reserve" OR economy OR sanctions OR "defense spending")',
)
NEWS_LIMIT = int(os.environ.get("STOCKS_NEWS_LIMIT", "40"))

# --- Insider trades (SEC EDGAR Form 4) ---
# SEC requires a descriptive User-Agent with contact info for fair-access.
SEC_USER_AGENT = os.environ.get(
    "STOCKS_SEC_USER_AGENT", "Signal Dashboard minka.scharff@gmail.com"
)
# How many recent Form 4 filings to parse per refresh (each costs ~2 requests).
EDGAR_LIMIT = int(os.environ.get("STOCKS_EDGAR_LIMIT", "25"))


# --- Technical signals (Alpha Vantage) ---
# Set to a free AV key to use as primary; falls back to Yahoo Finance if unset.
ALPHA_VANTAGE_KEY: str | None = os.environ.get("STOCKS_ALPHA_VANTAGE_KEY") or None

# --- Congressional trades ---
CONGRESS_LOOKBACK_DAYS = int(os.environ.get("STOCKS_CONGRESS_LOOKBACK_DAYS", "90"))
CONGRESS_MIN_INTERVAL_SECONDS = int(os.environ.get("STOCKS_CONGRESS_MIN_INTERVAL_SECONDS", "21600"))

# --- Yield curve ---
YIELD_CURVE_MONTHS = int(os.environ.get("STOCKS_YIELD_CURVE_MONTHS", "3"))

# --- Seasonality ---
# Yahoo chart range for deep history ("max" so the "all years" lookback is meaningful).
SEASONALITY_RANGE = os.environ.get("STOCKS_SEASONALITY_RANGE", "max")
# Deep history barely changes intraday — refresh at most every 12 hours.
SEASONALITY_MIN_INTERVAL_SECONDS = int(
    os.environ.get("STOCKS_SEASONALITY_MIN_INTERVAL_SECONDS", "43200")
)


def contracts_date_window() -> tuple[str, str]:
    """Return (start_date, end_date) ISO strings for the lookback window."""
    end = date.today()
    start = end - timedelta(days=CONTRACTS_LOOKBACK_DAYS)
    return start.isoformat(), end.isoformat()
