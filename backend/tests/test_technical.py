from app.sources.technical import compute_ma, compute_rsi, parse_response

# 30 daily closes: steadily rising sequence for a predictable RSI.
_CLOSES = [100.0 + i * 0.5 for i in range(30)]

# Alpha Vantage shaped payload (2 dates; sorted oldest → newest in the dict).
AV_PAYLOAD = {
    "Time Series (Daily)": {
        "2026-06-19": {"4. close": "149.00"},
        "2026-06-20": {"4. close": "150.00"},
        **{f"2026-05-{str(i).zfill(2)}": {"4. close": str(100 + i)} for i in range(1, 20)},
    }
}

# Yahoo Finance shaped payload.
YAHOO_PAYLOAD = {
    "chart": {
        "result": [{
            "indicators": {
                "quote": [{
                    "close": [100 + i for i in range(20)],
                }]
            }
        }]
    }
}


def test_compute_ma_returns_average_of_last_n():
    closes = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert compute_ma(closes, 3) == 4.0  # (3+4+5)/3


def test_compute_ma_returns_none_when_too_short():
    assert compute_ma([1.0, 2.0], 5) is None


def test_compute_rsi_returns_none_when_too_short():
    assert compute_rsi([1.0] * 5, period=14) is None


def test_compute_rsi_range():
    rsi = compute_rsi(_CLOSES, period=14)
    assert rsi is not None
    assert 0.0 <= rsi <= 100.0


def test_compute_rsi_all_gains_returns_100():
    # Strictly increasing prices → avg_loss = 0 → RSI = 100.
    rising = [float(i) for i in range(1, 30)]
    assert compute_rsi(rising) == 100.0


def test_parse_response_detects_alphavantage():
    sig = parse_response(AV_PAYLOAD, "AAPL", "2026-06-20T12:00:00+00:00")
    assert sig is not None
    assert sig.ticker == "AAPL"
    assert sig.price is not None


def test_parse_response_detects_yahoo():
    sig = parse_response(YAHOO_PAYLOAD, "MSFT", "2026-06-20T12:00:00+00:00")
    assert sig is not None
    assert sig.ticker == "MSFT"


def test_parse_response_returns_none_when_insufficient_data():
    tiny = {"chart": {"result": [{"indicators": {"quote": [{"close": [100.0, 101.0]}]}}]}}
    assert parse_response(tiny, "X", "2026-06-20T00:00:00+00:00") is None


def test_parse_response_prices_json_is_valid():
    import json
    sig = parse_response(AV_PAYLOAD, "AAPL", "2026-06-20T12:00:00+00:00")
    assert sig is not None
    prices = json.loads(sig.prices_json)
    assert isinstance(prices, list)
    assert all(isinstance(p, float) for p in prices)
