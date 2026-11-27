"""Wizard planner — stage builder, three plan paths, guarantee metric."""

import copy

import pytest
from pydantic import ValidationError

import app.simulation.planner as P
from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.planner import (
    WizardAnswers,
    _resolve_allocation,
    suggest_allocation_plan,
    suggest_allocations,
    suggest_priority,
)
from app.simulation.planner import (
    plan as _plan,
)
from app.simulation.schemas import SimulationInput, StageInput, TemporaryObligation
from app.simulation.summary import lifestyle_monthly_net

_PLAN_CACHE: dict[tuple, P.WizardPlanResult] = {}


def plan(
    path: int, a: WizardAnswers, target: float | None = None, **kwargs
) -> P.WizardPlanResult:
    """Cache identycznych planów — solver jest deterministyczny, a testy często
    pytają o ten sam ``answers()``. Zwracamy kopię, żeby mutacje nie przeciekały."""
    kwargs.setdefault("scenarios", False)
    kwargs.setdefault("extend_chart", False)
    key = (path, a.model_dump_json(), target, tuple(sorted(kwargs.items())))
    if key not in _PLAN_CACHE:
        _PLAN_CACHE[key] = _plan(path, a, target, **kwargs)
    return copy.deepcopy(_PLAN_CACHE[key])


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


def test_target_is_budget_after_obligations():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=85,
        allocations={"broker": 100},
        obligations=[
            TemporaryObligation(
                name="Kredyt",
                monthly=2_000,
                start_age=55,
                end_age=60,
                redirect_to_savings=True,
            )
        ],
    )
    r = plan(2, a, 3_000)
    assert r.projection.target_monthly == pytest.approx(3_000)
    assert r.projection.min_monthly == pytest.approx(3_000, abs=1.0)
    assert r.projection.min_lifestyle_monthly == pytest.approx(3_000, abs=1.0)
    result = simulate(r.input)
    y55 = next(year for year in result.years if year.age == 55)
    y60 = next(year for year in result.years if year.age == 60)
    assert lifestyle_monthly_net(r.input, y55) >= 2_999
    # W latach z zobowiązaniem portfel dokłada 2 000 zł do budżetu.
    assert y55.monthly_withdrawal >= 4_900
    assert y60.monthly_withdrawal <= 3_100
    assert y55.monthly_withdrawal > y60.monthly_withdrawal
    names = [stage.name for stage in r.input.stages if stage.stage_type == "realizacja"]
    assert any("z zobowiązaniem" in name for name in names)
    assert any("po zobowiązaniu" in name for name in names)


def test_barista_obligation_target_below_part_time_gross_is_feasible():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 2_000_000},
        savings=0,
        use_broker=True,
        retire_early_age=50,
        plan_end_age=85,
        allocations={"broker": 100},
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=45,
        semi_fire_net_monthly=5_000,
        obligations=[
            TemporaryObligation(
                name="Zobowiązanie",
                monthly=6_000,
                start_age=45,
                end_age=50,
                redirect_to_savings=False,
            )
        ],
    )
    for target in (500, 1_000, 2_000):
        r = plan(2, a, target)
        assert r.projection.met
        assert r.projection.min_monthly >= target - 1


def test_budget_target_is_monotonic_with_barista_obligation():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 2_000_000},
        savings=0,
        use_broker=True,
        retire_early_age=50,
        plan_end_age=85,
        allocations={"broker": 100},
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=45,
        semi_fire_net_monthly=5_000,
        obligations=[
            TemporaryObligation(
                name="Zobowiązanie",
                monthly=6_000,
                start_age=45,
                end_age=50,
                redirect_to_savings=False,
            )
        ],
    )
    results = [plan(2, a, target).projection.met for target in (500, 1_000, 2_000)]
    assert results == [True, True, True]


def test_overlapping_obligations_keep_budget_target():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=85,
        allocations={"broker": 100},
        obligations=[
            TemporaryObligation(name="A", monthly=2_000, start_age=55, end_age=62),
            TemporaryObligation(name="B", monthly=1_500, start_age=58, end_age=70),
            TemporaryObligation(name="C", monthly=500, start_age=60, end_age=61),
        ],
    )
    r = plan(2, a, 3_000)
    assert r.projection.met
    assert r.projection.min_monthly == pytest.approx(3_000, abs=1.0)
    result = simulate(r.input)
    budgets = [
        lifestyle_monthly_net(r.input, year)
        for year in result.years
        if 55 <= year.age < 85
    ]
    assert min(budgets) >= 2_999


def test_solver_returned_input_matches_result_when_infeasible():
    a = answers(
        age_now=54,
        gross_monthly=5_000,
        capital={},
        savings=0,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        obligations=[
            TemporaryObligation(name="Zob", monthly=8_000, start_age=55, end_age=60)
        ],
    )
    data = P.build_stages(a)
    result = P._solve_stage_targets(data, 3_000)
    replay = simulate(data, None)
    values = [
        lifestyle_monthly_net(data, year)
        for year in replay.years
        if 55 <= year.age < 85
    ]
    assert min(values) == pytest.approx(
        min(
            lifestyle_monthly_net(data, year)
            for year in result.years
            if 55 <= year.age < 85
        ),
        abs=0.02,
    )
    assert replay.total_withdrawn == pytest.approx(result.total_withdrawn, abs=0.02)
    assert replay.final_wealth == pytest.approx(result.final_wealth, abs=0.02)


def test_coast_warning_includes_obligations():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_age=45,
        semi_fire_net_monthly=4_000,
        semi_fire_savings_monthly=0,
        obligations=[
            TemporaryObligation(name="Zob", monthly=2_000, start_age=45, end_age=50)
        ],
    )
    result = plan(2, a, 3_000)
    assert any(
        "Brakuje ok." in warning and "45 r.ż." in warning
        for warning in result.projection.warnings
    )


def test_logical_phases_keep_barista_and_no_zus_boundaries():
    barista = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=85,
        allocations={"broker": 100},
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=45,
        semi_fire_net_monthly=5_000,
        obligations=[
            TemporaryObligation(name="Zob", monthly=2_000, start_age=48, end_age=50)
        ],
    )
    result = plan(2, barista, 3_000)
    phases = {phase.key: phase for phase in result.projection.phase_metrics}
    assert (phases["partial_fire"].start_age, phases["partial_fire"].end_age) == (45, 55)
    assert (phases["bridge"].start_age, phases["bridge"].end_age) == (55, 65)
    assert all(
        not stage.name.endswith(("(z zobowiązaniem)", "(po zobowiązaniu)"))
        for stage in result.projection.stage_metrics
    )

    no_zus = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        use_zus=False,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        obligations=[
            TemporaryObligation(name="Zob", monthly=2_000, start_age=55, end_age=70)
        ],
    )
    result = plan(2, no_zus, 3_000)
    phases = {phase.key: phase for phase in result.projection.phase_metrics}
    assert (phases["bridge"].start_age, phases["bridge"].end_age) == (55, 65)
    assert (phases["retirement_topup"].start_age, phases["retirement_topup"].end_age) == (65, 85)


def test_many_obligations_do_not_hit_schema_stage_limit():
    obligations = [
        TemporaryObligation(
            name=f"Zob {index}",
            monthly=100,
            start_age=45 + index,
            end_age=50 + index,
        )
        for index in range(10)
    ]
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        obligations=obligations,
    )
    data = P.build_stages(a)
    assert len(data.stages) <= 128


def test_logical_stage_limit_is_checked_before_segments():
    stages = [
        StageInput(
            stage_type="akumulacja",
            name=f"Etap {index}",
            start_age=40 + index,
            end_age=41 + index,
        )
        for index in range(21)
    ]
    with pytest.raises(ValueError, match="20 etapów"):
        P._validate_logical_stages(stages)


def test_simulation_input_rejects_more_than_20_logical_stages():
    stages = [
        StageInput(
            stage_type="akumulacja",
            name=f"Etap {index}",
            start_age=40 + index,
            end_age=41 + index,
        )
        for index in range(21)
    ]
    with pytest.raises(ValidationError, match="20 etapów"):
        SimulationInput(stages=stages, max_age=60)
    segments = [
        StageInput(
            stage_type="realizacja",
            origin_stage_id=f"stage-{index % 20}",
            name=f"Segment {index}",
            start_age=40 + index,
            end_age=41 + index,
        )
        for index in range(30)
    ]
    assert len(SimulationInput(stages=segments, max_age=70).stages) == 30


def test_savings_upper_bound_includes_realization_obligations():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={},
        savings=0,
        use_broker=True,
        use_zus=False,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        roi_overrides={"broker": 0.0},
        obligations=[
            TemporaryObligation(
                name="Duże zobowiązanie",
                monthly=30_000,
                start_age=55,
                end_age=85,
            )
        ],
    )
    bound = P._savings_upper_bound(a, 1_000)
    assert bound > 48_000
    amount, feasible = P._solve_savings(a, 1_000)
    assert feasible
    assert amount > 48_000


def test_extend_chart_does_not_change_values_before_horizon():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 500_000},
        savings=3_000,
        use_broker=True,
        use_zus=False,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
    )
    base = plan(2, a, 3_000, extend_chart=False)
    extended = plan(2, a, 3_000, extend_chart=True)
    assert base.projection.met
    assert extended.projection.met
    assert base.projection.min_monthly == pytest.approx(
        extended.projection.min_monthly, abs=0.02
    )
    assert base.projection.final_wealth == pytest.approx(
        extended.projection.final_wealth, abs=0.02
    )
    upto = len(base.projection.chart.ages)
    assert extended.projection.chart.ages[:upto] == base.projection.chart.ages
    for key in ("lifestyle_monthly", "obligations_monthly", "part_time_monthly"):
        base_values = getattr(base.projection.chart, key)
        ext_values = getattr(extended.projection.chart, key)[:upto]
        assert ext_values == pytest.approx(base_values, abs=0.02)
    for account, values in base.projection.chart.withdrawals_net.items():
        assert extended.projection.chart.withdrawals_net[account][:upto] == pytest.approx(
            values, abs=0.02
        )
    for account, values in base.projection.chart.balances.items():
        assert extended.projection.chart.balances[account][:upto] == pytest.approx(
            values, abs=0.02
        )


def test_build_stages_marks_materialized_redirects():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 500_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        obligations=[
            TemporaryObligation(
                name="Zob",
                monthly=2_000,
                start_age=42,
                end_age=50,
                redirect_to_savings=True,
            )
        ],
    )
    assert P.build_stages(a).redirects_applied is True
    no_redirect = a.model_copy(
        update={
            "obligations": [
                TemporaryObligation(
                    name="Zob",
                    monthly=2_000,
                    start_age=42,
                    end_age=50,
                    redirect_to_savings=False,
                )
            ]
        },
        deep=True,
    )
    assert P.build_stages(no_redirect).redirects_applied is False


def test_redirect_uses_full_fire_as_coast_accumulation_end():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_age=45,
        semi_fire_net_monthly=4_000,
        semi_fire_savings_monthly=0,
        obligations=[
            TemporaryObligation(
                name="Zob",
                monthly=2_000,
                start_age=45,
                end_age=50,
                redirect_to_savings=True,
            )
        ],
    )
    data = P.build_stages(a)
    assert data.redirects_applied is True
    assert any(
        stage.stage_type == "akumulacja" and "po zobowiązaniu" in stage.name
        for stage in data.stages
    )


def test_redirect_is_ignored_when_coast_ends_at_fire():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_age=45,
        semi_fire_net_monthly=4_000,
        semi_fire_savings_monthly=0,
        obligations=[
            TemporaryObligation(
                name="Zob",
                monthly=2_000,
                start_age=55,
                end_age=60,
                redirect_to_savings=True,
            )
        ],
    )
    data = P.build_stages(a)
    assert data.redirects_applied is False
    assert not any(
        stage.stage_type == "akumulacja" and "po zobowiązaniu" in stage.name
        for stage in data.stages
    )


def test_redirect_is_ignored_when_barista_leaves_no_accumulation():
    base = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 2_000_000},
        savings=0,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=45,
        semi_fire_net_monthly=5_000,
    )
    enabled = base.model_copy(
        update={
            "obligations": [
                TemporaryObligation(
                    name="Zob",
                    monthly=2_000,
                    start_age=48,
                    end_age=50,
                    redirect_to_savings=True,
                )
            ]
        },
        deep=True,
    )
    disabled = base.model_copy(
        update={
            "obligations": [
                TemporaryObligation(
                    name="Zob",
                    monthly=2_000,
                    start_age=48,
                    end_age=50,
                    redirect_to_savings=False,
                )
            ]
        },
        deep=True,
    )
    with_redirect = P.build_stages(enabled)
    without_redirect = P.build_stages(disabled)
    assert with_redirect.redirects_applied is False
    assert without_redirect.redirects_applied is False
    assert [
        (stage.name, stage.start_age, stage.end_age, stage.accounts)
        for stage in with_redirect.stages
        if stage.stage_type == "akumulacja"
    ] == [
        (stage.name, stage.start_age, stage.end_age, stage.accounts)
        for stage in without_redirect.stages
        if stage.stage_type == "akumulacja"
    ]


def test_redirect_is_ignored_when_obligation_ends_after_fire():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 800_000},
        savings=3_000,
        use_broker=True,
        retire_early_age=55,
        plan_end_age=85,
        allocations={"broker": 100},
        obligations=[
            TemporaryObligation(
                name="Kredyt",
                monthly=2_000,
                start_age=55,
                end_age=60,
                redirect_to_savings=True,
            )
        ],
    )
    data = P.build_stages(a)
    accumulation = [stage for stage in data.stages if stage.stage_type == "akumulacja"]
    assert len(accumulation) == 1
    assert accumulation[0].end_age == 55
    assert not any("po zobowiązaniu" in stage.name for stage in accumulation)


def test_tiny_allocation_residual_does_not_create_cash():
    a = answers(
        age_now=40,
        savings=7000,
        use_ike=True,
        use_ikze=True,
        use_oipe=True,
        use_broker=True,
        gross_monthly=20500,
        allocations={"broker": 19.26, "ike": 33.64, "ikze": 13.46, "oipe": 33.64},
    )
    alloc = _resolve_allocation(a, default_config(), 84_000)
    assert alloc.get("gotowka", 0) == 0
    assert alloc["broker"] == pytest.approx(16_180.8, abs=0.01)
    assert alloc["ikze"] == pytest.approx(11_304, abs=0.01)


def test_tiny_cash_contribution_does_not_trigger_warning():
    def project(annual: float):
        data = SimulationInput(
            stages=[
                P.StageInput(
                    stage_type="akumulacja",
                    start_age=40,
                    end_age=47,
                    accounts={
                        "gotowka": P.AccountConfig(annual_contribution=annual)
                    },
                )
            ],
            config=default_config(),
        )
        proj = P.PlanProjection()
        P._append_cash_warning(proj, data)
        return proj

    assert project(2.0).warnings == []
    assert any("Z oszczędności 2 zł/mies." in w for w in project(24.0).warnings)


# --- Stage structure -------------------------------------------------------


@pytest.mark.parametrize("path", [1, 2, 3])
@pytest.mark.slow
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


@pytest.mark.slow
def test_no_bridge_when_re_equals_retirement():
    r = plan(1, answers(retire_early_age=65))
    types = [s.stage_type for s in r.input.stages]
    assert types == ["akumulacja", "realizacja", "realizacja"]
    bridge, zus_stage = r.input.stages[1], r.input.stages[2]
    assert bridge.start_age == bridge.end_age - (96 - 65)
    assert bridge.start_age == zus_stage.start_age == 65


@pytest.mark.slow
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


@pytest.mark.slow
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


@pytest.mark.slow
def test_b2b_ikze_limit_field():
    r = plan(1, answers(employment="b2b", use_ikze=True, capital={"ikze": 1000}))
    ikze = r.input.stages[0].accounts["ikze"]
    assert ikze.ikze_limit == "self_employed"


@pytest.mark.slow
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


@pytest.mark.slow
def test_path1_replay_keeps_guarantee():
    r = plan(1, answers())
    data: SimulationInput = r.input
    W = r.projection.target_monthly
    assert any(
        s.withdrawal_target_gross_monthly > 0
        for s in data.stages
        if s.stage_type == "realizacja"
    )
    res = simulate(data)
    months = [
        y.monthly_withdrawal
        for y in res.years
        if any(
            s.start_age <= y.age < s.end_age and "zus" not in s.accounts
            for s in data.stages
            if s.stage_type == "realizacja"
        )
    ]
    assert min(months) >= W - 2


@pytest.mark.slow
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


@pytest.mark.slow
def test_path2_solves_required_savings():
    target = 15_000
    r = plan(2, answers(allocations={"broker": 100}), target)
    assert r.solved.feasible
    assert r.solved.savings_monthly > 0
    assert r.projection.met
    assert r.projection.min_monthly >= target - 1


@pytest.mark.slow
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


@pytest.mark.slow
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


def test_wizard_longevity_growth_overrides_preset_value():
    a = answers(assumptions="realne", life_expectancy_growth_months_per_year=2.0)
    data = P.build_stages(a)
    assert data.config.longevity.growth_months_per_year == pytest.approx(2.0)


def test_wizard_longevity_growth_defaults_to_preset_value():
    a = answers(assumptions="realne")
    data = P.build_stages(a)
    assert data.config.longevity.growth_months_per_year == pytest.approx(1.5)


def test_wizard_realne_uses_saved_base_config():
    base = default_config()
    base.inflation = 0.07
    base.zus.waloryzacja_skladek = 0.0
    base.limits.ike_annual = 50_000
    a = answers(assumptions="realne", base_config=base)
    data = P.build_stages(a)
    assert data.config.inflation == pytest.approx(0.07)
    assert data.config.zus.waloryzacja_skladek == pytest.approx(0.0)
    assert data.config.limits.ike_annual == pytest.approx(50_000)


def test_wizard_market_overlay_keeps_saved_structural_config():
    base = default_config()
    base.kwota_wolna = 12_345
    base.zus.waloryzacja_skladek = 0.02
    a = answers(assumptions="konserwatywne", base_config=base)
    data = P.build_stages(a)
    assert data.config.kwota_wolna == pytest.approx(12_345)
    assert data.config.zus.waloryzacja_skladek == pytest.approx(0.01)
    assert data.config.inflation == pytest.approx(0.035)


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


def test_path3_can_find_fire_after_statutory_age():
    r = plan(3, answers(), 99_000)
    assert r.solved.feasible
    assert r.solved.retire_early_age is not None
    assert r.solved.retire_early_age > answers().retire_early_age


def test_path3_infeasible():
    r = plan(3, answers(), 1_000_000_000)
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


@pytest.mark.slow
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


@pytest.mark.slow
def test_scenario_stage_metrics_follow_market_assumptions():
    r = plan(1, answers(capital={"broker": 200_000}), scenarios=True)
    real = r.scenario_projections["realne"].stage_metrics
    cautious = r.scenario_projections["konserwatywne"].stage_metrics
    assert real and cautious
    assert [m.monthly for m in real] != [m.monthly for m in cautious]


# --- Timeline phase metrics -------------------------------------------------


@pytest.mark.slow
def test_phase_metrics_split_retirement_and_zus_beyond_horizon():
    r = plan(
        1,
        answers(
            retire_early_age=55,
            plan_end_age=77,
            capital={"broker": 200_000},
        ),
    )
    phases = r.projection.phase_metrics
    assert [p.key for p in phases] == [
        "accumulation",
        "bridge",
        "retirement_topup",
        "zus_only",
    ]

    accumulation, bridge, retirement, zus = phases
    assert accumulation.cashflow == "contribution"
    assert (accumulation.start_age, accumulation.end_age) == (30, 55)
    assert accumulation.monthly > 0
    assert (bridge.start_age, bridge.end_age) == (55, 65)
    assert bridge.monthly > 0
    assert (retirement.start_age, retirement.end_age) == (65, 77)
    assert retirement.name == "Emerytura + dopłata"
    assert retirement.portfolio_monthly > 0
    assert retirement.zus_monthly > 0
    assert retirement.monthly == pytest.approx(
        retirement.portfolio_monthly + retirement.zus_monthly, abs=0.05
    )
    assert (zus.start_age, zus.end_age) == (77, 100)
    assert zus.name == "Sama emerytura ZUS"
    assert zus.portfolio_monthly == 0
    assert zus.monthly == pytest.approx(zus.zus_monthly)
    assert zus.monthly > 0


@pytest.mark.slow
def test_phase_metrics_keep_all_accumulation_stages_before_bridge():
    r = plan(
        1,
        answers(
            age_now=40,
            retire_early_age=55,
            retirement_age=65,
            plan_end_age=95,
            mortgage_monthly=3000,
            mortgage_end_age=50,
            redirect_mortgage_to_savings=True,
        ),
    )
    phases = r.projection.phase_metrics
    accumulations = [phase for phase in phases if phase.key == "accumulation"]
    bridge = next(phase for phase in phases if phase.key == "bridge")

    assert [(phase.start_age, phase.end_age) for phase in accumulations] == [
        (40, 50),
        (50, 55),
    ]
    assert [phase.name for phase in accumulations] == [
        "Akumulacja do emerytury (z zobowiązaniem)",
        "Akumulacja do emerytury (po zobowiązaniu: Kredyt hipoteczny)",
    ]
    assert all(phase.monthly > 0 for phase in accumulations)
    assert bridge.start_age == 55
    assert bridge.end_age == 65

    simulation = simulate(r.input)
    accumulation_years = [year for year in simulation.years if 50 <= year.age < 55]
    payout_years = [year for year in simulation.years if 55 <= year.age < 65]
    assert accumulation_years
    assert all(year.monthly_withdrawal == 0 for year in accumulation_years)
    assert payout_years
    expected_bridge = round(
        sum(year.monthly_withdrawal for year in payout_years) / len(payout_years), 2
    )
    assert bridge.monthly == pytest.approx(expected_bridge)


@pytest.mark.slow
def test_phase_metrics_skip_bridge_when_re_equals_retirement():
    r = plan(1, answers(retire_early_age=65, plan_end_age=77))
    assert [p.key for p in r.projection.phase_metrics] == [
        "accumulation",
        "retirement_topup",
        "zus_only",
    ]


def test_phase_metrics_without_zus_end_at_plan_horizon():
    r = plan(1, answers(use_zus=False, plan_end_age=77))
    phases = r.projection.phase_metrics
    assert [p.key for p in phases] == [
        "accumulation",
        "bridge",
        "retirement_topup",
    ]
    assert phases[-1].name == "Emerytura z portfela"
    assert phases[-1].end_age == 77
    assert phases[-1].zus_monthly == 0


@pytest.mark.slow
def test_phase_metrics_no_zus_only_when_horizon_reaches_pension_end():
    r = plan(1, answers(plan_end_age=100))
    keys = [p.key for p in r.projection.phase_metrics]
    assert "zus_only" not in keys
    assert keys[-1] == "retirement_topup"
    assert r.projection.phase_metrics[-1].end_age == 100


def test_phase_metrics_merge_empty_portfolio_retirement_into_zus():
    r = plan(
        1,
        answers(
            capital={"zus": 300_000},
            use_ppk=False,
            use_ike=True,
            use_ikze=True,
            use_krypto=True,
            use_lokata=True,
            use_oipe=True,
            savings=3000,
            retire_early_age=50,
            plan_end_age=77,
        ),
    )
    phases = r.projection.phase_metrics
    assert [p.key for p in phases] == ["accumulation", "bridge", "zus_only"]
    assert phases[-1].name == "Emerytura ZUS"
    assert (phases[-1].start_age, phases[-1].end_age) == (65, 100)
    assert phases[-1].portfolio_monthly == 0
    assert phases[-1].monthly == pytest.approx(phases[-1].zus_monthly)


# --- Market scenarios -------------------------------------------------------


@pytest.mark.slow
def test_scenarios_cover_all_three_and_are_internally_consistent():
    r = plan(1, answers(capital={"broker": 100_000}), None, scenarios=True)
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


@pytest.mark.slow
def test_scenarios_payout_ordering_path1():
    r = plan(1, answers(capital={"broker": 200_000}), None, scenarios=True)
    payouts = [r.scenarios[k].payout_monthly for k in ("konserwatywne", "realne", "optymistyczne")]
    assert payouts[0] < payouts[1] < payouts[2]


@pytest.mark.slow
def test_scenarios_savings_ordering_path2():
    r = plan(2, answers(), 6000, scenarios=True)
    savings = [r.scenarios[k].savings_monthly for k in ("konserwatywne", "realne", "optymistyczne")]
    assert savings[0] > savings[1] > savings[2]
    assert r.scenario_solved["realne"].savings_monthly == pytest.approx(
        r.solved.savings_monthly
    )


@pytest.mark.slow
def test_scenarios_fire_age_ordering_path3():
    a = answers(
        savings=1500,
        allocations={"broker": 100},
        capital={"broker": 1_000_000},
    )
    r = plan(3, a, 6000, scenarios=True)
    ages = [r.scenarios[k].retire_early_age for k in ("konserwatywne", "realne", "optymistyczne")]
    assert all(age is not None for age in ages)
    assert ages[0] > ages[1] > ages[2]


@pytest.mark.slow
def test_scenario_selected_in_answers_reuses_main_result():
    a = answers(assumptions="konserwatywne", capital={"broker": 100_000})
    r = plan(1, a, None, scenarios=True)
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


@pytest.mark.slow
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
    assert body["projection"]["phase_metrics"]
    assert body["projection"]["chart"]["ages"]
    assert body["projection"]["chart"]["withdrawals_net"]
    assert body["projection"]["chart"]["balances"]
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
    assert (
        body["scenario_projections"]["realne"]["phase_metrics"]
        == body["projection"]["phase_metrics"]
    )


@pytest.mark.slow
def test_api_wizard_plan_uses_client_base_config(client):
    payload = {"path": 1, "answers": dict(BASE, capital={"broker": 50_000})}
    before = client.post("/api/wizard/plan", json=payload).json()

    base = default_config()
    base.inflation = 0.10
    base.zus.waloryzacja_skladek = 0.0
    payload_with_config = {
        "path": 1,
        "answers": dict(
            BASE,
            capital={"broker": 50_000},
            base_config=base.model_dump(),
        ),
    }
    after = client.post("/api/wizard/plan", json=payload_with_config).json()
    assert after["projection"]["min_monthly"] != pytest.approx(
        before["projection"]["min_monthly"]
    )


def test_api_wizard_salary_uses_client_base_config(client):
    payload = {"amount": 10_000, "salary_mode": "gross", "employment": "etat"}
    before = client.post("/api/wizard/salary", json=payload).json()

    base = default_config()
    base.kwota_wolna = 0.0
    base.rate_lower = 0.30
    base.rate_upper = 0.30
    after = client.post(
        "/api/wizard/salary",
        json={**payload, "base_config": base.model_dump()},
    ).json()
    assert after["net_monthly"] < before["net_monthly"]


@pytest.mark.slow
def test_api_path2(client):
    resp = client.post(
        "/api/wizard/plan",
        json={"path": 2, "target_monthly": 12_000, "answers": dict(BASE)},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["solved"]["savings_monthly"] > 0


@pytest.mark.slow
def test_api_path3(client):
    resp = client.post(
        "/api/wizard/plan",
        json={"path": 3, "target_monthly": 5_000, "answers": dict(BASE)},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["solved"]["retire_early_age"] is not None
    assert body["projection"]["met"] is True


def test_api_missing_target_400(client):
    resp = client.post("/api/wizard/plan", json={"path": 2, "answers": dict(BASE)})
    assert resp.status_code == 400


def test_api_rejects_target_below_ui_minimum(client):
    resp = client.post(
        "/api/wizard/plan",
        json={"path": 2, "target_monthly": 499, "answers": dict(BASE)},
    )
    assert resp.status_code == 422
    with pytest.raises(ValueError, match="co najmniej 500"):
        plan(2, answers(), 499)


def test_api_invalid_path_422(client):
    resp = client.post("/api/wizard/plan", json={"path": 9, "answers": dict(BASE)})
    assert resp.status_code == 422


# --- Allocation model (cash-sink) ---------------------------------------------


def test_tiny_cap_overflow_is_absorbed_into_uncapped_account():
    a = answers(
        savings=4600,
        allocations={"ike": 51.2, "ikze": 20.5, "broker": 28.3},
        use_ike=True,
        use_ikze=True,
        use_broker=True,
    )
    alloc = _resolve_allocation(a, default_config(), 55_200)
    assert alloc.get("gotowka", 0) == 0
    assert alloc["ike"] == pytest.approx(28_260, abs=0.01)
    assert alloc["ikze"] == pytest.approx(11_304, abs=0.01)
    assert alloc["broker"] == pytest.approx(15_636, abs=0.01)


def test_large_cap_overflow_still_goes_to_cash():
    a = answers(
        savings=5000,
        allocations={"ike": 51.2, "ikze": 20.5, "broker": 28.3},
        use_ike=True,
        use_ikze=True,
        use_broker=True,
    )
    alloc = _resolve_allocation(a, default_config(), 60_000)
    assert alloc.get("gotowka", 0) > 0


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
    # BASE capital: broker 100k. Mała pula otwiera najpierw ulgi, nie broker.
    out = suggest_allocations(answers(allocations={}), default_config(), 12_000)
    assert out == {"ikze": 94.2, "ike": 5.8}


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
    # 2 000 zł/rok → jedno konto, nie 15 kont.
    a = answers(allocations={}, capital={}, gross_monthly=0)
    s = suggest_allocations(a, default_config(), 2_000)
    assert s == {"ike": 100.0}


def test_suggest_rynkowy_uses_market_wrappers():
    # 40k/rok, profil Rynkowy: 100% rynku, zero safe i krypto.
    a = answers(allocations={}, capital={})
    alloc, vehicles = suggest_allocation_plan(a, default_config(), 40_000)
    assert vehicles == {"ike": "broker", "oipe": "fund"}
    assert alloc["ike"] == pytest.approx(70.65, abs=0.05)
    assert alloc["oipe"] == pytest.approx(29.35, abs=0.05)
    assert "ikze" not in alloc
    assert "krypto" not in alloc
    assert sum(alloc.values()) == pytest.approx(100.0, abs=0.02)


def test_suggest_equal_capacity_fills_wrappers_then_taxable():
    a = answers(allocations={}, use_ikze=True, use_ike=True, use_oipe=True, use_broker=True)
    small, small_vehicles = suggest_allocation_plan(a, default_config(), 40_000)
    assert small_vehicles == {"ike": "broker", "oipe": "fund"}
    assert set(small) >= {"ike", "oipe"}
    large, large_vehicles = suggest_allocation_plan(a, default_config(), 200_000)
    assert large_vehicles == {"ike": "broker", "oipe": "fund", "ikze": "broker"}
    assert large["ikze"] == pytest.approx(11_304 / 200_000 * 100, abs=0.02)
    assert large["ike"] == pytest.approx(28_260 / 200_000 * 100, abs=0.02)
    assert large["oipe"] == pytest.approx(28_260 / 200_000 * 100, abs=0.02)
    assert large["broker"] > 0
    assert large["oki_inw"] > 0
    assert sum(large.values()) == pytest.approx(100.0, abs=0.02)


def test_suggest_respects_existing_oki_balance():
    # Limit OKI to 100 tys. — jeśli już jest wykorzystany, nowe wpłaty idą
    # do brokera, a nie do OKI.
    full = answers(
        risk_profile="zrownowazony",
        allocations={},
        capital={"oki_inw": 100_000},
    )
    alloc_full, _ = suggest_allocation_plan(full, default_config(), 200_000)
    assert "oki_inw" not in alloc_full
    # Broker jest limitowany przez max_single_taxable (50%); reszta nie może
    # przekroczyć profilu, więc trafia do gotówki.
    assert alloc_full["broker"] <= 50.0 + 1e-6
    assert alloc_full.get("gotowka", 0.0) > 0

    empty = answers(risk_profile="zrownowazony", allocations={}, capital={})
    alloc_empty, _ = suggest_allocation_plan(empty, default_config(), 200_000)
    assert alloc_empty["oki_inw"] > 0


def test_suggest_respects_existing_oki_savings_balance():
    a = answers(
        risk_profile="spokojny",
        allocations={},
        capital={"oki_osk": 25_000},
        use_ike=True,
        use_ikze=True,
    )
    alloc, _vehicles = suggest_allocation_plan(a, default_config(), 60_000)
    assert "oki_osk" not in alloc
    assert alloc["obligacje"] > 0


def test_suggest_sole_active_account_opens_shelters_then_mix():
    s, vehicles = suggest_allocation_plan(
        answers(
            risk_profile="dynamiczny",
            allocations={},
            capital={},
            use_krypto=True,
        ),
        default_config(),
        120_000,
    )
    assert vehicles["oipe"] == "fund"
    assert vehicles["ike"] in ("broker", "fund")
    assert s["krypto"] == pytest.approx(30.0, abs=0.05)
    assert sum(s.values()) == pytest.approx(100.0, abs=0.02)


def test_suggest_spokojny_fills_safe_wrappers():
    a = answers(
        risk_profile="spokojny",
        allocations={},
        use_ikze=True,
        use_ike=True,
        use_oipe=True,
        use_broker=True,
        use_lokata=True,
    )
    s, vehicles = suggest_allocation_plan(a, default_config(), 60_000)
    assert vehicles["ike"] == "savings"
    assert vehicles["ikze"] == "savings"
    assert "oipe" not in vehicles
    assert s["ike"] == pytest.approx(47.1, abs=0.1)
    assert s["ikze"] == pytest.approx(18.84, abs=0.1)
    assert s["obligacje"] == pytest.approx(17.03, abs=0.1)
    assert s["lokata"] == pytest.approx(10.22, abs=0.1)
    assert s["oki_osk"] == pytest.approx(6.81, abs=0.1)
    assert "krypto" not in s
    assert "broker" not in s
    assert sum(s.values()) == pytest.approx(100.0, abs=0.02)


def test_suggest_dynamiczny_uses_market_wrappers():
    s, vehicles = suggest_allocation_plan(
        answers(
            risk_profile="dynamiczny",
            use_krypto=True,
            use_broker=True,
            use_obligacje=True,
            use_lokata=True,
        ),
        default_config(),
        90_000,
    )
    assert vehicles["ike"] == "broker"
    assert vehicles["ikze"] == "broker"
    assert vehicles["oipe"] == "fund"
    assert s["krypto"] == pytest.approx(30.0, abs=0.05)
    assert s.get("obligacje", 0) == 0
    assert sum(s.values()) == pytest.approx(100.0, abs=0.02)


def test_suggest_low_tax_rate_prefers_ike():
    # 0 PIT → ulga IKZE nic nie daje, więc IKE pierwsze.
    s = suggest_allocations(
        answers(allocations={}, capital={}, gross_monthly=0),
        default_config(),
        12_000,
    )
    assert s == {"ike": 100.0}


def test_suggest_tax_rate_above_break_even_prefers_ikze():
    # 12% > progu 10,5% → IKZE pierwsze.
    s = suggest_allocations(
        answers(allocations={}, capital={}, gross_monthly=8_000),
        default_config(),
        12_000,
    )
    assert s == {"ikze": 94.2, "ike": 5.8}


def test_suggest_ikze_b2b_higher_capacity():
    # b2b ma wyższy limit IKZE, więc przy dużej puli więcej mieści się w IKZE.
    etat = suggest_allocations(answers(allocations={}, capital={}), default_config(), 120_000)
    b2b = suggest_allocations(
        answers(allocations={}, capital={}, employment="b2b"),
        default_config(),
        120_000,
    )
    assert etat["ikze"] == pytest.approx(9.42, abs=0.05)
    assert b2b["ikze"] == pytest.approx(14.13, abs=0.05)
    assert b2b["ikze"] > etat["ikze"]
    assert sum(etat.values()) <= 100 + 1e-6
    assert sum(b2b.values()) <= 100 + 1e-6


def test_suggest_priority_lists_shelters_then_strategy_mix():
    conservative = suggest_priority(
        answers(allocations={}, strategy="konserwatywna"), default_config()
    )
    assert conservative[:2] == ["ikze", "ike"]
    assert "obligacje" in conservative
    assert "broker" not in conservative

    aggressive = suggest_priority(
        answers(allocations={}, strategy="agresywna"), default_config()
    )
    assert aggressive[:3] == ["ikze", "ike", "oipe"]
    assert aggressive.index("broker") < aggressive.index("obligacje")

    low_tax = suggest_priority(
        answers(allocations={}, gross_monthly=0), default_config()
    )
    assert low_tax[:2] == ["ike", "ikze"]


@pytest.mark.slow
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


@pytest.mark.slow
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


@pytest.mark.slow
def test_auto_policy_picks_early_ikze_for_bridge_case():
    a = answers(
        capital={},
        savings=1000,
        use_ppk=False,
        use_ike=False,
        use_ikze=True,
        gross_monthly=8000,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=100,
    )
    a.allocations = suggest_allocations(a, default_config(), 12_000)
    result = plan(1, a)

    assert result.projection.withdrawal_policy.startswith("early_")
    assert result.projection.early_return_total > 0
    defer = result.input.model_copy(
        update={"withdrawal_policy": "defer_tier"}, deep=True
    )
    defer_result = simulate(defer)
    chosen = result.projection.total_withdrawn + result.projection.final_wealth_net
    alternative = defer_result.total_withdrawn + defer_result.final_wealth_net
    assert chosen > alternative


def test_auto_policy_keeps_defer_when_ike_is_large():
    a = answers(
        capital={"ike": 500_000, "ikze": 100_000},
        savings=0,
        allocations={"ike": 100},
        use_ppk=False,
        use_ike=True,
        use_ikze=True,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=100,
    )
    result = plan(1, a)
    assert result.projection.withdrawal_policy == "defer_tier"


def test_account_phases_split_by_tax_windows_and_amount():
    a = answers(
        capital={},
        savings=1000,
        use_ppk=False,
        use_ike=False,
        use_ikze=True,
        gross_monthly=8000,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=100,
    )
    a.allocations = suggest_allocations(a, default_config(), 12_000)
    result = plan(1, a)
    phases = result.projection.account_phases

    ikze = [p for p in phases if p.account == "ikze"]
    ike = [p for p in phases if p.account == "ike"]
    safe_target = [p for p in phases if p.account == "obligacje"]
    assert not ikze  # wcześniejszy zwrot: podatek jednorazowy, brak wiersza 0 zł
    assert safe_target and safe_target[0].start_age == 55
    # Netto z IKZE najpierw do IKE do limitu, reszta do bezpiecznego taxable.
    # Dokładny koniec fazy zależy od przyjętych ROI; liczy się, że pokrywa
    # kilka lat przed przejściem na IKE.
    assert safe_target[0].last_age >= 60
    # IKE pojawia się dopiero po osiągnięciu progu 60 lat; dokładny rok
    # zależy od ROI i kolejności wypłat.
    assert ike and ike[0].start_age >= 60

    # Szczegóły akumulacji do tooltipa Gantta: start -> koniec wpłat + wzrost.
    first_ike = ike[0]
    assert first_ike.accumulation_start_age == 30
    assert first_ike.accumulation_end_age == 55
    assert first_ike.accumulation_annual_contribution > 0
    assert first_ike.accumulation_total_contributions == pytest.approx(
        first_ike.accumulation_annual_contribution * 25, abs=0.02
    )
    assert first_ike.accumulation_end_balance > first_ike.accumulation_start_balance
    assert first_ike.accumulation_growth == pytest.approx(
        first_ike.accumulation_end_balance
        - first_ike.accumulation_start_balance
        - first_ike.accumulation_total_contributions,
        abs=0.02,
    )

    first = safe_target[0]
    assert first.lump_tax == 0
    assert first.avg_monthly_net > 0
    assert first.starting_balance > 0
    assert first.total_net > 0
    assert result.projection.early_return_total > 0
    assert result.projection.early_return_tax_total > 0
    assert result.projection.early_return_age == 55
    ikze_accum = [
        phase for phase in result.projection.accumulation_phases
        if phase.account == "ikze"
    ]
    assert ikze_accum
    assert ikze_accum[0].start_age == 30
    assert ikze_accum[0].end_age == 55
    assert any(
        transfer.from_account == "ikze"
        and transfer.to_account == "obligacje"
        and transfer.age == 55
        for transfer in result.projection.capital_transfers
    )
    assert sum(result.projection.early_return_allocations.values()) == pytest.approx(
        result.projection.early_return_total, abs=0.02
    )

    zus = [p for p in phases if p.account == "zus"]
    assert len(zus) == 1
    assert zus[0].start_age == 65
    assert zus[0].last_age >= 90
    assert zus[0].accumulation_start_age == 30
    assert zus[0].lump_tax == 0
    assert zus[0].total_net > 0
    assert zus[0].total_health > 0
    assert zus[0].total_net == pytest.approx(
        zus[0].total_gross - zus[0].total_tax - zus[0].total_health, abs=0.02
    )


def test_projection_chart_is_net_and_excludes_zus_capital():
    r = plan(1, answers(use_zus=True, capital={"broker": 200_000}))
    chart = r.projection.chart
    simulation = simulate(r.input)

    assert chart.ages == [year.age for year in simulation.years]
    assert "zus" in chart.withdrawals_net
    assert "broker" in chart.withdrawals_net
    assert "broker" in chart.balances
    assert "zus" not in chart.balances
    assert "zus:ofe" not in chart.balances
    assert all(len(values) == len(chart.ages) for values in chart.withdrawals_net.values())
    assert all(len(values) == len(chart.ages) for values in chart.balances.values())

    payout = next(
        year for year in simulation.years if year.withdrawals.get("broker", 0) > 0
    )
    index = chart.ages.index(payout.age)
    expected = (
        payout.withdrawals["broker"]
        - max(0.0, payout.taxes.get("broker", 0.0))
        - max(0.0, payout.health.get("broker", 0.0))
    )
    # YearResult ma składniki zaokrąglone do groszy, a wykres liczy netto
    # z surowych wartości — dopuszczamy niewielką różnicę relative.
    assert chart.withdrawals_net["broker"][index] == pytest.approx(expected, rel=1e-3)
    assert any(value > 0 for value in chart.withdrawals_net["zus"])


def test_suggest_market_profiles_fill_wrappers_with_market():
    a = answers(risk_profile="dynamiczny", allocations={}, capital={}, use_krypto=True)
    alloc, vehicles = suggest_allocation_plan(a, default_config(), 120_000)
    assert vehicles["ike"] == "broker"
    assert vehicles["ikze"] == "broker"
    assert vehicles["oipe"] == "fund"
    assert alloc.get("obligacje", 0) == 0
    assert alloc.get("krypto", 0) == pytest.approx(30.0, abs=0.1)

    a = answers(risk_profile="zrownowazony", allocations={}, capital={})
    alloc, vehicles = suggest_allocation_plan(a, default_config(), 60_000)
    assert vehicles["ike"] == "broker"
    assert vehicles["ikze"] == "broker"
    assert alloc.get("krypto", 0) == 0
    assert alloc.get("obligacje", 0) == 0


def test_suggest_small_pool_uses_one_market_wrapper():
    a = answers(risk_profile="zrownowazony", allocations={}, capital={}, gross_monthly=0)
    alloc, vehicles = suggest_allocation_plan(a, default_config(), 20_000)
    assert vehicles.get("ike") == "broker"
    assert "ikze" not in vehicles
    assert alloc["ike"] == pytest.approx(100.0, abs=0.1)


def test_roi_precedence_explicit_over_vehicle_over_default():
    a = answers(
        risk_profile="spokojny",
        wrapper_vehicles={"ike": "savings"},
        roi_overrides={},
    )
    cfg = default_config()
    assert P._roi(a, "ike", cfg) == pytest.approx(
        cfg.wrapper_vehicles["savings"].default_roi
    )
    a.roi_overrides = {"ike": 0.031}
    assert P._roi(a, "ike", cfg) == pytest.approx(0.031)


def test_oipe_only_fund_by_default_but_configurable():
    cfg = default_config()
    assert cfg.wrapper_vehicle_options["oipe"] == ["fund"]
    a = answers(risk_profile="zrownowazony", allocations={}, capital={})
    alloc, vehicles = suggest_allocation_plan(a, cfg, 60_000)
    assert vehicles["oipe"] == "fund"

    cfg.wrapper_vehicle_options["oipe"] = ["fund", "broker"]
    alloc, vehicles = suggest_allocation_plan(a, cfg, 60_000)
    assert vehicles["oipe"] in ("fund", "broker")


def test_wrapper_vehicle_unknown_rejected():
    with pytest.raises(ValidationError):
        WizardAnswers(wrapper_vehicles={"ike": "bondy"})


def test_old_risk_profile_config_migrates_to_max_market():
    cfg = P.TaxConfig.model_validate(
        {
            "risk_profiles": {
                "spokojny": {
                    "label": "Spokojny",
                    "max_taxable_market": 0.42,
                }
            }
        }
    )
    assert cfg.risk_profiles["spokojny"].max_market == pytest.approx(0.42)
    assert set(cfg.wrapper_vehicle_options) == {"ike", "ikze", "oipe"}


def test_result_chart_extends_to_100_beyond_horizon():
    a = answers(plan_end_age=85, use_zus=True)
    r = plan(1, a, scenarios=False, extend_chart=True)
    assert r.projection.chart.ages[0] == a.age_now
    assert r.projection.chart.ages[-1] == 100
    zus = r.projection.chart.withdrawals_net.get("zus", [])
    assert zus and zus[-1] > 0
    base = plan(1, a, scenarios=False)
    assert r.projection.final_wealth == base.projection.final_wealth
    assert r.projection.final_wealth_net == base.projection.final_wealth_net


def test_simulator_projection_extends_zus_chart_to_100():
    a = answers(plan_end_age=85, use_zus=True)
    r = plan(1, a, scenarios=False)
    simulation = simulate(r.input)
    projection = P.build_projection(r.input, simulation)

    assert max(year.age for year in simulation.years) == r.input.max_age
    assert projection.chart.ages[-1] == 100
    assert projection.chart.withdrawals_net["zus"][-1] > 0
    assert len(projection.chart.lifestyle_monthly) == len(projection.chart.ages)
    assert len(projection.chart.obligations_monthly) == len(projection.chart.ages)
    assert len(projection.chart.part_time_monthly) == len(projection.chart.ages)
    assert projection.final_wealth == pytest.approx(simulation.final_wealth)


def test_suggest_small_dynamic_prefers_ike_market_over_oipe():
    a = answers(risk_profile="dynamiczny", allocations={}, capital={})
    alloc, vehicles = suggest_allocation_plan(a, default_config(), 20_000)
    assert vehicles.get("ike") == "broker"
    assert "oipe" not in vehicles
    assert alloc["ike"] == pytest.approx(70.0, abs=0.1)


def test_suggest_small_balanced_prefers_ike_market_over_oipe():
    a = answers(risk_profile="zrownowazony", allocations={}, capital={}, gross_monthly=0)
    alloc, vehicles = suggest_allocation_plan(a, default_config(), 20_000)
    assert vehicles.get("ike") == "broker"
    assert "oipe" not in vehicles
    assert alloc["ike"] == pytest.approx(100.0, abs=0.1)


def test_suggest_large_balanced_uses_market_wrappers():
    a = answers(risk_profile="zrownowazony", allocations={}, capital={}, gross_monthly=0)
    alloc, vehicles = suggest_allocation_plan(a, default_config(), 60_000)
    assert vehicles.get("ike") == "broker"
    assert vehicles.get("oipe") == "fund"
    assert alloc["ike"] == pytest.approx(47.1, abs=0.1)
    assert alloc["oipe"] == pytest.approx(47.1, abs=0.1)


def _lifestyle_series(result, data):
    from app.simulation.summary import lifestyle_monthly_net, realization_window

    start, end = realization_window(data)
    return [
        lifestyle_monthly_net(data, year)
        for year in simulate(data).years
        if start <= year.age < end
    ]


def test_barista_lifestyle_does_not_overshoot_after_part_time_gross_fix():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 500_000},
        savings=3_000,
        use_broker=True,
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=45,
        semi_fire_net_monthly=4_500,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=85,
        allocations={"broker": 100},
    )
    r = P._plan_single(1, a)
    data, proj = r[0], r[1]
    values = _lifestyle_series(r[3], data)
    assert values
    assert min(values) == pytest.approx(proj.min_monthly, abs=1.0)
    # Lata Baristy nie mogą wypłacać znacząco więcej niż cel. Solver działa
    # per etap i gwarantuje minimum; niewielkie odchylenie w górę wynika
    # z podatków w różnych latach.
    barista_years = [
        lifestyle_monthly_net(data, year)
        for year in simulate(data).years
        if 45 <= year.age < 55
    ]
    assert all(value >= proj.min_monthly - 1.0 for value in barista_years)
    assert max(barista_years) - proj.min_monthly < 50.0


def test_coast_does_not_add_new_ppk_contributions():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 100_000},
        savings=3_000,
        use_ppk=True,
        ppk_contributions=True,
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_age=45,
        semi_fire_net_monthly=4_500,
        semi_fire_savings_monthly=500,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=85,
    )
    data = P.build_stages(a)
    coast = next(s for s in data.stages if s.name.startswith("Coast FIRE"))
    assert "ppk" not in coast.accounts or coast.accounts["ppk"].monthly_base == 0
    assert "zus" in coast.accounts and coast.accounts["zus"].monthly_base > 0


def test_path3_barista_is_never_silently_dropped():
    a = WizardAnswers(
        gender="m",
        age_now=40,
        employment="etat",
        gross_monthly=8_000,
        capital={"broker": 500_000},
        savings=8_000,
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=48,
        semi_fire_net_monthly=3_000,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=85,
    )
    r = plan(3, a, 3_000)
    assert r.solved.retire_early_age is not None
    assert r.solved.retire_early_age > 48
    assert any(
        stage.part_time_net_monthly > 0 for stage in r.input.stages
    )


def test_suggest_respects_shared_oki_limit_for_custom_profile():
    cfg = default_config()
    profile = cfg.risk_profiles["zrownowazony"]
    profile.min_safe = 0.5
    profile.max_market = 0.5
    profile.max_single_taxable = 0.2
    a = answers(risk_profile="zrownowazony", allocations={}, capital={})
    pool = 500_000.0
    alloc, _ = suggest_allocation_plan(a, cfg, pool)
    oki_total = (alloc.get("oki_inw", 0.0) + alloc.get("oki_osk", 0.0)) / 100.0 * pool
    assert oki_total <= 100_000 + 1.0
    assert alloc.get("broker", 0.0) <= 20.0 + 1e-6


def test_coast_is_not_reported_as_missing_stage():
    a = answers(
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_age=45,
        semi_fire_net_monthly=4500,
        semi_fire_savings_monthly=500,
        retire_early_age=55,
    )
    r = plan(1, a)
    assert not any("nie został uwzględniony" in w for w in r.projection.warnings)


def test_b2b_ulga_warns_about_time_limit():
    a = answers(
        employment="b2b",
        b2b_tax_form="ryczalt",
        b2b_zus_mode="ulga",
    )
    r = plan(1, a)
    assert any("ulga na start trwa 6" in w for w in r.projection.warnings)


def test_barista_replay_matches_projection():
    a = answers(
        age_now=40,
        gross_monthly=12_000,
        capital={"broker": 500_000},
        savings=3_000,
        use_broker=True,
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=45,
        semi_fire_net_monthly=4_500,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=85,
        allocations={"broker": 100},
    )
    data, proj, _solved, result = P._plan_single(1, a)
    replay = simulate(data)
    assert replay.total_withdrawn == pytest.approx(result.total_withdrawn, abs=5.0)
    assert replay.final_wealth == pytest.approx(result.final_wealth, abs=5.0)
    assert replay.years[-1].age == result.years[-1].age


def test_b2b_warnings_explain_limited_zus_relief():
    from app.simulation.planner import PlanProjection, _append_b2b_warning

    for mode, phrase in (("ulga", "ulga na start"), ("maly", "mały/preferencyjny")):
        answers = WizardAnswers(employment="b2b", b2b_zus_mode=mode)
        projection = PlanProjection(met=True)
        _append_b2b_warning(projection, answers)
        assert any(phrase in warning for warning in projection.warnings)


def test_coast_warning_flags_salary_below_target():
    from app.simulation.planner import PlanProjection, _append_coast_warning

    answers = WizardAnswers(
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_net_monthly=2_000,
        semi_fire_savings_monthly=0,
    )
    projection = PlanProjection(met=True, min_monthly=5_000)
    _append_coast_warning(projection, answers, 5_000)
    assert any("Brakuje ok." in warning for warning in projection.warnings)


def test_solve_re_rejects_semi_fire_beyond_horizon():
    a = WizardAnswers(
        gender="m",
        age_now=40,
        employment="etat",
        gross_monthly=12_000,
        capital={"broker": 500_000},
        savings=3_000,
        use_broker=True,
        semi_fire_enabled=True,
        semi_fire_mode="barista",
        semi_fire_age=85,
        semi_fire_net_monthly=4_500,
        retire_early_age=85,
        plan_end_age=85,
        allocations={"broker": 100},
    )
    assert P._solve_re(a, 5_000) == (None, False)


def test_mortgage_in_window_is_proportional_to_overlap():
    from app.simulation.schemas import AccountConfig, StageInput

    data = SimulationInput(
        stages=[
            StageInput(
                stage_type="realizacja",
                name="Emerytura",
                start_age=65,
                end_age=85,
                accounts={"broker": AccountConfig()},
            )
        ],
        mortgage_monthly=3_000,
        mortgage_end_age=70,
    )
    # Pięć lat spłaty z dwudziestu lat fazy → średnio 750 zł/mies.
    assert P._mortgage_in_window(data, 65, 85) == pytest.approx(750.0)


def test_answers_backfill_2027_config():
    a = WizardAnswers(
        base_config={"year": 2027},
        age_now=30,
        employment="etat",
        gross_monthly=8_000,
        capital={},
        savings=1_000,
    )
    assert a.base_config is not None
    assert a.base_config.b2b.preferential_base_monthly == pytest.approx(1_485)
    assert a.base_config.zus.b2b_base_monthly == pytest.approx(6_019.80)
