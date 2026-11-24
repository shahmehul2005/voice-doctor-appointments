import pytest

from app import db


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    """Every test gets its own seeded SQLite file."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "clinic.db")
    monkeypatch.setattr(db, "_last_refresh", None)
    db.init()
    yield
