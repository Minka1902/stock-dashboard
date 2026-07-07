"""Request input validation helpers.

Ticker strings arrive from clients and end up interpolated into outbound
Yahoo/GDELT URLs, so they are strictly whitelisted here before any route
touches them.
"""
import re

from fastapi import HTTPException

# Uppercase symbols like AAPL, BRK.B, BF-B, ^GSPC, EURUSD=X. Max 12 chars.
TICKER_RE = re.compile(r"[A-Z0-9^][A-Z0-9.\-^=]{0,11}")


def clean_ticker(raw: str) -> str:
    """Normalize and validate a ticker; raise 400 on anything suspicious."""
    ticker = (raw or "").strip().upper()
    # fullmatch (not match+$): "$" would accept a trailing newline.
    if not TICKER_RE.fullmatch(ticker):
        raise HTTPException(status_code=400, detail="invalid ticker symbol")
    return ticker
