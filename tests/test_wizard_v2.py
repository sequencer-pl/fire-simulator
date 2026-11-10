"""Asystent v2 — route, B2B oraz etapy Coast/Barista FIRE i kredytu."""

import pytest

from app.simulation.config import default_config
from app.simulation.planner import WizardAnswers, build_stages
from app.simulation.salary import b2b_net_from_gross

BASE = dict(
    gender="m",
    age_now=35,
    employment="etat",
    gross_monthly=8_000,
    capital={"broker": 200_000},
    savings=1_500,
    strategy="zbilansowana",
    retire_early_age=55,
    retirement_age=65,
    plan_end_age=85,
)


def answers(**over):
    merged = dict(BASE)
    merged.update(over)
    return WizardAnswers(**merged)


def accumulation_stages(a):
    return [stage for stage in build_stages(a).stages if stage.stage_type == "akumulacja"]


def test_wizard_v2_page(client):
    resp = client.get("/wizard-v2")
    assert resp.status_code == 200
    text = resp.text
    assert "wizard-v2.js" in text
    assert 'id="v2SheltersPicker"' in text
    assert 'id="v2SuggestList"' in text
    assert 'id="v2NextBtn"' in text
    assert 'id="v2StepCount"' in text


def test_wizard_v1_links_to_v2(client):
    resp = client.get("/wizard")
    assert resp.status_code == 200
    assert 'href="/wizard-v2"' in resp.text


def test_b2b_net_salary_is_normalized_to_invoice_revenue():
    net = b2b_net_from_gross(
        20_000,
        default_config(),
        tax_form="liniowy",
        zus_mode="duzy",
    )
    a = answers(
        employment="b2b",
        gross_monthly=net,
        salary_mode="net",
        b2b_tax_form="liniowy",
        b2b_zus_mode="duzy",
        use_ppk=False,
    )
    input_data = build_stages(a)
    assert input_data.monthly_gross == pytest.approx(20_000, rel=1e-5)


def test_unemployed_capital_has_accumulation_stage_before_fire():
    a = answers(
        employment="niepracujacy",
        gross_monthly=0,
        capital={"broker": 300_000},
        savings=0,
        use_ppk=False,
        use_zus=False,
    )
    stages = accumulation_stages(a)
    assert len(stages) == 1
    assert stages[0].name == "Akumulacja do emerytury"
    assert stages[0].start_age == 35
    assert stages[0].end_age == 55
    assert stages[0].accounts["broker"].starting_balance == pytest.approx(300_000)


def test_coast_fire_splits_accumulation_into_two_stages():
    a = answers(
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_age=45,
        semi_fire_net_monthly=4_500,
        semi_fire_savings_monthly=500,
    )
    stages = accumulation_stages(a)
    assert [stage.name for stage in stages] == [
        "Akumulacja do emerytury",
        "Coast FIRE (część etatu)",
    ]
    assert stages[0].start_age == 35
    assert stages[0].end_age == 45
    assert stages[1].start_age == 45
    assert stages[1].end_age == 55
    assert "gotowka" in stages[1].accounts or "broker" in stages[1].accounts


def test_barista_fire_creates_part_time_realization_stage():
    a = answers(
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=48,
        semi_fire_net_monthly=4_000,
    )
    stages = build_stages(a).stages
    barista = next(
        stage for stage in stages if stage.name == "Częściowe FIRE (praca + portfel)"
    )
    assert barista.stage_type == "realizacja"
    assert barista.start_age == 48
    assert barista.end_age == 55
    assert barista.part_time_net_monthly == pytest.approx(4_000)
    assert barista.part_time_zus_base > 0


def test_mortgage_redirect_splits_accumulation_at_payoff_age():
    a = answers(
        mortgage_monthly=3_000,
        mortgage_end_age=45,
        redirect_mortgage_to_savings=True,
    )
    stages = accumulation_stages(a)
    assert [stage.name for stage in stages] == [
        "Akumulacja (z kredytem)",
        "Akumulacja (po spłacie kredytu)",
    ]
    assert stages[0].start_age == 35
    assert stages[0].end_age == 45
    assert stages[1].start_age == 45
    assert stages[1].end_age == 55
