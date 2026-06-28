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


class FearGreedSnapshot(BaseModel):
    captured_at: str   # ISO timestamp — PRIMARY KEY
    score: float       # 0–100
    rating: str        # "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"


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
    # bearish signals (fire when score is negative contribution)
    death_cross: bool = False
    insider_cluster_sell: bool = False
    overbought_rsi: bool = False
    congress_sale: bool = False
    analyst_downgrade_cluster: bool = False
    extreme_greed: bool = False
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
