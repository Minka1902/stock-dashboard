"""Single-port static serving: the backend serves the built frontend dist/."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import _mount_spa


def _dist(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>APP</title>")
    (dist / "assets" / "app.js").write_text("console.log('hi')")
    return dist


def test_spa_serves_index_and_falls_back(tmp_path):
    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    assert _mount_spa(app, _dist(tmp_path)) is True
    c = TestClient(app)

    # index at root
    assert "APP" in c.get("/").text
    # deep client route falls back to index (hash/SPA routing)
    assert "APP" in c.get("/some/deep/route").text
    # a real asset file is served
    assert c.get("/assets/app.js").status_code == 200
    # unknown API path 404s (never masked by index.html)
    assert c.get("/api/unknown").status_code == 404
    # real API route is unaffected
    assert c.get("/api/health").json() == {"status": "ok"}


def test_no_dist_is_a_noop(tmp_path):
    app = FastAPI()
    assert _mount_spa(app, tmp_path / "nope") is False
    # no catch-all registered → an unknown path is a plain 404
    assert TestClient(app).get("/").status_code == 404
