"""Tests for the on-demand pro-chart bars (app/chart_data.py)."""
import pytest

from app import chart_data


def _payload(timestamps, closes, tz_offset=0):
    n = len(timestamps)
    return {
        "chart": {
            "result": [{
                "timestamp": timestamps,
                "indicators": {"quote": [{
                    "open": [c - 1 for c in closes],
                    "high": [c + 1 for c in closes],
                    "low": [c - 2 for c in closes],
                    "close": list(closes),
                    "volume": [1000] * n,
                }]},
            }]
        }
    }


def test_parse_chart_bars_intraday_keeps_epoch_time():
    bars = chart_data.parse_chart_bars(_payload([1751800000, 1751800060], [10.0, 10.5]), intraday=True)
    assert [b["time"] for b in bars] == [1751800000, 1751800060]
    assert bars[1]["close"] == 10.5
    assert bars[0]["high"] == 11.0


def test_parse_chart_bars_daily_uses_dates_and_dedupes():
    # two timestamps on the same UTC date (regular bar + live re-quote) -> one bar
    same_day = [1751500800, 1751522400]
    bars = chart_data.parse_chart_bars(_payload(same_day, [10.0, 10.7]), intraday=False)
    assert len(bars) == 1
    assert bars[0]["time"] == "2025-07-03"
    assert bars[0]["close"] == 10.7  # the later bar wins


def test_parse_chart_bars_drops_null_bars():
    payload = _payload([1751800000, 1751800060], [10.0, 10.5])
    payload["chart"]["result"][0]["indicators"]["quote"][0]["close"][1] = None
    bars = chart_data.parse_chart_bars(payload, intraday=True)
    assert len(bars) == 1


def test_parse_chart_bars_empty_payload():
    assert chart_data.parse_chart_bars({}, intraday=True) == []


def test_get_bars_caches_per_ticker_interval(monkeypatch):
    calls = []

    def stub_fetch(ticker, interval):
        calls.append((ticker, interval))
        return [{"time": "2026-07-03", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10}]

    monkeypatch.setattr(chart_data, "fetch_bars", stub_fetch)
    chart_data._cache.clear()

    a = chart_data.get_bars("aapl", "1d")
    b = chart_data.get_bars("AAPL", "1d")  # case-insensitive cache hit
    assert a["ticker"] == "AAPL" and a["bars"] and a == b
    assert calls == [("AAPL", "1d")]

    chart_data.get_bars("AAPL", "5m")  # different interval -> new fetch
    assert calls == [("AAPL", "1d"), ("AAPL", "5m")]
    chart_data._cache.clear()


def test_get_bars_does_not_cache_empty(monkeypatch):
    calls = []

    def stub_fetch(ticker, interval):
        calls.append(1)
        return []

    monkeypatch.setattr(chart_data, "fetch_bars", stub_fetch)
    chart_data._cache.clear()
    assert chart_data.get_bars("X", "1d")["bars"] == []
    assert chart_data.get_bars("X", "1d")["bars"] == []
    assert len(calls) == 2  # empty result was not cached
    chart_data._cache.clear()


def test_unknown_interval_raises_keyerror():
    with pytest.raises(KeyError):
        chart_data.get_bars("AAPL", "42h")
