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
    assert types == ["akumulacja", "realizacja", "realizacja", "realizacja"]
    bridge = r.input.stages[1]
    supplement = r.input.stages[2]
    assert bridge.start_age == 55
    assert bridge.end_age == 65
    assert "zus" not in bridge.accounts
    assert "ppk" in bridge.accounts
    assert "broker" in bridge.accounts
    assert supplement.start_age == 65
    assert "zus" not in supplement.accounts
    zus_stage = r.input.stages[3]
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
    zus_stage = set(r.input.stages[-1].accounts)
    # The non-ZUS portfolio is realized from the FIRE age; ZUS stays in
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
    assert types.count("realizacja") == 3
    bridge, supplement, zus = r.input.stages[1], r.input.stages[2], r.input.stages[3]
    assert bridge.end_age == 65
    assert supplement.start_age == 65
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


def test_path2_oki_asset_tax_does_not_break_solver():
    # OKI's 0.85% asset tax grows with the balance: at very high savings the
    # net payout can drop below the target, so the "provably sufficient" upper
    # bound is unreachable. The solver must still find the feasible low range.
    a = WizardAnswers(
        gender="m",
        age_now=40,
        employment="etat",
        gross_monthly=12_000,
        plan_end_age=77,
        savings=1000,
        retire_early_age=55,
        retirement_age=65,
        assumptions="realne",
        strategy="zbilansowana",
        allocations={"ike": 45.23, "ikze": 18.09, "oki_inw": 36.68},
    )
    r = plan(2, a, 4000)
    assert r.solved.feasible
    assert r.solved.savings_monthly < 5000
    assert r.projection.met
    assert r.projection.min_monthly >= 4000 - 1


def test_path2_pool_estimate_survives_oki_asset_tax():
    a = WizardAnswers(
        gender="m",
        age_now=40,
        employment="etat",
        gross_monthly=12_000,
        plan_end_age=77,
        savings=1000,
        retire_early_age=55,
        retirement_age=65,
        assumptions="realne",
        strategy="zbilansowana",
    )
    estimate = P.estimate_pool_monthly(a, 2, 4000)
    assert 0 < estimate < 5000


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
    r = plan(2, answers(), 15_000)
    assert r.solved.savings_pct is not None
    assert r.net_monthly is not None


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
    )
    r = plan(3, a, 4000)
    assert r.solved.feasible
    assert r.solved.retire_early_age is not None
    assert r.projection.met


# --- Stage metrics ----------------------------------------------------------


def test_stage_metrics_cover_all_stages_and_split_zus():
    r = plan(2, answers(use_zus=True, capital={"broker": 100_000}), 5000)
    metrics = r.projection.stage_metrics
    assert [m.name for m in metrics] == [s.name for s in r.input.stages]

    accum, bridge, supplement, zus = metrics
    assert accum.stage_type == "akumulacja"
    assert accum.monthly > 0
    assert bridge.stage_type == "realizacja"
    assert bridge.monthly > 0
    assert supplement.start_age == zus.start_age == 65
    assert supplement.monthly > 0
    assert zus.monthly > 0
    # The overlapping rows are components of the same payout, not two totals.
    assert supplement.monthly + zus.monthly > zus.monthly


def test_scenario_stage_metrics_follow_market_assumptions():
    r = plan(1, answers(capital={"broker": 200_000}))
    real = r.scenario_projections["realne"].stage_metrics
    cautious = r.scenario_projections["konserwatywne"].stage_metrics
    assert real and cautious
    assert [m.monthly for m in real] != [m.monthly for m in cautious]


# --- Market scenarios -------------------------------------------------------


def test_scenarios_cover_all_three_and_are_internally_consistent():
    r = plan(1, answers(capital={"broker": 100_000}), None)
    keys = ["konserwatywne", "realne", "optymistyczne"]
    assert list(r.scenarios) == keys
    assert list(r.scenario_projections) == keys
    assert list(r.scenario_solved) == keys
    assert list(r.scenario_inputs) == keys
    for key in keys:
        summary = r.scenarios[key]
        proj = r.scenario_projections[key]
        solved = r.scenario_solved[key]
        assert summary.assumptions == key
        assert summary.feasible == (solved.feasible and proj.met)
        assert summary.payout_monthly == pytest.approx(round(proj.min_monthly))
        assert summary.final_wealth == pytest.approx(proj.final_wealth)
        assert summary.peak_wealth == pytest.approx(proj.peak_wealth)


def test_scenarios_payout_ordering_path1():
    r = plan(1, answers(capital={"broker": 200_000}), None)
    payouts = [r.scenarios[k].payout_monthly for k in ("konserwatywne", "realne", "optymistyczne")]
    assert payouts[0] < payouts[1] < payouts[2]


def test_scenarios_savings_ordering_path2():
    r = plan(2, answers(), 6000)
    savings = [r.scenarios[k].savings_monthly for k in ("konserwatywne", "realne", "optymistyczne")]
    assert savings[0] > savings[1] > savings[2]
    assert r.scenario_solved["realne"].savings_monthly == pytest.approx(
        r.solved.savings_monthly
    )


def test_scenarios_fire_age_ordering_path3():
    a = answers(
        savings=1500,
        allocations={"broker": 100},
        capital={"broker": 1_000_000},
    )
    r = plan(3, a, 6000)
    ages = [r.scenarios[k].retire_early_age for k in ("konserwatywne", "realne", "optymistyczne")]
    assert all(age is not None for age in ages)
    assert ages[0] > ages[1] > ages[2]


def test_scenario_selected_in_answers_reuses_main_result():
    a = answers(assumptions="konserwatywne", capital={"broker": 100_000})
    r = plan(1, a, None)
    assert r.scenario_projections["konserwatywne"] == r.projection
    assert r.scenario_solved["konserwatywne"] == r.solved


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
    assert body["projection"]["stage_metrics"]
    assert list(body["scenarios"]) == ["konserwatywne", "realne", "optymistyczne"]
    assert list(body["scenario_projections"]) == ["konserwatywne", "realne", "optymistyczne"]
    assert list(body["scenario_solved"]) == ["konserwatywne", "realne", "optymistyczne"]
    assert (
        body["scenario_projections"]["realne"]["min_monthly"]
        == body["projection"]["min_monthly"]
    )
    assert (
        body["scenario_projections"]["realne"]["stage_metrics"]
        == body["projection"]["stage_metrics"]
    )


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
    )
    alloc = _resolve_allocation(a, default_config(), 12_000)
    limits = default_config().limits
    assert abs(alloc.get("ikze", 0) - limits.ikze_annual) < 0.01
    assert alloc.get("gotowka", 0) > 0


def test_allocation_ikze_b2b_cap_clamp():
    limits = default_config().limits
    etat = _resolve_allocation(
        answers(allocations={"ikze": 100}, use_ikze=True, savings=2000),
        default_config(),
        24_000,
    )
    b2b = _resolve_allocation(
        answers(
            allocations={"ikze": 100},
            use_ikze=True,
            employment="b2b",
            savings=2000,
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


def test_suggest_capital_holder_opens_shelter():
    # BASE capital: broker 100k (use_broker off). Broker is an unlimited account,
    # so the "magic" first fills a tax shelter instead of parking 100% in broker.
    out = suggest_allocations(answers(allocations={}), default_config(), 12_000)
    assert out == {"ike": 100.0}


def test_capital_payroll_instruments_seeded():
    a = answers(
        use_ppk=True,
        use_ppe=True,
        capital={"ppk": 50_000, "ppe": 20_000, "zus": 100_000},
        allocations={},
    )
    accum = P.build_stages(a).stages[0].accounts
    assert accum["ppk"].starting_balance == 50_000
    assert accum["ppe"].starting_balance == 20_000
    assert accum["zus"].starting_balance == 100_000


def test_suggest_minimal_single_account_for_small_pool():
    # 2 000 zł/rok → jedno konto (pierwsza kuratowana ulga), nie 15 kont.
    a = answers(allocations={}, capital={})
    s = suggest_allocations(a, default_config(), 2_000)
    assert set(s) == {"ike"}
    assert abs(s["ike"] - 100.0) < 0.01


def test_suggest_fills_capacity_then_adds_accounts():
    # 40k/rok: ikze 28 260 + ikze 11 304 (limit etat) + oki_inw na resztę —
    # kolejne konto otwierane dopiero przy przekroczeniu limitu poprzedniego.
    a = answers(allocations={}, capital={})
    s = suggest_allocations(a, default_config(), 40_000)
    assert abs(s["ike"] - 70.65) < 0.05
    assert abs(s["ikze"] - 28.26) < 0.05
    assert abs(s["oki_inw"] - 1.09) < 0.05
    assert sum(s.values()) <= 100 + 1e-6


def test_suggest_equal_capacity_fills_shelters_first():
    # ikze/ike/oipe/broker: ulgi (posiadane) wypełniane do limitów, broker bez
    # udziału — broker (bez limitu) dostaje dopiero nadwyżkę ponad pojemność ulg.
    a = answers(allocations={}, use_ikze=True, use_ike=True, use_oipe=True, use_broker=True)
    small = suggest_allocations(a, default_config(), 40_000)
    assert small == {"ike": 70.65, "ikze": 28.26, "oipe": 1.09}
    large = suggest_allocations(a, default_config(), 200_000)
    assert large == {
        "ike": 14.13, "ikze": 5.65, "oipe": 14.13, "oki_inw": 66.09,
    }


def test_suggest_sole_active_account_opens_shelters():
    # Agresywna, sam krypto: kuratowane ulgi ike+ikze+oipe do limitów, reszta
    # (43,48%) do brokera (w pref agresywnej, bez limitu).
    s = suggest_allocations(
        answers(strategy="agresywna", allocations={}, capital={}, use_krypto=True),
        default_config(),
        120_000,
    )
    assert s == {"ike": 23.55, "ikze": 9.42, "oipe": 23.55, "broker": 43.48}


def test_suggest_konserwatywna_fills_ikze_then_ike():
    """Konserwatywna: pref ikze przed ike — ulgi wypełniane do limitów (60k)."""
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
    assert s == {"ikze": 18.84, "ike": 47.10, "oipe": 34.06}


def test_suggest_agresywna_fills_shelters_then_broker():
    """Agresywna: ulgi ike+ikze+oipe, nadwyżka do brokera (bez limitu)."""
    s = suggest_allocations(
        answers(
            strategy="agresywna",
            allocations={},
            use_krypto=True,
            use_broker=True,
            use_obligacje=True,
            use_lokata=True,
        ),
        default_config(),
        90_000,
    )
    assert s == {"ike": 31.40, "ikze": 12.56, "oipe": 31.40, "broker": 24.64}


def test_suggest_strategy_decides_which_shelter_opens():
    # Krypto+obligacje, brak kapitału: konserwatywna otwiera IKZE (obligacje już
    # ma, dalej w pref ikze), zbilansowana — IKE (pierwsza w pref).
    cons = suggest_allocations(
        answers(
            strategy="konserwatywna",
            allocations={},
            capital={},
            use_krypto=True,
            use_obligacje=True,
        ),
        default_config(),
        12_000,
    )
    zbil = suggest_allocations(
        answers(
            strategy="zbilansowana",
            allocations={},
            capital={},
            use_krypto=True,
            use_obligacje=True,
        ),
        default_config(),
        12_000,
    )
    assert abs(cons["ikze"] - 94.20) < 0.05
    assert abs(cons["ike"] - 5.80) < 0.05
    assert zbil == {"ike": 100.0}


def test_suggest_ikze_b2b_higher_capacity():
    # b2b ma wyższy limit IKZE (16 956): ike+ikze pokrywają 40k bez oki_inw,
    # podczas gdy etat (11 304) wymaga dokładki na oki_inw.
    etat = suggest_allocations(answers(allocations={}, capital={}), default_config(), 40_000)
    b2b = suggest_allocations(
        answers(allocations={}, capital={}, employment="b2b"),
        default_config(),
        40_000,
    )
    assert abs(etat["ike"] - 70.65) < 0.05
    assert "oki_inw" in etat
    assert "oki_inw" not in b2b
    assert abs(b2b["ike"] - 70.65) < 0.05
    assert abs(b2b["ikze"] - 29.35) < 0.05
    assert sum(b2b.values()) <= 100 + 1e-6


def test_gotowka_accums_when_all_cash():
    a = answers(allocations={}, savings=1000)
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
    a = answers(allocations={}, savings=1000)
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


def test_suggest_endpoint_path2_returns_estimated_pool(client):
    resp = client.post(
        "/api/wizard/suggest",
        json={
            "path": 2,
            "target_monthly": 6000,
            "answers": dict(BASE, allocations={}),
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pool_monthly"] > 0
    assert sum(body["allocations"].values()) <= 100 + 1e-6


def test_suggest_endpoint_path2_oki_flow_is_feasible(client):
    payload = {
        "gender": "m",
        "age_now": 40,
        "employment": "etat",
        "gross_monthly": 12_000,
        "savings": 1000,
        "retire_early_age": 55,
        "retirement_age": 65,
        "plan_end_age": 77,
        "strategy": "zbilansowana",
        "assumptions": "realne",
        "allocations": {},
    }
    resp = client.post(
        "/api/wizard/suggest",
        json={"path": 2, "target_monthly": 4000, "answers": payload},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pool_monthly"] < 5000
    a = WizardAnswers(**{**payload, "allocations": body["allocations"]})
    r = plan(2, a, 4000)
    assert r.solved.feasible
    assert r.projection.met


def test_b2b_zus_uses_flat_base():
    cfg = default_config()
    a = answers(employment="b2b", gross_monthly=25_000)
    data = P.build_stages(a)
    zus_acc = data.stages[0].accounts["zus"]
    assert zus_acc.monthly_base == pytest.approx(cfg.zus.b2b_base_monthly)


def test_bridge_protects_retirement_accounts_before_min_age():
    # Mając wystarczający kapitał na koncie maklerskim, w wieku 50-59 lat
    # brydż nie rusza IKE, PPK ani IKZE i nie generuje fałszywych ostrzeżeń.
    a = answers(
        age_now=45,
        retire_early_age=50,
        capital={"broker": 1_500_000, "ike": 100_000, "ikze": 100_000, "ppk": 50_000},
        use_ike=True,
        use_ikze=True,
        use_ppk=True,
        allocations={"broker": 100},
    )
    r = plan(3, a, 4000)
    assert r.solved.feasible
    assert not any("IKZE wypłacane" in w for w in r.projection.warnings)
    assert not any("IKE wypłacane" in w for w in r.projection.warnings)
