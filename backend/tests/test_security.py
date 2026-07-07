"""Phase-0 hardening: rate limiter, ticker validation, security headers."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.security import RateLimiter
from app.validation import clean_ticker


# ---------- RateLimiter ----------

def test_limiter_allows_up_to_limit_then_blocks():
    rl = RateLimiter()
    now = 1000.0
    for _ in range(3):
        assert rl.check("b", "k", limit=3, window_seconds=60, now=now) is None
    retry = rl.check("b", "k", limit=3, window_seconds=60, now=now)
    assert retry is not None and retry > 0


def test_limiter_window_resets():
    rl = RateLimiter()
    assert rl.check("b", "k", 1, 60, now=0.0) is None
    assert rl.check("b", "k", 1, 60, now=1.0) is not None
    # A new window opens after window_seconds elapse.
    assert rl.check("b", "k", 1, 60, now=61.0) is None


def test_limiter_keys_are_independent():
    rl = RateLimiter()
    assert rl.check("b", "alice", 1, 60, now=0.0) is None
    assert rl.check("b", "alice", 1, 60, now=0.0) is not None
    assert rl.check("b", "bob", 1, 60, now=0.0) is None
    assert rl.check("other", "alice", 1, 60, now=0.0) is None


# ---------- ticker validation ----------

@pytest.mark.parametrize("raw,expected", [
    ("aapl", "AAPL"),
    (" MSFT ", "MSFT"),
    ("BRK.B", "BRK.B"),
    ("BF-B", "BF-B"),
    ("^GSPC", "^GSPC"),
    ("EURUSD=X", "EURUSD=X"),
])
def test_clean_ticker_accepts_valid(raw, expected):
    assert clean_ticker(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "  ", "AAPL/../etc", "AAPL?range=max", "A B", "AAPL%20", "@EVIL",
    "TOOLONGTICKER", "-AAPL", "aapl;drop", "AA\nPL", "..",
])
def test_clean_ticker_rejects_invalid(raw):
    with pytest.raises(HTTPException) as e:
        clean_ticker(raw)
    assert e.value.status_code == 400


# ---------- app-level: headers + sanitized errors ----------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "sec.db"))
    import importlib
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        from tests.conftest import authenticate
        authenticate(c)
        yield c


def test_security_headers_present(client):
    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "same-origin"


def test_invalid_ticker_rejected_by_route(client):
    assert client.get("/api/chart/AA_PL").status_code == 400
    assert client.get("/api/chart/AAPL?interval=nope").status_code == 400


def test_chart_error_is_sanitized(client, monkeypatch):
    from app import chart_data

    def boom(ticker, interval):
        raise RuntimeError("secret internal path /home/user/stocks.db")

    monkeypatch.setattr(chart_data, "get_bars", boom)
    r = client.get("/api/chart/AAPL")
    assert r.status_code == 502
    assert "secret" not in r.text
    assert r.json()["detail"] == "chart data unavailable"


def test_refresh_rate_limited(client, monkeypatch):
    from app import security
    monkeypatch.setattr(security.limiter, "check", lambda *a, **k: 30.0)
    r = client.post("/api/refresh/usaspending")
    assert r.status_code == 429
    assert r.headers.get("Retry-After") == "30"
