"""Wizard planner — stage builder, three plan paths, guarantee metric."""

import pytest
from pydantic import ValidationError

import app.simulation.planner as P
from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.planner import (
    WizardAnswers,
    _resolve_allocation,
    plan,
    suggest_allocations,
)
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
    # Stages are chronological; consecutive realizations (bridge + ZUS) may overlap.
    for (t1, _s1, e1), (t2, s2, _e2) in zip(order, order[1:], strict=False):
        assert t2 == "akumulacja" or t2 == "realizacja"
        assert e1 <= s2 or (t1 == "realizacja" and t2 == "realizacja")
    assert order[-1][0] == "realizacja"


def test_path1_has_bridge_when_re_below_retirement():
    r = plan(1, answers(retire_early_age=55))
    types = [s.stage_type for s in r.input.stages]
    assert types == ["akumulacja", "realizacja", "realizacja"]
    bridge = r.input.stages[1]
    assert "zus" not in bridge.accounts
    assert "ppk" in bridge.accounts
    assert "broker" in bridge.accounts
    zus_stage = r.input.stages[2]
    assert set(zus_stage.accounts) == {"zus"}
    assert zus_stage.start_age == 65


def test_no_bridge_when_re_equals_retirement():
    r = plan(1, answers(retire_early_age=65))
    types = [s.stage_type for s in r.input.stages]
    assert types == ["akumulacja", "realizacja", "realizacja"]
    bridge, zus_stage = r.input.stages[1], r.input.stages[2]
    assert bridge.start_age == bridge.end_age - (96 - 65)
    assert bridge.start_age == zus_stage.start_age == 65


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
    acc = set(r.input.stages[0].accounts)
    bridge = set(r.input.stages[1].accounts)
    zus_stage = set(r.input.stages[2].accounts)
    # The whole non-ZUS portfolio is realized from the FIRE age; ZUS stays in
    # its own realization stage — together they mirror the accumulation set.
    assert set(zus_stage) == {"zus"}
    assert bridge | zus_stage == acc


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


def test_bridge_realization_starts_at_fire_age():
    r = plan(1, answers(retire_early_age=55))
    bridge = r.input.stages[1]
    assert bridge.stage_type == "realizacja"
    assert bridge.start_age == 55


def test_path1_guarantees_constant_target():
    r = plan(1, answers())
    p = r.projection
    assert p.met
    assert p.target_monthly > 0
    assert p.exhaust_age is None
    # The gross-up drives the year-min up to the target: the guaranteed
    # take-home equals the reported target (mean above from portfolio growth).
    assert abs(p.min_monthly - p.target_monthly) < 2
    assert p.mean_monthly >= p.min_monthly


def test_path1_replay_keeps_guarantee():
    r = plan(1, answers())
    data: SimulationInput = r.input
    W = r.projection.target_monthly
    assert any(
        s.withdrawal_target_monthly > 0
        for s in data.stages
        if s.stage_type == "realizacja"
    )
    res = simulate(data)
    months = [
        y.monthly_withdrawal
        for y in res.years
        if any(
            s.start_age <= y.age < s.end_age
            for s in data.stages
            if s.stage_type == "realizacja"
        )
    ]
    assert min(months) >= W - 2


def test_realization_overlap_zus_starts_at_pension_age():
    r = plan(1, answers())
    types = [s.stage_type for s in r.input.stages]
    assert types.count("realizacja") == 2
    bridge, zus = r.input.stages[1], r.input.stages[2]
    assert zus.start_age == 65
    assert bridge.start_age < zus.start_age


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
    r = plan(2, answers(allocations={"broker": 100}), target)
    assert r.solved.feasible
    assert r.solved.savings_monthly > 0
    assert r.projection.met
    assert r.projection.min_monthly >= target - 1


def test_path2_zero_savings_when_already_met():
    # Big capital already guarantees the target with no extra savings.
    r = plan(
        2,
        answers(
            savings=0,
            allocations={"broker": 100},
            capital={"broker": 2_000_000},
        ),
        6000,
    )
    assert r.solved.feasible
    assert r.solved.savings_monthly == 0
    assert r.projection.met


def test_path2_pct_conversion():
    r = plan(2, answers(savings_mode="pct", savings=10), 15_000)
    assert r.solved.savings_pct is not None


def test_path2_returns_amount_even_when_exceeds_income():
    # No income cap: a "need to save more than the salary" is a signal, not an
    # error — surface it as a % of pay and a warning.
    r = plan(2, answers(), 99_000)
    assert r.solved.feasible
    assert r.solved.savings_monthly > answers().gross_monthly
    assert r.solved.savings_pct is not None
    assert r.projection.met
    assert any("przekraczają" in w for w in r.projection.warnings)


def test_path2_no_income_solves_amount():
    a = WizardAnswers(
        gender="m",
        age_now=35,
        employment="niepracujacy",
        gross_monthly=0,
        capital={"gotowka": 30_000},
        plan_end_age=90,
        savings=0,
        savings_mode="amount",
        allocations={"broker": 100},
        use_broker=True,
    )
    r = plan(2, a, 4000)
    assert r.solved.feasible
    assert r.solved.savings_monthly > 0
    assert r.solved.savings_pct is None
    assert r.projection.met


def test_unemployed_savings_create_accumulation_stage():
    a = WizardAnswers(
        gender="m",
        age_now=35,
        employment="niepracujacy",
        gross_monthly=0,
        savings=2000,
        savings_mode="amount",
        plan_end_age=90,
        allocations={"broker": 100},
        use_broker=True,
    )
    data = P.build_stages(a)
    assert data.stages[0].stage_type == "akumulacja"


# --- Path 3: earliest FIRE age ----------------------------------------------


def test_path3_finds_earliest_fire_age():
    a = answers(
        savings=1500,
        allocations={"broker": 100},
        capital={"broker": 1_000_000},
    )
    r = plan(3, a, 6000)
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


def test_path3_no_income_uses_capital():
    a = WizardAnswers(
        gender="m",
        age_now=30,
        employment="niepracujacy",
        gross_monthly=0,
        capital={"broker": 1_000_000},
        savings=0,
        savings_mode="amount",
    )
    r = plan(3, a, 4000)
    assert r.solved.feasible
    assert r.solved.retire_early_age is not None
    assert r.projection.met


# --- Input/solver hygiene ---------------------------------------------------


def test_bisection_converges_accuracy():
    target = 12_000
    r = plan(2, answers(allocations={"broker": 100}), target)
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


def test_api_path3(client):
    resp = client.post(
        "/api/wizard/plan",
        json={"path": 3, "target_monthly": 6_000, "answers": dict(BASE)},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["solved"]["retire_early_age"] is not None
    assert body["projection"]["met"] is True


def test_api_missing_target_400(client):
    resp = client.post("/api/wizard/plan", json={"path": 2, "answers": dict(BASE)})
    assert resp.status_code == 400


def test_api_invalid_path_422(client):
    resp = client.post("/api/wizard/plan", json={"path": 9, "answers": dict(BASE)})
    assert resp.status_code == 422


# --- Allocation model (cash-sink) ---------------------------------------------


def test_allocation_split():
    alloc = _resolve_allocation(answers(allocations={"broker": 100}), default_config(), 12_000)
    assert alloc.get("broker") == 12_000
    assert alloc.get("gotowka", 0) < 1e-6


def test_allocation_no_assignments_is_cash():
    a = answers(allocations={})
    alloc = _resolve_allocation(a, default_config(), 12_000)
    assert abs(alloc.get("gotowka", 0) - 12_000) < 0.01
    assert "broker" not in alloc


def test_allocation_split_multiple_accounts():
    a = answers(allocations={"broker": 50, "krypto": 50})
    alloc = _resolve_allocation(a, default_config(), 12_000)
    assert abs(alloc.get("broker", 0) - 6_000) < 1
    assert abs(alloc.get("krypto", 0) - 6_000) < 1
    assert abs(alloc.get("gotowka", 0)) < 1


def test_allocation_ikze_cap_clamp():
    a = answers(
        allocations={"ikze": 100},
        use_ikze=True,
        savings=1000,
        savings_mode="amount",
    )
    alloc = _resolve_allocation(a, default_config(), 12_000)
    limits = default_config().limits
    assert abs(alloc.get("ikze", 0) - limits.ikze_annual) < 0.01
    assert alloc.get("gotowka", 0) > 0


def test_allocation_ikze_b2b_cap_clamp():
    limits = default_config().limits
    etat = _resolve_allocation(
        answers(allocations={"ikze": 100}, use_ikze=True, savings=2000, savings_mode="amount"),
        default_config(),
        24_000,
    )
    b2b = _resolve_allocation(
        answers(
            allocations={"ikze": 100},
            use_ikze=True,
            employment="b2b",
            savings=2000,
            savings_mode="amount",
        ),
        default_config(),
        24_000,
    )
    assert abs(etat.get("ikze", 0) - limits.ikze_annual) < 0.01
    assert abs(b2b.get("ikze", 0) - limits.ikze_annual_self_employed) < 0.01
    assert etat.get("ikze", 0) < b2b.get("ikze", 0)


def test_allocation_over_100_rejected():
    with pytest.raises(ValidationError):
        answers(allocations={"broker": 60, "krypto": 50})


def test_allocation_unknown_account_rejected():
    with pytest.raises(ValidationError):
        answers(allocations={"gotowka": 100})


def test_suggest_equal_roi_split():
    """Zbilansowana: ike/ikze/oipe/broker all 6% → equal 25% each at modest pool."""
    a = answers(allocations={}, use_ikze=True, use_ike=True, use_oipe=True, use_broker=True)
    pool = 40_000
    s = suggest_allocations(a, default_config(), pool)
    for k in ("ikze", "ike", "oipe", "broker"):
        assert k in s
        assert abs(s[k] - 25.0) < 0.1
    assert sum(s.values()) <= 100 + 1e-6


def test_suggest_sole_active_account_gets_full_weight():
    """Agresywna: tylko krypto → całość na jedyne aktywne konto."""
    a = answers(allocations={}, use_krypto=True)
    s = suggest_allocations(a, default_config(), 120_000)
    assert abs(s.get("krypto", 0) - 100) < 0.1
    assert sum(s.values()) <= 100 + 1e-6


def test_suggest_equal_roi_split_large_pool():
    """Zbilansowana: ike/ikze/oipe/broker all 6% → equal 25% even at large pool
    (limits are applied later in _resolve_allocation, not in the suggestion)."""
    a = answers(allocations={}, use_ikze=True, use_ike=True, use_oipe=True, use_broker=True)
    s = suggest_allocations(a, default_config(), 200_000)
    for k in ("ikze", "ike", "oipe", "broker"):
        assert abs(s[k] - 25.0) < 0.1
    assert sum(s.values()) <= 100 + 1e-6


def test_suggest_weights_monotonic_by_roi():
    """Zbilansowana: strażnice (6%) dostają więcej niż lokata (4%)."""
    a = answers(allocations={}, use_ikze=True, use_ike=True, use_oipe=True, use_lokata=True)
    pool = 120_000
    s = suggest_allocations(a, default_config(), pool)
    assert abs(s["ikze"] - 30.0) < 0.1
    assert abs(s["ike"] - 30.0) < 0.1
    assert abs(s["oipe"] - 30.0) < 0.1
    assert abs(s["lokata"] - 10.0) < 0.1
    assert s["ikze"] > s["lokata"]
    assert sum(s.values()) <= 100 + 1e-6


def test_suggest_konserwatywna_prefers_safe():
    """Konserwatywna: strażnice (5%) dominują; broker/lokata (4%) mniej, ale >0."""
    a = answers(
        strategy="konserwatywna",
        allocations={},
        use_ikze=True,
        use_ike=True,
        use_oipe=True,
        use_broker=True,
        use_lokata=True,
    )
    s = suggest_allocations(a, default_config(), 60_000)
    for k in ("ikze", "ike", "oipe"):
        assert abs(s[k] - 26.53) < 0.1
    assert abs(s["broker"] - 10.2) < 0.1
    assert abs(s["lokata"] - 10.2) < 0.1
    assert s["ikze"] > s["lokata"]
    assert sum(s.values()) <= 100 + 1e-6


def test_suggest_agresywna_weights_higher_roi_more():
    """Agresywna: krypto (9%) > broker (8%) > obligacje (6%) > lokata (4%),
    a lokata nadal dostaje cząstkę (nigdy zero)."""
    a = answers(
        strategy="agresywna",
        allocations={},
        use_krypto=True,
        use_broker=True,
        use_obligacje=True,
        use_lokata=True,
    )
    s = suggest_allocations(a, default_config(), 90_000)
    assert s["krypto"] > s["broker"] > s["obligacje"] > s["lokata"] > 0
    assert abs(s["krypto"] - 42.31) < 0.1
    assert abs(s["lokata"] - 3.85) < 0.15
    assert sum(s.values()) <= 100 + 1e-6


def test_suggest_konserwatywna_punishes_risky_hardest():
    """Krypto vs obligacje (te same dwa konta): konserwatywna daje krypto MNIEJ
    niż zbilansowana — absolutny dystans stóp (2% vs 4,5%) jest tu sankcjonowany."""
    cons = suggest_allocations(
        answers(strategy="konserwatywna", allocations={}, use_krypto=True, use_obligacje=True),
        default_config(),
        12_000,
    )
    zbil = suggest_allocations(
        answers(strategy="zbilansowana", allocations={}, use_krypto=True, use_obligacje=True),
        default_config(),
        12_000,
    )
    assert abs(cons["krypto"] - 16.67) < 0.1
    assert abs(cons["obligacje"] - 83.33) < 0.1
    assert abs(zbil["krypto"] - 33.33) < 0.1
    assert abs(zbil["obligacje"] - 66.67) < 0.1
    assert cons["krypto"] < zbil["krypto"]
    assert cons["krypto"] < cons["obligacje"]
    assert zbil["krypto"] < zbil["obligacje"]


def test_suggest_no_activations_returns_empty():
    a = answers(allocations={})
    s = suggest_allocations(a, default_config(), 12_000)
    assert s == {}


def test_gotowka_accums_when_all_cash():
    a = answers(allocations={}, savings=1000, savings_mode="amount")
    r = plan(1, a)
    acc = r.input.stages[0].accounts
    assert "gotowka" in acc
    assert acc["gotowka"].annual_contribution > 0


def test_gotowka_absent_when_fully_allocated():
    a = answers(allocations={"broker": 100})
    r = plan(1, a)
    acc = r.input.stages[0].accounts
    assert "gotowka" not in acc


def test_gotowka_warning_present():
    a = answers(allocations={}, savings=1000, savings_mode="amount")
    r = plan(1, a)
    assert any("gotówce" in w for w in r.projection.warnings)


def test_gotowka_warning_absent_when_full():
    a = answers(allocations={"broker": 100})
    r = plan(1, a)
    assert not any("gotówce" in w for w in r.projection.warnings)


def test_path2_scales_balances_in_allocated_accounts():
    a = answers(allocations={"broker": 50, "krypto": 50}, savings=1000)
    r = plan(2, a, 10_000)
    assert r.solved.feasible
    acc = r.input.stages[0].accounts
    assert "broker" in acc
    assert "krypto" in acc


def test_suggest_endpoint(client):
    resp = client.post(
        "/api/wizard/suggest",
        json={"answers": dict(BASE, allocations={}, use_ikze=True, use_krypto=True)},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "allocations" in body
    assert sum(body["allocations"].values()) <= 100 + 1e-6
