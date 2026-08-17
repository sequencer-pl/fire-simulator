import os

os.environ.setdefault("FIRE_SECRET_KEY", "test-secret-key")

import pytest

from app.simulation.config import default_config
from app.simulation.schemas import AccountConfig, StageInput


def acc(**kwargs):
    return AccountConfig(**kwargs)


def accumulation_stage(accounts, start=40, end=65):
    return StageInput(
        stage_type="akumulacja",
        name="Akumulacja",
        start_age=start,
        end_age=end,
        accounts=accounts,
    )


def realization_stage(name, accounts, start, end):
    return StageInput(
        stage_type="realizacja",
        name=name,
        start_age=start,
        end_age=end,
        accounts=accounts,
    )


def no_tax_config():
    cfg = default_config()
    cfg.kwota_wolna = 0.0
    cfg.rate_lower = 0.0
    cfg.rate_upper = 0.0
    return cfg


@pytest.fixture()
def client(tmp_path):
    from app.storage import db

    db.set_db_path(str(tmp_path / "test.db"))

    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
