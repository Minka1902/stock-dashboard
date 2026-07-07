"""Normalized data models shared across the app."""
from pydantic import BaseModel


class ContractRecord(BaseModel):
    # Unique, stable id from USASpending (used for dedup/upsert).
    external_id: str
    award_id: str
    recipient_name: str
    amount: float
    awarding_agency: str
    start_date: str  # ISO date string, may be ""
    source: str = "usaspending"


class NewsArticle(BaseModel):
    url: str  # unique key
    title: str
    domain: str
    seendate: str  # ISO timestamp
    sourcecountry: str
    image: str  # may be ""
    ticker: str = ""  # "" = macro/geopolitics; else the portfolio/watchlist ticker it matched


class InsiderTrade(BaseModel):
    accession: str  # unique filing id
    ticker: str
    company: str
    owner: str
    role: str  # e.g. "Exec VP-Leasing", "Director", "10% Owner"
    transaction_date: str
    transaction_type: str  # "Buy", "Sell", or "Other"
    shares: float
    value: float  # total $ across the filing's open-market transactions
    filing_url: str
    filed_at: str  # ISO timestamp from the filing feed


class WatchItem(BaseModel):
    ticker: str
    note: str
    added_at: str


class SourceStatus(BaseModel):
    source: str
    last_refreshed_at: str | None  # ISO timestamp, None if never run
    status: str                    # "ok" or "error: <msg>"
    record_count: int


class YieldPoint(BaseModel):
    date: str           # YYYY-MM-DD — PRIMARY KEY
    yr2: float | None
    yr10: float | None
    yr30: float | None
    spread: float | None  # yr10 - yr2


class TechnicalSignal(BaseModel):
    ticker: str           # PRIMARY KEY
    fetched_at: str
    price: float | None
    change_pct: float | None
    ma50: float | None
    ma200: float | None
    golden_cross: bool | None   # True = ma50 > ma200
    rsi14: float | None
    high_52w: float | None
    low_52w: float | None
    prices_json: str              # JSON array of last 100 closes for sparkline
    macd: float | None = None
    macd_signal: float | None = None
    macd_crossover: bool | None = None
    rel_volume: float | None = None
    volume_json: str = "[]"       # JSON array of last 20 daily volumes


class LiveQuote(BaseModel):
    ticker: str
    price: float                # last 1m close incl. pre/post; fallback regularMarketPrice
    change_pct: float | None    # vs previous regular close
    previous_close: float | None
    market_state: str           # "PRE" | "LIVE" | "POST" | "CLOSED"
    fetched_at: str


class FearGreedSnapshot(BaseModel):
    captured_at: str   # ISO timestamp — PRIMARY KEY
    score: float       # 0–100
    rating: str        # "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"


class VixPoint(BaseModel):
    date: str    # YYYY-MM-DD — PRIMARY KEY
    close: float


class AaiiSentiment(BaseModel):
    week_ending: str   # YYYY-MM-DD — PRIMARY KEY
    bullish: float     # percentages 0–100
    neutral: float
    bearish: float
    fetched_at: str


class PutCallPoint(BaseModel):
    date: str    # YYYY-MM-DD — PRIMARY KEY
    ratio: float  # 5-day average total put/call ratio


class MarginDebtPoint(BaseModel):
    month: str             # "YYYY-MM" — PRIMARY KEY
    debit_balances: float  # $ millions (FINRA margin account debit balances)


class CongressTrade(BaseModel):
    trade_hash: str        # PRIMARY KEY (content hash)
    representative: str
    party: str             # "D", "R", "I", or ""
    state: str
    ticker: str
    asset_description: str
    transaction_date: str  # YYYY-MM-DD
    transaction_type: str  # "Purchase" | "Sale" | "Exchange"
    amount_range: str      # e.g. "$1,001 - $15,000"
    filed_at: str
    chamber: str           # "house" | "senate"


class ShortInterest(BaseModel):
    ticker: str                      # PRIMARY KEY
    fetched_at: str
    shares_short: int | None
    short_pct_float: float | None    # 0.15 = 15%
    days_to_cover: float | None      # short ratio (days to unwind)
    prior_month_shares: int | None
    squeeze_flag: bool               # short_pct_float > 0.15


class SocialSentiment(BaseModel):
    ticker: str           # PRIMARY KEY
    fetched_at: str
    mentions: int | None
    upvotes: int | None
    rank: int | None            # current rank (1 = most mentioned)
    rank_24h_ago: int | None
    rank_change: int | None     # rank_24h_ago - rank (positive = rising)


class AnalystSignal(BaseModel):
    ticker: str               # PRIMARY KEY
    fetched_at: str
    next_earnings: str | None  # ISO date YYYY-MM-DD
    rec_strong_buy: int | None
    rec_buy: int | None
    rec_hold: int | None
    rec_sell: int | None
    recent_upgrades: int       # count of "up" or "init" actions in last 30 days
    recent_downgrades: int     # count of "down" actions in last 30 days
    latest_action: str | None  # "up" | "down" | "init"
    latest_firm: str | None
    latest_to_grade: str | None  # e.g. "Buy", "Outperform"


class BoomScore(BaseModel):
    ticker: str         # PRIMARY KEY
    computed_at: str
    score: int          # can be negative (−90 … +100)
    components: str     # JSON dict of fired signals and their points
    # bullish signals
    golden_cross: bool
    rsi_recovery: bool
    insider_cluster_buy: bool
    congress_buy: bool
    short_squeeze: bool
    wsb_rising: bool
    analyst_upgrade: bool
    near_52w_high: bool = False
    macd_crossover: bool = False
    volume_confirmed: bool = False
    fear_greed_contrarian: bool = False
    yield_uninversion: bool = False
    contracts_catalyst: bool = False
    seasonal_tailwind: bool = False
    vix_spike_contrarian: bool = False
    aaii_bearish_extreme: bool = False
    put_call_fear: bool = False
    margin_debt_deleveraging: bool = False
    # bearish signals (fire when score is negative contribution)
    death_cross: bool = False
    insider_cluster_sell: bool = False
    overbought_rsi: bool = False
    congress_sale: bool = False
    analyst_downgrade_cluster: bool = False
    extreme_greed: bool = False
    aaii_bullish_euphoria: bool = False
    margin_debt_euphoria: bool = False
    # risk / meta flags
    earnings_soon: bool = False
    mixed_signals: bool = False


class Fundamentals(BaseModel):
    ticker: str           # PRIMARY KEY
    fetched_at: str
    sector: str | None
    industry: str | None
    pe_ratio: float | None
    forward_pe: float | None
    peg_ratio: float | None
    pb_ratio: float | None
    revenue_growth: float | None
    profit_margin: float | None
    market_cap: float | None


class Seasonality(BaseModel):
    ticker: str            # PRIMARY KEY
    computed_at: str
    as_of: str             # "MM-DD" anchor (server compute date)
    history_years: int     # distinct years with >=1 usable window value
    windows_json: str      # JSON list of window objects (key/label/kind/per_year)


class Holding(BaseModel):
    ticker: str        # PRIMARY KEY (single-user portfolio)
    shares: float
    avg_cost: float
    added_at: str


class NotifyProfile(BaseModel):
    email: str | None = None
    phone: str | None = None       # E.164, e.g. +14155551234
    email_enabled: bool = False
    sms_enabled: bool = False
    # Position sizing (Trading & risk settings). risk_pct clamped 0.1–10 in the API.
    account_size: float | None = None
    risk_pct: float = 1.0
    updated_at: str = ""


class AppSettings(BaseModel):
    """Single-row app settings (id=1). Times are wall-clock in analysis_tz."""
    analysis_time: str = "15:30"          # "HH:MM", 24h
    analysis_tz: str = "Asia/Jerusalem"   # IANA timezone name
    quotes_refresh_seconds: int = 30      # live-quote poll cadence, clamped 10–300 in the API
    updated_at: str = ""


# ---------- Accounts & sessions ----------

class User(BaseModel):
    id: int
    email: str
    password_hash: str
    totp_secret: str | None = None
    totp_enabled: bool = False
    is_admin: bool = False
    created_at: str = ""

    def public(self) -> dict:
        """The shape safe to return to the browser."""
        return {"id": self.id, "email": self.email, "is_admin": self.is_admin}


class AuthSession(BaseModel):
    token_hash: str    # sha256 of the raw cookie token; raw value never stored
    user_id: int
    state: str         # 'totp_setup' | 'pending_totp' | 'active'
    created_at: str
    expires_at: str
    last_seen_at: str


# ---------- Portfolio technical analysis ----------

class OHLCBar(BaseModel):
    date: str          # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: float


class OHLCSeries(BaseModel):
    ticker: str
    interval: str      # "daily" | "weekly"  (PK is ticker+interval)
    bars_json: str     # JSON array of OHLCBar dicts, oldest first
    fetched_at: str


class PatternHit(BaseModel):
    name: str              # machine key, e.g. "cup_handle"
    label: str             # human, e.g. "Cup & Handle"
    direction: str         # "bullish" | "bearish" | "neutral"
    confidence: float      # 0..1
    pivots: list[dict]     # [{date, price, role}] — the points that define it
    measured_move: float | None = None  # classic projected target price, if any
    note: str = ""


class SRLevel(BaseModel):
    price: float
    kind: str              # "support" | "resistance"
    touches: int
    last_touch: str        # date


class GapEvent(BaseModel):
    date: str
    from_price: float      # prior close
    to_price: float        # open
    pct: float
    kind: str              # "up" | "down"
    filled: bool


class TargetRung(BaseModel):
    r: float               # 3, 4, 5, 6
    price: float
    feasibility: str       # "base" | "likely" | "possible" | "unlikely"
    why: str


class StockAnalysis(BaseModel):
    ticker: str
    computed_at: str
    price: float | None
    # trend / moving averages
    ma20: float | None = None
    ma50: float | None = None
    ma150: float | None = None
    ma200: float | None = None
    ma_alignment: str = "mixed"   # "stacked_bull" | "stacked_bear" | "mixed"
    trend: str = "sideways"       # "up" | "down" | "sideways"
    atr14: float | None = None
    atr_pct: float | None = None  # atr / price
    # structure
    support: list[SRLevel] = []
    resistance: list[SRLevel] = []
    gaps: list[GapEvent] = []
    patterns: list[PatternHit] = []
    # trade plan
    directive: str = "Hold"       # "Accumulate" | "Hold" | "Reduce" | "Avoid"
    conviction: int = 0           # −100..+100
    entry: float | None = None
    stop: float | None = None
    stop_basis: str = ""          # "structure" | "atr"
    stop_atr: float | None = None
    stop_structure: float | None = None
    risk_per_share: float | None = None
    target: float | None = None   # 3R base target
    reward_per_share: float | None = None
    rr: float | None = None       # base reward:risk
    targets: list[TargetRung] = []
    suggested_shares: int | None = None
    account_size: float | None = None
    risk_pct: float | None = None
    reasons: list[str] = []
    disclaimer: str = "Rule-based technical read, not a prediction. Verify before trading."


class SuggestionLogEntry(BaseModel):
    created_at: str
    for_date: str                  # next trading day (YYYY-MM-DD)
    channel: str                   # "email" | "sms" | "alert"
    status: str                    # "sent" | "skipped: ..." | "error: ..."


class Alert(BaseModel):
    dedup_key: str          # stable id; UNIQUE → idempotent inserts
    created_at: str
    ticker: str
    type: str               # boom_cross | golden_cross | insider_cluster | earnings_soon | congress_buy
    severity: str           # "high" | "medium"
    title: str
    message: str
    read: bool = False
    pushed: bool = False
