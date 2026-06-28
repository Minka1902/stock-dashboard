"""Unit tests for the fundamentals source module."""
from app.sources.fundamentals import parse_response

_NOW = "2026-06-22T10:00:00+00:00"

FULL_PAYLOAD = {
    "quoteSummary": {
        "result": [{
            "summaryProfile": {
                "sector": "Technology",
                "industry": "Software—Application",
            },
            "summaryDetail": {
                "trailingPE": {"raw": 28.5},
                "forwardPE": {"raw": 22.1},
                "priceToBook": {"raw": 12.3},
                "marketCap": {"raw": 2_500_000_000_000},
            },
            "defaultKeyStatistics": {
                "pegRatio": {"raw": 1.8},
                "profitMargins": {"raw": 0.24},
                "revenueGrowth": {"raw": 0.12},
            },
        }],
        "error": None,
    }
}

EMPTY_PAYLOAD = {"quoteSummary": {"result": [], "error": None}}
MALFORMED_PAYLOAD = {"quoteSummary": None}


def test_parse_response_extracts_all_fields():
    f = parse_response(FULL_PAYLOAD, "MSFT", _NOW)
    assert f is not None
    assert f.ticker == "MSFT"
    assert f.fetched_at == _NOW
    assert f.sector == "Technology"
    assert f.industry == "Software—Application"
    assert f.pe_ratio == 28.5
    assert f.forward_pe == 22.1
    assert f.pb_ratio == 12.3
    assert f.peg_ratio == 1.8
    assert f.profit_margin == 0.24
    assert f.revenue_growth == 0.12
    assert f.market_cap == 2_500_000_000_000.0


def test_parse_response_empty_result_returns_none():
    assert parse_response(EMPTY_PAYLOAD, "X", _NOW) is None


def test_parse_response_malformed_returns_none():
    assert parse_response(MALFORMED_PAYLOAD, "X", _NOW) is None


def test_parse_response_partial_data_fills_none():
    payload = {
        "quoteSummary": {
            "result": [{
                "summaryProfile": {"sector": "Energy"},
                "summaryDetail": {},
                "defaultKeyStatistics": {},
            }]
        }
    }
    f = parse_response(payload, "XOM", _NOW)
    assert f is not None
    assert f.sector == "Energy"
    assert f.pe_ratio is None
    assert f.market_cap is None


def test_parse_response_ticker_uppercased():
    f = parse_response(FULL_PAYLOAD, "msft", _NOW)
    assert f is not None
    assert f.ticker == "MSFT"
