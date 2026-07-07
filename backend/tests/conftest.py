import pytest
from app import db, security


@pytest.fixture
def conn(tmp_path):
    """A fresh, schema-initialized SQLite connection backed by a temp file."""
    db_file = tmp_path / "test.db"
    connection = db.connect(str(db_file))
    db.init_schema(connection)
    yield connection
    connection.close()


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The limiter is module-global; keep its counters test-scoped."""
    security.limiter.reset()
    yield
    security.limiter.reset()


def authenticate(client, email="tester@example.com", password="hunter2-secure"):
    """Register + enroll TOTP on a TestClient so protected routes pass auth.

    Returns the TOTP secret so tests can mint further codes with pyotp.
    """
    import pyotp

    r = client.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    setup = client.get("/api/auth/totp/setup")
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    enabled = client.post(
        "/api/auth/totp/enable", json={"code": pyotp.TOTP(secret).now()})
    assert enabled.status_code == 200, enabled.text
    return secret
