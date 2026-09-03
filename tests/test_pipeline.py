from app.simulation.config import default_config
from app.simulation.engine import SimulationState, _init_state
from app.simulation.schemas import SimulationInput
from tests.conftest import acc, accumulation_stage, realization_stage


def test_state_iter_order():
    cfg = default_config()
    s = SimulationState(config=cfg)
    parts = list(s)
    assert parts[0] is cfg
    assert isinstance(parts[1], dict)
    assert isinstance(parts[7], dict)
    assert parts[1] is s.balances
    assert parts[7] is s.computed
    assert len(parts) == 15


def test_state_defaults_independence():
    cfg = default_config()
    s1 = SimulationState(config=cfg)
    s2 = SimulationState(config=cfg)
    s1.balances["broker"] = 100
    assert "broker" not in s2.balances
    s1.early_returned.add("ikze")
    assert "ikze" not in s2.early_returned


def test_init_state_sorted_wins():
    cfg = default_config()
    data = SimulationInput(
        stages=[
            accumulation_stage({"broker": acc(starting_balance=100, roi=0.02)}, start=60, end=65),
            accumulation_stage({"broker": acc(starting_balance=200, roi=0.02)}, start=40, end=45),
        ],
        config=cfg,
    )
    state = _init_state(data)
    assert state.balances["broker"] == 200


def test_monthly_gross_ikze_saving_negative_tax():
    cfg = default_config()
    data = SimulationInput(
        stages=[
            accumulation_stage(
                {"ikze": acc(annual_contribution=11304, roi=0.02)}, start=40, end=41
            ),
            realization_stage("Emerytura", {"ikze": acc(roi=0.02)}, start=65, end=66),
        ],
        max_age=66,
        monthly_gross=10000,
        config=cfg,
    )
    from app.simulation.engine import simulate

    result = simulate(data)
    year_40 = next(y for y in result.years if y.age == 40)
    assert year_40.tax_paid < 0
    data2 = SimulationInput(
        stages=[
            accumulation_stage(
                {"ikze": acc(annual_contribution=11304, roi=0.02)}, start=40, end=41
            ),
            realization_stage("Emerytura", {"ikze": acc(roi=0.02)}, start=65, end=66),
        ],
        max_age=66,
        monthly_gross=0,
        config=cfg,
    )
    result2 = simulate(data2)
    year_40b = next(y for y in result2.years if y.age == 40)
    assert year_40b.tax_paid == 0


def test_run_year_pipeline_isolation():
    from app.simulation.engine import _run_year

    cfg = default_config()
    data = SimulationInput(
        stages=[
            accumulation_stage(
                {"broker": acc(starting_balance=100000, roi=0.05, annual_contribution=10000)},
                start=40,
                end=41,
            ),
        ],
        max_age=40,
        config=cfg,
    )
    state = _init_state(data)
    _run_year(state, 40, 0, data.stages)
    assert 40 in state.computed
    assert state.computed[40]["starting_balances"]["broker"] == 100000
    assert state.balances["broker"] > 100000


def test_per_sim_inflation_override():
    from app.simulation.config import TaxConfig
    from app.simulation.engine import simulate

    cfg = TaxConfig(inflation=0.025)
    base = accumulation_stage(
        {"lokata": acc(starting_balance=100000, roi=0.05, lokata_term_months=12)}, start=40, end=41
    )
    r_global = simulate(SimulationInput(stages=[base], max_age=41, config=cfg))
    r_over0 = simulate(SimulationInput(stages=[base], max_age=41, inflation=0.0, config=cfg))
    r_over4 = simulate(SimulationInput(stages=[base], max_age=41, inflation=0.04, config=cfg))
    assert r_global.years[0].tax_paid != r_over0.years[0].tax_paid
    assert r_over4.years[0].tax_paid > r_global.years[0].tax_paid
    assert r_over0.years[0].tax_paid < r_global.years[0].tax_paid


def test_per_sim_inflation_uses_config_when_none():
    from app.simulation.config import TaxConfig
    from app.simulation.engine import _init_state

    cfg = TaxConfig(inflation=0.03)
    data = SimulationInput(stages=[], config=cfg)
    state = _init_state(data)
    assert state.config.inflation == 0.03
    data2 = SimulationInput(stages=[], inflation=0.01, config=cfg)
    state2 = _init_state(data2)
    assert state2.config.inflation == 0.01
