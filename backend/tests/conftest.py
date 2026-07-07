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
