import pytest
from app import db


@pytest.fixture
def conn(tmp_path):
    """A fresh, schema-initialized SQLite connection backed by a temp file."""
    db_file = tmp_path / "test.db"
    connection = db.connect(str(db_file))
    db.init_schema(connection)
    yield connection
    connection.close()
