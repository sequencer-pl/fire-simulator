"""Asystent — route, B2B oraz etapy Coast/Barista FIRE i kredytu."""

from pathlib import Path

import pytest

from app.simulation.config import default_config
from app.simulation.planner import WizardAnswers, build_stages
from app.simulation.salary import b2b_net_from_gross

ROOT = Path(__file__).resolve().parents[1]

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


def test_wizard_renders_single_assistant(client):
    resp = client.get("/wizard")
    assert resp.status_code == 200
    text = resp.text
    assert "/static/js/wizard.js" in text
    assert 'id="wzSheltersPicker"' in text
    assert 'id="wzSuggestList"' in text
    assert 'id="wzNextBtn"' in text
    assert 'id="wzStepCount"' in text
    assert 'id="wzAge" class="acc-field" value="40"' in text
    assert "wizard-v1" not in text
    assert "wizard-v2" not in text


def test_legacy_wizard_routes_redirect_to_canonical_wizard(client):
    for path in ("/wizard-v1", "/wizard-v2"):
        resp = client.get(path, follow_redirects=False)
        assert resp.status_code in (307, 308)
        assert resp.headers["location"] == "/wizard"


def test_wizard_sources_have_no_legacy_v2_prefix():
    for rel in (
        "app/templates/wizard.html",
        "static/css/wizard.css",
        "qa/jsdom/wizard-repro.mjs",
        "qa/visual/wizard-interactions.spec.js",
    ):
        text = (ROOT / rel).read_text(encoding="utf-8").lower()
        assert "v2" not in text, rel

    js = (ROOT / "static/js/wizard.js").read_text(encoding="utf-8").lower()
    js = js.replace("fire.wizardv2state", "").replace("fire.wizardv2plan", "")
    assert "v2" not in js


def test_legacy_library_and_login_routes_redirect_to_comparison(client):
    for path in ("/moje-symulacje", "/login"):
        resp = client.get(path, follow_redirects=False)
        assert resp.status_code in (307, 308)
        assert resp.headers["location"] == "/compare"


def test_compare_evaluate_runs_without_session(client):
    payload = {
        "items": [
            {
                "name": "Plan z pliku",
                "input": {
                    "stages": [
                        {
                            "stage_type": "akumulacja",
                            "name": "Akumulacja",
                            "start_age": 40,
                            "end_age": 50,
                            "accounts": {
                                "broker": {
                                    "starting_balance": 100_000,
                                    "roi": 0.05,
                                    "annual_contribution": 12_000,
                                }
                            },
                        }
                    ],
                    "max_age": 50,
                },
            }
        ]
    }
    resp = client.post("/api/compare/evaluate", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["from_json"] is True
    assert body[0]["summary"]["years"] == 10


def test_simulator_restore_links_use_single_wizard(client):
    resp = client.get("/sim")
    assert resp.status_code == 200
    assert 'id="wizardDraftBackLink"' in resp.text

    js = (ROOT / "static/js/simulator.js").read_text(encoding="utf-8")
    assert 'const restoreHref = "/wizard?restore=1";' in js
    assert "loadedDraftSource" not in js
    assert "wizard-v1" not in js


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


def test_ppk_and_ppe_can_contribute_together():
    a = answers(
        use_ppk=True,
        use_ppe=True,
        ppk_contributions=True,
        ppe_contributions=True,
        capital={"ppk": 10_000, "ppe": 20_000},
    )
    stage = accumulation_stages(a)[0]
    assert stage.accounts["ppk"].starting_balance == pytest.approx(10_000)
    assert stage.accounts["ppk"].employee_pct == pytest.approx(0.02)
    assert stage.accounts["ppe"].starting_balance == pytest.approx(20_000)
    assert stage.accounts["ppe"].employer_pct == pytest.approx(0.035)


def test_ppk_balance_only_has_no_new_contributions():
    a = answers(
        employment="b2b",
        gross_monthly=20_000,
        b2b_tax_form="liniowy",
        use_ppk=True,
        ppk_contributions=False,
        capital={"ppk": 50_000},
    )
    stage = accumulation_stages(a)[0]
    ppk = stage.accounts["ppk"]
    assert ppk.starting_balance == pytest.approx(50_000)
    assert ppk.monthly_base == 0
    assert ppk.employee_pct == 0
    assert ppk.employer_pct == 0
    assert ppk.state_topups is False


def test_ppe_balance_survives_without_current_employment():
    a = answers(
        employment="niepracujacy",
        gross_monthly=0,
        use_ppe=True,
        ppe_contributions=False,
        capital={"ppe": 50_000, "broker": 100_000},
        savings=0,
    )
    stages = accumulation_stages(a)
    assert any("ppe" in stage.accounts for stage in stages)
    ppe_stage = next(stage for stage in stages if "ppe" in stage.accounts)
    assert ppe_stage.accounts["ppe"].starting_balance == pytest.approx(50_000)
    assert ppe_stage.accounts["ppe"].monthly_base == 0
    assert ppe_stage.accounts["ppe"].employer_pct == 0


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


def test_landing_notes_precede_nav_cards(client):
    resp = client.get("/")
    assert resp.status_code == 200
    text = resp.text
    hero = text.index("Zaplanuj swoją drogę")
    notes = text.index("Zanim zaczniesz planować")
    nav = text.index("Dostępne sekcje")
    assert hero < notes < nav
    assert "Sześć pytań" not in text
    assert "Krótkie pytania dopasowane do Twojej sytuacji" in text
    assert "Porównywarka" in text
    assert "Moje symulacje" not in text
