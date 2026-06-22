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
