from app.sources.congress import _make_hash, _normalize_type, _parse_date, parse_response

HOUSE_PAYLOAD = [
    {
        "representative": "Jane Smith",
        "party": "D",
        "state": "CA",
        "ticker": "AAPL",
        "asset_description": "Apple Inc. - Common Stock",
        "transaction_date": "2026-06-01",
        "type": "purchase",
        "amount": "$15,001 - $50,000",
        "disclosure_date": "2026-06-10",
    },
    {
        "representative": "Bob Jones",
        "party": "R",
        "state": "TX",
        "ticker": "MSFT",
        "asset_description": "Microsoft Corp",
        "transaction_date": "05/28/2026",
        "type": "sale_full",
        "amount": "$1,001 - $15,000",
        "disclosure_date": "06/05/2026",
    },
    # Duplicate of first entry — should be deduplicated.
    {
        "representative": "Jane Smith",
        "party": "D",
        "state": "CA",
        "ticker": "AAPL",
        "asset_description": "Apple Inc.",
        "transaction_date": "2026-06-01",
        "type": "purchase",
        "amount": "$15,001 - $50,000",
        "disclosure_date": "2026-06-10",
    },
]

SENATE_PAYLOAD = [
    {
        "first_name": "Alice",
        "last_name": "Brown",
        "party": "D",
        "state": "NY",
        "ticker": "NVDA",
        "asset_type": "Stock",
        "transaction_date": "2026-06-05",
        "type": "Purchase",
        "amount": "$50,001 - $100,000",
        "disclosure_date": "2026-06-12",
    },
]


def test_make_hash_is_deterministic():
    h1 = _make_hash("Jane Smith", "AAPL", "2026-06-01", "Purchase")
    h2 = _make_hash("jane smith", "aapl", "2026-06-01", "purchase")
    assert h1 == h2


def test_make_hash_length():
    assert len(_make_hash("A", "B", "C", "D")) == 16


def test_parse_date_iso_passthrough():
    assert _parse_date("2026-06-01") == "2026-06-01"


def test_parse_date_us_format():
    assert _parse_date("05/28/2026") == "2026-05-28"
    assert _parse_date("06/05/2026") == "2026-06-05"


def test_normalize_type():
    assert _normalize_type("purchase") == "Purchase"
    assert _normalize_type("sale_full") == "Sale"
    assert _normalize_type("Sale (Partial)") == "Sale"
    assert _normalize_type("exchange") == "Exchange"


def test_parse_house_deduplicates():
    trades = parse_response(HOUSE_PAYLOAD, "house")
    assert len(trades) == 2  # third entry is a dup of first


def test_parse_house_normalizes_fields():
    trades = parse_response(HOUSE_PAYLOAD, "house")
    aapl = next(t for t in trades if t.ticker == "AAPL")
    assert aapl.representative == "Jane Smith"
    assert aapl.party == "D"
    assert aapl.transaction_type == "Purchase"
    assert aapl.chamber == "house"


def test_parse_house_normalizes_date_format():
    trades = parse_response(HOUSE_PAYLOAD, "house")
    msft = next(t for t in trades if t.ticker == "MSFT")
    assert msft.transaction_date == "2026-05-28"
    assert msft.filed_at == "2026-06-05"


def test_parse_senate_combines_name():
    trades = parse_response(SENATE_PAYLOAD, "senate")
    assert len(trades) == 1
    assert trades[0].representative == "Alice Brown"
    assert trades[0].chamber == "senate"
    assert trades[0].ticker == "NVDA"
