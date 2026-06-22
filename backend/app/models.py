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
