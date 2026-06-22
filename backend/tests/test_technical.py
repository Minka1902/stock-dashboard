from app.sources.technical import compute_ma, compute_rsi, compute_ema, compute_macd, parse_response

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


# ---- compute_ema ----

def test_compute_ema_returns_none_for_initial_values():
    closes = [1.0] * 5
    ema = compute_ema(closes, 3)
    assert ema[0] is None
    assert ema[1] is None


def test_compute_ema_seed_is_sma():
    closes = [2.0, 4.0, 6.0, 8.0, 10.0]  # SMA of first 3 = 4.0
    ema = compute_ema(closes, 3)
    assert ema[2] == 4.0  # seed at index 2 (period-1)


def test_compute_ema_length_matches_input():
    closes = [float(i) for i in range(1, 20)]
    ema = compute_ema(closes, 5)
    assert len(ema) == len(closes)


def test_compute_ema_too_short_returns_none_list():
    closes = [1.0, 2.0]
    ema = compute_ema(closes, 5)
    assert all(v is None for v in ema)


# ---- compute_macd ----

def test_compute_macd_returns_none_for_short_series():
    assert compute_macd([1.0] * 10) == (None, None, None)


def test_compute_macd_returns_values_for_long_series():
    closes = [100.0 + i * 0.3 for i in range(50)]
    macd_val, signal_val, crossover = compute_macd(closes)
    assert macd_val is not None
    assert signal_val is not None
    assert isinstance(crossover, bool)


def test_compute_macd_values_are_rounded():
    closes = [100.0 + i * 0.3 for i in range(50)]
    macd_val, signal_val, _ = compute_macd(closes)
    assert macd_val is not None and round(macd_val, 4) == macd_val
    assert signal_val is not None and round(signal_val, 4) == signal_val


# ---- Yahoo volume parsing ----

YAHOO_WITH_VOLUME = {
    "chart": {
        "result": [{
            "indicators": {
                "quote": [{
                    "close": [100 + i for i in range(25)],
                    "volume": [1_000_000 + i * 10000 for i in range(25)],
                }]
            }
        }]
    }
}


def test_parse_response_yahoo_with_volume_sets_rel_volume():
    sig = parse_response(YAHOO_WITH_VOLUME, "GME", "2026-06-20T12:00:00+00:00")
    assert sig is not None
    assert sig.rel_volume is not None
    assert sig.rel_volume > 0


def test_parse_response_volume_json_is_valid():
    import json
    sig = parse_response(YAHOO_WITH_VOLUME, "GME", "2026-06-20T12:00:00+00:00")
    assert sig is not None
    vols = json.loads(sig.volume_json)
    assert isinstance(vols, list)
    assert len(vols) <= 20
