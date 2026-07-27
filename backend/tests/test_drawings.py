"""Chart drawings: per-user, per-ticker storage."""
import pytest
from fastapi.testclient import TestClient

from app import db
from tests.conftest import authenticate


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "draw.db"))
    import importlib
    from app import config, main as main_module
    importlib.reload(config)
    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        authenticate(c)
        yield c


TRENDLINE = {
    "id": "d1", "kind": "trendline", "color": "#f0b429",
    "points": [{"time": "2026-01-02", "price": 100.0},
               {"time": "2026-03-02", "price": 140.0}],
}


# ---- db layer ----

def test_missing_drawings_read_as_empty(conn):
    assert db.get_drawings(conn, 1, "NVDA") == {"shapes": [], "updated_at": None}


def test_roundtrip_and_overwrite(conn):
    db.save_drawings(conn, 1, "nvda", [TRENDLINE], "2026-07-27T00:00:00+00:00")
    got = db.get_drawings(conn, 1, "NVDA")   # ticker is case-insensitive
    assert got["shapes"] == [TRENDLINE]
    assert got["updated_at"] == "2026-07-27T00:00:00+00:00"

    db.save_drawings(conn, 1, "NVDA", [], "2026-07-28T00:00:00+00:00")
    assert db.get_drawings(conn, 1, "NVDA")["shapes"] == []


def test_drawings_are_per_user_and_per_ticker(conn):
    db.save_drawings(conn, 1, "NVDA", [TRENDLINE], "t")
    assert db.get_drawings(conn, 2, "NVDA")["shapes"] == []   # other user
    assert db.get_drawings(conn, 1, "AAPL")["shapes"] == []   # other ticker


def test_corrupt_json_degrades_to_empty(conn):
    conn.execute(
        "INSERT INTO drawings (user_id, ticker, shapes_json, updated_at) VALUES (?,?,?,?)",
        (1, "NVDA", "{not json", "t"),
    )
    conn.commit()
    assert db.get_drawings(conn, 1, "NVDA")["shapes"] == []


# ---- API layer ----

def test_drawings_api_roundtrip(client):
    assert client.get("/api/drawings/NVDA").json()["shapes"] == []
    saved = client.put("/api/drawings/NVDA", json={"shapes": [TRENDLINE]}).json()
    assert saved["shapes"] == [TRENDLINE] and saved["updated_at"]
    assert client.get("/api/drawings/NVDA").json()["shapes"] == [TRENDLINE]


def test_drawings_api_requires_auth(client):
    client.post("/api/auth/logout")
    assert client.get("/api/drawings/NVDA").status_code == 401


def test_drawings_api_rejects_an_absurd_payload(client):
    many = [{**TRENDLINE, "id": f"d{i}"} for i in range(201)]
    assert client.put("/api/drawings/NVDA", json={"shapes": many}).status_code == 400
