"""Optymalizator: wiek ZUS, mix IKE/IKZE, spadek i horyzont."""

import pytest

from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.optimizer import (
    _bucket_totals,
    _weights_from_buckets,
    optimize_plan,
    plan_optimized,
)
from app.simulation.planner import (
    WizardAnswers,
    _evaluate,
    _solve_payout,
    build_stages,
)
from app.simulation.schemas import AccountConfig, SimulationInput, StageInput


def _answers(**over) -> WizardAnswers:
    base = dict(
        gender="m",
        age_now=40,
        employment="etat",
        gross_monthly=9000,
        capital={},
        use_zus=True,
        use_ike=True,
        use_ikze=True,
        retire_early_age=55,
        retirement_age=65,
        plan_end_age=76,
        savings=2000,
        strategy="zbilansowana",
        assumptions="realne",
        allocations={"ike": 60, "ikze": 40},
    )
    base.update(over)
    return WizardAnswers(**base)


def test_build_stages_defers_zus_and_extends_bridge():
    data = build_stages(_answers(retirement_age=70, plan_end_age=85))
    zus = next(s for s in data.stages if set(s.accounts) == {"zus"})
    bridge = next(
        s for s in data.stages
        if s.stage_type == "realizacja" and "zus" not in s.accounts and s.start_age == 55
    )
    assert zus.start_age == 70
    assert bridge.end_age == 70
    assert data.max_age == 84


def test_simulate_horizon_uses_max_age_not_lifetime_zus_stage():
    cfg = default_config()
    stages = [
        StageInput(
            stage_type="realizacja",
            name="Portfel",
            start_age=60,
            end_age=80,
            accounts={"broker": AccountConfig(starting_balance=100_000, roi=0.0)},
        ),
        StageInput(
            stage_type="realizacja",
            name="ZUS",
            start_age=65,
            end_age=100,
            accounts={"zus": AccountConfig(starting_balance=100_000, monthly_pension=0)},
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=79, config=cfg))
    assert result.years[-1].age == 79
    assert all(year.age <= 79 for year in result.years)


@pytest.mark.slow
def test_optimizer_prefers_a_higher_payout_than_baseline():
    # Typowy przypadek Asystenta: brak sald IKE/IKZE, ale wpłaty już są
    # zaplanowane w podziale. Flagi use_* nie mogą blokować optymalizacji.
    result = optimize_plan(
        _answers(use_ike=False, use_ikze=False),
        objective="payout",
        search_budget=10,
    )
    assert result.evaluated > 5
    assert result.recommended is not None
    assert result.recommended.feasible
    assert result.recommended.met
    assert result.recommended.payout_monthly >= result.baseline.payout_monthly - 1
    assert result.recommended.zus_start_age >= 65
    assert result.recommended.allocations


def test_solver_respects_bequest():
    data = build_stages(_answers(bequest_target=200_000))
    payout, feasible = _solve_payout(data, 200_000)
    assert feasible and payout > 0
    projection = _evaluate(data, payout, 200_000)
    assert projection.final_wealth_net >= 199_000
    assert projection.met


@pytest.mark.slow
def test_optimizer_total_can_defer_when_zus_indexation_is_high():
    cfg = default_config()
    cfg.zus.waloryzacja_skladek = 0.10
    result = optimize_plan(
        _answers(base_config=cfg, plan_end_age=81),
        objective="total",
    )
    assert result.recommended is not None
    assert result.recommended.zus_start_age > 65


def test_risk_profile_weights_are_clamped():
    cfg = default_config()
    props = {
        "safe": {"obligacje": 1.0},
        "market": {"broker": 1.0},
        "high": {"krypto": 1.0},
    }
    vehicles = {"ike": "broker"}
    for profile_key in ("spokojny", "zrownowazony", "dynamiczny"):
        a = _answers(risk_profile=profile_key)
        weights = _weights_from_buckets(
            {"safe": 0, "market": 80, "high": 20},
            props,
            a,
            cfg,
            24_000,
            vehicles,
        )
        totals = _bucket_totals(weights, cfg, vehicles)
        profile = cfg.risk_profiles[profile_key]
        assert totals["high"] <= profile.max_crypto * 100 + 0.5
        assert totals["market"] <= profile.max_market * 100 + 0.5
        assert totals["safe"] >= profile.min_safe * 100 - 0.5
        assert sum(weights.values()) == pytest.approx(100, abs=0.1)


@pytest.mark.slow
def test_plan_optimized_uses_the_recommended_variant():
    result = plan_optimized(
        1,
        _answers(use_ike=False, use_ikze=False),
        scenarios=False,
        search_budget=8,
    )
    assert result.optimization is not None
    recommended = result.optimization["recommended"]
    assert result.projection.min_monthly == pytest.approx(
        recommended["payout_monthly"], abs=1.0
    )
    zus = next(s for s in result.input.stages if set(s.accounts) == {"zus"})
    assert zus.start_age == recommended["zus_start_age"]
    accumulation = next(
        s for s in result.input.stages if s.stage_type == "akumulacja"
    )
    for account in recommended["allocations"]:
        assert accumulation.accounts[account].annual_contribution > 0




def test_optimizer_candidate_carries_vehicles_and_asset_mix():
    result = optimize_plan(
        _answers(risk_profile="spokojny", search_budget=6),
        search_budget=8,
    )
    assert result.recommended is not None
    rec = result.recommended
    assert rec.vehicles.get("ike") == "savings"
    assert rec.vehicles.get("ikze") == "savings"
    assert rec.vehicles.get("oipe") == "fund"
    assert result.asset_mix["safe"] >= 69.0
    assert result.asset_mix["market"] <= 31.0


def test_optimizer_respects_oipe_fund_only():
    result = optimize_plan(
        _answers(risk_profile="dynamiczny", savings=5000), search_budget=6
    )
    assert result.recommended is not None
    assert result.recommended.vehicles.get("oipe") == "fund"
