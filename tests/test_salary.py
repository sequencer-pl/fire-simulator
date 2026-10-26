"""Gross↔net salary conversion and the wizard salary preview."""

import pytest

from app.simulation.config import default_config
from app.simulation.planner import WizardAnswers, plan
from app.simulation.salary import gross_from_net, net_from_gross, salary_preview

CFG = default_config()

BASE = dict(
    gender="m",
    age_now=30,
    employment="etat",
    capital={"broker": 100_000},
    savings=1000,
    strategy="zbilansowana",
    retire_early_age=55,
)


def test_net_from_gross_8000():
    # 8000 − ZUS 13,71% − zdrowotna 9% − PIT 12% (z KUP i kwotą wolną)
    assert net_from_gross(8_000, CFG) == pytest.approx(5_789.53, abs=0.02)


def test_net_from_gross_12000():
    assert net_from_gross(12_000, CFG) == pytest.approx(8_505.33, abs=0.02)


def test_net_from_gross_zero():
    assert net_from_gross(0, CFG) == 0.0
    assert gross_from_net(0, CFG) == 0.0


def test_net_from_gross_with_ppk():
    assert net_from_gross(8_000, CFG, ppk_pct=0.02) == pytest.approx(5_629.53, abs=0.02)


@pytest.mark.parametrize("gross", [3_000, 8_000, 12_000, 25_000, 80_000])
def test_gross_net_round_trip(gross):
    net = net_from_gross(gross, CFG)
    assert gross_from_net(net, CFG) == pytest.approx(gross, rel=1e-6)


def test_gross_from_net_with_ppk_round_trip():
    net = net_from_gross(8_000, CFG, ppk_pct=0.02)
    assert gross_from_net(net, CFG, ppk_pct=0.02) == pytest.approx(8_000, rel=1e-6)


def test_salary_preview_b2b_has_no_net():
    gross, net = salary_preview(25_000, "net", "b2b", CFG)
    assert gross == 25_000
    assert net is None


def test_salary_endpoint_gross(client):
    resp = client.post(
        "/api/wizard/salary",
        json={"salary_mode": "gross", "amount": 8_000, "employment": "etat"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["gross_monthly"] == pytest.approx(8_000)
    assert body["net_monthly"] == pytest.approx(5_789.53, abs=0.02)


def test_salary_endpoint_net(client):
    resp = client.post(
        "/api/wizard/salary",
        json={"salary_mode": "net", "amount": 5_789.53, "employment": "etat"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["gross_monthly"] == pytest.approx(8_000, abs=0.05)
    assert body["net_monthly"] == pytest.approx(5_789.53, abs=0.05)


def test_salary_endpoint_ppk(client):
    resp = client.post(
        "/api/wizard/salary",
        json={
            "salary_mode": "gross",
            "amount": 8_000,
            "employment": "etat",
            "use_ppk": True,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["net_monthly"] == pytest.approx(5_629.53, abs=0.02)


def test_planner_net_salary_mode_matches_gross():
    gross_plan = plan(1, WizardAnswers(**BASE, gross_monthly=8_000))
    net_plan = plan(
        1,
        WizardAnswers(**BASE, gross_monthly=5_789.53, salary_mode="net"),
    )
    assert net_plan.input.monthly_gross == pytest.approx(gross_plan.input.monthly_gross, rel=1e-3)
    assert net_plan.net_monthly == pytest.approx(5_789.53, abs=0.1)


def test_planner_net_monthly_includes_ppk():
    result = plan(1, WizardAnswers(**BASE, gross_monthly=8_000, use_ppk=True))
    assert result.net_monthly == pytest.approx(5_629.53, abs=0.1)
