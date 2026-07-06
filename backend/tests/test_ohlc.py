"""Parser test for the OHLCV source (app/sources/ohlc.py) — pure, no network."""
from app.sources import ohlc


def test_parse_bars_skips_null_rows_and_maps_fields():
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [1704067200, 1704153600, 1704240000],  # 3 daily bars
                    "indicators": {
                        "quote": [
                            {
                                "open":   [100.0, None, 102.0],   # middle row has a null -> skipped
                                "high":   [101.0, 101.5, 103.0],
                                "low":    [99.0, 100.5, 101.5],
                                "close":  [100.5, 101.0, 102.5],
                                "volume": [1_000_000, 900_000, None],  # null volume -> 0
                            }
                        ]
                    },
                }
            ]
        }
    }
    bars = ohlc.parse_bars(payload)
    assert len(bars) == 2                       # null-open row dropped
    assert bars[0].open == 100.0 and bars[0].close == 100.5
    assert bars[1].volume == 0.0                # null volume coerced to 0
    assert bars[0].date == "2024-01-01"


def test_parse_bars_empty_payload():
    assert ohlc.parse_bars({}) == []
    assert ohlc.parse_bars({"chart": {"result": []}}) == []
