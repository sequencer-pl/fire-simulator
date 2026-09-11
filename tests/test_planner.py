"""Wizard planner — stage builder, three plan paths, guarantee metric."""

import pytest
from pydantic import ValidationError

import app.simulation.planner as P
from app.simulation.planner import WizardAnswers, plan
from app.simulation.schemas import SimulationInput

BASE = dict(
    gender="m",
    age_now=30,
    employment="etat",
    gross_monthly=8000,
    capital={"broker": 100_000},
    use_ppk=True,
    savings_mode="amount",
    savings=1000,
    strategy="zbilansowana",
    retire_early_age=55,
)


def answers(**over):
    merged = dict(BASE)
    merged.update(over)
    return WizardAnswers(**merged)


# --- Stage structure -------------------------------------------------------


@pytest.mark.parametrize("path", [1, 2, 3])
def test_all_paths_return_valid_input(path):
    target = 6000 if path in (2, 3) else None
    r = plan(path, answers(), target)
    data: SimulationInput = r.input
    assert data.stages
    assert data.gender == "m"
    order = [(s.stage_type, s.start_age, s.end_age) for s in data.stages]
    # chronological and non-overlapping (end exclusive)
    for (_t1, _s1, e1), (t2, s2, _e2) in zip(order, order[1:], strict=False):
        assert t2 == "akumulacja" or t2 == "realizacja"
        assert e1 <= s2
    assert order[-1][0] == "realizacja"


def test_path1_has_bridge_when_re_below_retirement():
    r = plan(1, answers(retire_early_age=55))
    types = [s.stage_type for s in r.input.stages]
    assert types == ["akumulacja", "akumulacja", "realizacja"]
    bridge = r.input.stages[1]
    assert "zus" not in bridge.accounts
    assert "ppk" not in bridge.accounts
    assert "broker" in bridge.accounts


def test_no_bridge_when_re_equals_retirement():
    r = plan(1, answers(retire_early_age=65))
    assert [s.stage_type for s in r.input.stages] == ["akumulacja", "realizacja"]


def test_accumulation_includes_zus_and_ppk():
    r = plan(1, answers())
    stage_a = r.input.stages[0]
    assert "zus" in stage_a.accounts
    assert "ppk" in stage_a.accounts
    assert stage_a.accounts["ppk"].monthly_base == 8000
    assert stage_a.accounts["ppk"].employee_pct == 0.02


def test_only_used_accounts_appear():
    r = plan(1, answers())
    stage_a = r.input.stages[0]
    assert "lokata" not in stage_a.accounts
    assert "krypto" not in stage_a.accounts
    r2 = plan(1, answers(use_lokata=True, use_krypto=True, capital={"lokata": 5000}))
    stage_a2 = r2.input.stages[0]
    assert "lokata" in stage_a2.accounts
    assert "krypto" in stage_a2.accounts


def test_advanced_instruments_ok():
    r = plan(
        1,
        answers(
            use_ikze=True,
            use_ike=True,
            use_oipe=True,
            use_oki_inw=True,
            use_oki_osk=True,
            capital={"ikze": 20000, "ike": 50000},
        ),
    )
    stage_a = r.input.stages[0]
    for k in ("ikze", "ike", "oipe", "oki_inw", "oki_osk"):
        assert k in stage_a.accounts


def test_b2b_ikze_limit_field():
    r = plan(1, answers(employment="b2b", use_ikze=True, capital={"ikze": 1000}))
    ikze = r.input.stages[0].accounts["ikze"]
    assert ikze.ikze_limit == "self_employed"


def test_realization_mirrors_accumulation():
    r = plan(1, answers())
    acc = set(r.input.stages[0].accounts) | set(r.input.stages[1].accounts)
    real = set(r.input.stages[-1].accounts)
    assert real == acc


def test_capital_seeded_even_without_stage_a():
    a = WizardAnswers(
        gender="m",
        age_now=60,
        employment="niepracujacy",
        gross_monthly=0,
        capital={"broker": 400_000},
        plan_end_age=90,
        savings=0,
        savings_mode="amount",
    )
    r = plan(1, a)
    assert r.projection.min_monthly > 0
    assert r.input.stages[-1].stage_type == "realizacja"


# --- Guarantee metric -------------------------------------------------------


def test_guarantee_sane_on_path1():
    r = plan(1, answers())
    p = r.projection
    assert p.min_monthly <= p.mean_monthly
    assert p.min_monthly > 0
    assert p.final_wealth >= 0


def test_exhaust_reported_when_plan_runs_out():
    a = WizardAnswers(
        gender="m",
        age_now=70,
        employment="niepracujacy",
        gross_monthly=0,
        capital={"broker": 10_000},
        plan_end_age=101,
        savings=0,
        savings_mode="amount",
    )
    r = plan(1, a)
    # tiny capital over 30 years cannot keep a meaningful annuity to the end
    assert r.projection.min_monthly < 500


# --- Path 2: required savings -----------------------------------------------


def test_path2_solves_required_savings():
    target = 15_000
    r = plan(2, answers(savings=100), target)
    assert r.solved.feasible
    assert r.solved.savings_monthly > 0
    assert r.projection.met
    assert r.projection.min_monthly >= target - 1


def test_path2_zero_savings_when_already_met():
    r = plan(2, answers(savings=100), 6000)
    assert r.solved.feasible
    assert r.solved.savings_monthly == 0
    assert r.projection.met


def test_path2_pct_conversion():
    r = plan(2, answers(savings_mode="pct", savings=10), 15_000)
    assert r.solved.savings_pct is not None


def test_path2_infeasible_target():
    r = plan(2, answers(), 99_000)
    assert not r.solved.feasible
    assert not r.projection.met


# --- Path 3: earliest FIRE age ----------------------------------------------


def test_path3_finds_earliest_fire_age():
    r = plan(3, answers(savings=500), 6000)
    assert r.solved.feasible
    assert r.solved.retire_early_age is not None
    re = r.solved.retire_early_age
    assert answers().age_now < re <= answers().retire_early_age
    assert r.projection.met


def test_path3_monotonic_in_re():
    a = answers()
    prev = -1.0
    for re in range(31, 66, 5):
        m = P._evaluate(P._vary_re(a, re), None).min_monthly
        assert m >= prev
        prev = m


def test_path3_infeasible():
    r = plan(3, answers(), 99_000)
    assert not r.solved.feasible


# --- Input/solver hygiene ---------------------------------------------------


def test_bisection_converges_accuracy():
    target = 12_000
    r = plan(2, answers(savings=50), target)
    assert r.projection.min_monthly >= target - 1


def test_invalid_answers_rejected():
    with pytest.raises(ValidationError):
        WizardAnswers(age_now=200)
    with pytest.raises(ValidationError):
        WizardAnswers(employment="xyz")


def test_missing_target_raises():
    with pytest.raises(ValueError):
        plan(2, answers())


# --- API surface ------------------------------------------------------------


def test_api_path1(client):
    resp = client.post(
        "/api/wizard/plan",
        json={"path": 1, "answers": dict(BASE, capital={"broker": 50_000})},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["projection"]["min_monthly"] > 0
    assert body["input"]["stages"]


def test_api_path2(client):
    resp = client.post(
        "/api/wizard/plan",
        json={"path": 2, "target_monthly": 12_000, "answers": dict(BASE)},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["solved"]["savings_monthly"] > 0


def test_api_missing_target_400(client):
    resp = client.post("/api/wizard/plan", json={"path": 2, "answers": dict(BASE)})
    assert resp.status_code == 400


def test_api_invalid_path_422(client):
    resp = client.post("/api/wizard/plan", json={"path": 9, "answers": dict(BASE)})
    assert resp.status_code == 422
