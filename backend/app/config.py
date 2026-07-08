"""Central configuration. Override via environment variables."""
import os
from datetime import date, timedelta

# SQLite file location (one file, no server).
DB_PATH = os.environ.get("STOCKS_DB_PATH", "stocks.db")

# Log level for the app-wide logging config (see app/logging_config.py).
LOG_LEVEL = os.environ.get("STOCKS_LOG_LEVEL", "INFO")

# --- Web security ---
# Comma-separated list of allowed browser origins. Because the session cookie
# rides on allow_credentials=True, a wildcard here would be a security hole —
# reject it outright rather than silently weaken auth.
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("STOCKS_CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]
if "*" in CORS_ORIGINS:
    raise ValueError(
        "STOCKS_CORS_ORIGINS must list explicit origins; '*' is not allowed "
        "because the API uses credentialed (cookie) requests."
    )

# Set to 1 when serving over HTTPS so session cookies are marked Secure.
COOKIE_SECURE = os.environ.get("STOCKS_COOKIE_SECURE", "0") in ("1", "true", "True")

# Lifetime of a fully-authenticated session. Default 14 days.
SESSION_TTL_SECONDS = int(os.environ.get("STOCKS_SESSION_TTL_SECONDS", str(14 * 86400)))
# Lifetime of the short-lived session between password check and TOTP entry.
PENDING_SESSION_TTL_SECONDS = int(os.environ.get("STOCKS_PENDING_SESSION_TTL_SECONDS", "300"))

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
# Per-ticker news pulled for every portfolio/watchlist symbol (kept small to
# stay polite with GDELT: one extra request per symbol per refresh).
NEWS_PER_TICKER_LIMIT = int(os.environ.get("STOCKS_NEWS_PER_TICKER_LIMIT", "8"))

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

# --- Economic calendar ---
# Optional Financial Modeling Prep key. When set, we use FMP's economic_calendar
# (which carries official Low/Medium/High impact ratings); otherwise we fall back
# to Nasdaq's keyless endpoint and classify importance ourselves.
FMP_KEY: str | None = os.environ.get("STOCKS_FMP_KEY") or None
ECON_CALENDAR_DAYS_AHEAD = int(os.environ.get("STOCKS_ECON_CALENDAR_DAYS_AHEAD", "7"))
ECON_CALENDAR_DAYS_BACK = int(os.environ.get("STOCKS_ECON_CALENDAR_DAYS_BACK", "1"))
# Calendar entries move slowly — refresh at most hourly.
ECON_CALENDAR_MIN_INTERVAL_SECONDS = int(
    os.environ.get("STOCKS_ECON_CALENDAR_MIN_INTERVAL_SECONDS", "3600")
)
# Comma-separated country allowlist (matches the app's US-equity orientation).
# Empty string = keep every country.
ECON_CALENDAR_COUNTRIES = [
    c.strip()
    for c in os.environ.get("STOCKS_ECON_CALENDAR_COUNTRIES", "United States").split(",")
    if c.strip()
]

# --- Seasonality ---
# Yahoo chart range for deep history ("max" so the "all years" lookback is meaningful).
SEASONALITY_RANGE = os.environ.get("STOCKS_SEASONALITY_RANGE", "max")
# Deep history barely changes intraday — refresh at most every 12 hours.
SEASONALITY_MIN_INTERVAL_SECONDS = int(
    os.environ.get("STOCKS_SEASONALITY_MIN_INTERVAL_SECONDS", "43200")
)


# --- Live quotes ---
# Server-side cache TTL; slightly under the frontend's 30s poll so each poll
# gets at most one fresh Yahoo fetch and concurrent clients share it.
QUOTES_TTL_SECONDS = int(os.environ.get("STOCKS_QUOTES_TTL_SECONDS", "25"))
QUOTES_TIMEOUT_SECONDS = float(os.environ.get("STOCKS_QUOTES_TIMEOUT_SECONDS", "10"))


# --- Market sentiment indicators ---
# Yahoo chart range for VIX daily history.
VIX_RANGE = os.environ.get("STOCKS_VIX_RANGE", "6mo")
# AAII survey updates weekly — check at most every 6 hours.
AAII_MIN_INTERVAL_SECONDS = int(os.environ.get("STOCKS_AAII_MIN_INTERVAL_SECONDS", "21600"))
# Put/call is a 5-day average — hourly refresh is plenty.
PUT_CALL_MIN_INTERVAL_SECONDS = int(os.environ.get("STOCKS_PUT_CALL_MIN_INTERVAL_SECONDS", "3600"))

# Contrarian signal thresholds.
SENT_FG_BUY = float(os.environ.get("STOCKS_SENT_FG_BUY", "25"))           # extreme fear → buy
SENT_FG_SELL = float(os.environ.get("STOCKS_SENT_FG_SELL", "75"))         # extreme greed → sell
SENT_VIX_ALERT = float(os.environ.get("STOCKS_SENT_VIX_ALERT", "19"))     # market entering a move
SENT_VIX_EXTREME = float(os.environ.get("STOCKS_SENT_VIX_EXTREME", "30")) # historical turning point
SENT_AAII_EXTREME_PCT = float(os.environ.get("STOCKS_SENT_AAII_EXTREME_PCT", "45"))
SENT_AAII_SPREAD = float(os.environ.get("STOCKS_SENT_AAII_SPREAD", "20"))
SENT_PC_BUY = float(os.environ.get("STOCKS_SENT_PC_BUY", "1.0"))          # heavy puts = fear → buy
SENT_PC_SELL = float(os.environ.get("STOCKS_SENT_PC_SELL", "0.8"))        # complacency → sell

# FINRA margin debt updates monthly — check at most once a day.
MARGIN_DEBT_MIN_INTERVAL_SECONDS = int(
    os.environ.get("STOCKS_MARGIN_DEBT_MIN_INTERVAL_SECONDS", "86400")
)
SENT_MARGIN_SELL = float(os.environ.get("STOCKS_SENT_MARGIN_SELL", "45"))     # %YoY: overbought
SENT_MARGIN_EXTREME = float(os.environ.get("STOCKS_SENT_MARGIN_EXTREME", "60"))  # pre-crash leverage
SENT_MARGIN_BUY = float(os.environ.get("STOCKS_SENT_MARGIN_BUY", "-20"))      # deleveraging washout


# --- Daily suggestion digest (email + SMS) ---
# All delivery is gated on these being set; unset channels safely no-op + log.
# Email via SMTP (works with a Gmail app password or any SMTP host):
SMTP_HOST: str | None = os.environ.get("STOCKS_SMTP_HOST") or None
SMTP_PORT = int(os.environ.get("STOCKS_SMTP_PORT", "587"))
SMTP_USER: str | None = os.environ.get("STOCKS_SMTP_USER") or None
SMTP_PASSWORD: str | None = os.environ.get("STOCKS_SMTP_PASSWORD") or None
SMTP_FROM: str | None = os.environ.get("STOCKS_SMTP_FROM") or os.environ.get("STOCKS_SMTP_USER") or None
SMTP_STARTTLS = os.environ.get("STOCKS_SMTP_STARTTLS", "1") not in ("0", "false", "False")

# SMS via Twilio REST API (called with httpx — no twilio library needed):
TWILIO_ACCOUNT_SID: str | None = os.environ.get("STOCKS_TWILIO_ACCOUNT_SID") or None
TWILIO_AUTH_TOKEN: str | None = os.environ.get("STOCKS_TWILIO_AUTH_TOKEN") or None
TWILIO_FROM_PHONE: str | None = os.environ.get("STOCKS_TWILIO_FROM_PHONE") or None

# When to send the pre-market digest for the next trading day.
DIGEST_HOUR = int(os.environ.get("STOCKS_DIGEST_HOUR", "7"))
DIGEST_MINUTE = int(os.environ.get("STOCKS_DIGEST_MINUTE", "30"))
DIGEST_TZ = os.environ.get("STOCKS_DIGEST_TZ", "America/New_York")
# How many opportunity / holding suggestions to include.
SUGGESTIONS_COUNT = int(os.environ.get("STOCKS_SUGGESTIONS_COUNT", "5"))

# --- Alerts ---
# Boom Score level whose upward crossing fires a high-severity alert.
ALERT_BOOM_THRESHOLD = int(os.environ.get("STOCKS_ALERT_BOOM_THRESHOLD", "60"))


def contracts_date_window() -> tuple[str, str]:
    """Return (start_date, end_date) ISO strings for the lookback window."""
    end = date.today()
    start = end - timedelta(days=CONTRACTS_LOOKBACK_DAYS)
    return start.isoformat(), end.isoformat()
