"""Gross↔net salary conversion and the wizard salary preview."""

import pytest

from app.simulation.config import default_config
from app.simulation.planner import WizardAnswers, plan
from app.simulation.salary import (
    b2b_gross_from_net,
    b2b_net_from_gross,
    gross_from_net,
    net_from_gross,
    salary_preview,
)

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


@pytest.mark.slow
def test_planner_net_salary_mode_matches_gross():
    gross_plan = plan(1, WizardAnswers(**BASE, gross_monthly=8_000), scenarios=False)
    net_plan = plan(
        1,
        WizardAnswers(**BASE, gross_monthly=5_789.53, salary_mode="net"),
        scenarios=False,
    )
    assert net_plan.input.monthly_gross == pytest.approx(gross_plan.input.monthly_gross, rel=1e-3)
    assert net_plan.net_monthly == pytest.approx(5_789.53, abs=0.1)


@pytest.mark.slow
def test_planner_net_monthly_includes_ppk():
    result = plan(1, WizardAnswers(**BASE, gross_monthly=8_000, use_ppk=True), scenarios=False)
    assert result.net_monthly == pytest.approx(5_629.53, abs=0.1)


B2B_TAX_FORMS = [
    ("ryczalt", 0.12),
    ("liniowy", 0.12),
    ("skala", 0.12),
]
B2B_ZUS_MODES = ["duzy", "maly", "ulga", "custom"]


@pytest.mark.parametrize(("tax_form", "lump_rate"), B2B_TAX_FORMS)
@pytest.mark.parametrize("zus_mode", B2B_ZUS_MODES)
@pytest.mark.parametrize("gross", [8_000, 20_000])
def test_b2b_gross_net_round_trip(tax_form, lump_rate, zus_mode, gross):
    kwargs = dict(
        tax_form=tax_form,
        lump_rate=lump_rate,
        zus_mode=zus_mode,
        custom_zus_base=5_652.0,
    )
    net = b2b_net_from_gross(gross, CFG, **kwargs)
    assert net > 0
    recovered_gross = b2b_gross_from_net(net, CFG, **kwargs)
    assert b2b_net_from_gross(recovered_gross, CFG, **kwargs) == pytest.approx(
        net, rel=1e-6
    )


def test_b2b_net_uses_higher_ikze_limit_for_self_employed():
    from app.simulation.planner import build_stages

    a = WizardAnswers(
        **dict(
            BASE,
            employment="b2b",
            gross_monthly=20_000,
            b2b_tax_form="liniowy",
            b2b_zus_mode="duzy",
            use_ppk=False,
            use_ikze=True,
            allocations={"ikze": 100.0},
        )
    )
    stages = build_stages(a).stages
    accumulation = next(stage for stage in stages if stage.stage_type == "akumulacja")
    ikze = accumulation.accounts["ikze"]
    assert ikze.ikze_limit == "self_employed"
    assert ikze.ikze_tax_regime == "flat_19"
    assert ikze.annual_contribution == pytest.approx(12_000.0)


@pytest.mark.parametrize(("tax_form", "lump_rate"), B2B_TAX_FORMS)
def test_salary_endpoint_b2b_gross(client, tax_form, lump_rate):
    resp = client.post(
        "/api/wizard/salary",
        json={
            "salary_mode": "gross",
            "amount": 20_000,
            "employment": "b2b",
            "b2b_tax_form": tax_form,
            "b2b_lump_rate": lump_rate,
            "b2b_zus_mode": "duzy",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    expected = b2b_net_from_gross(
        20_000, CFG, tax_form=tax_form, lump_rate=lump_rate, zus_mode="duzy"
    )
    assert body["gross_monthly"] == pytest.approx(20_000)
    assert body["net_monthly"] == pytest.approx(expected, abs=0.02)


@pytest.mark.parametrize(("tax_form", "lump_rate"), B2B_TAX_FORMS)
def test_salary_endpoint_b2b_net(client, tax_form, lump_rate):
    net = b2b_net_from_gross(
        20_000, CFG, tax_form=tax_form, lump_rate=lump_rate, zus_mode="maly"
    )
    resp = client.post(
        "/api/wizard/salary",
        json={
            "salary_mode": "net",
            "amount": net,
            "employment": "b2b",
            "b2b_tax_form": tax_form,
            "b2b_lump_rate": lump_rate,
            "b2b_zus_mode": "maly",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["net_monthly"] == pytest.approx(net, abs=0.02)
    assert body["gross_monthly"] == pytest.approx(20_000, rel=1e-5)
