import os

os.environ.setdefault("FIRE_SECRET_KEY", "test-secret-key")

import pytest


@pytest.fixture()
def client(tmp_path):
    from app.storage import db

    db.set_db_path(str(tmp_path / "test.db"))

    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
