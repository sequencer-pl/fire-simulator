import pytest

from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import AccountConfig, SimulationInput, StageInput


def acc(**kwargs):
    return AccountConfig(**kwargs)


def accumulation_stage(accounts, start=40, end=65):
    return StageInput(
        stage_type="akumulacja",
        name="Akumulacja",
        start_age=start,
        end_age=end,
        accounts=accounts,
    )


def realization_stage(name, accounts, start, end):
    return StageInput(
        stage_type="realizacja",
        name=name,
        start_age=start,
        end_age=end,
        accounts=accounts,
    )


# --- OKI: osobne konto inwestycyjne (2027), brak Belki w limicie ---


def test_oki_default_rules():
    cfg = default_config()
    rules = cfg.accounts["oki"]
    assert rules.tax_model == "assets"
    assert rules.asset_tax_rate == pytest.approx(0.0085)
    assert rules.asset_exemption == 100_000
    assert rules.min_withdrawal_age == 0


def test_oki_accumulation_like_broker():
    stages = [
        accumulation_stage(
            {"oki": acc(starting_balance=10000, annual_contribution=5000, roi=0.02)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["oki"] == pytest.approx(10000 * 1.02 + 5000)


def test_oki_no_tax_below_limit_full_cycle():
    stages = [
        accumulation_stage(
            {"oki": acc(starting_balance=10000, annual_contribution=0, roi=0.02)},
            start=40,
            end=65,
        ),
        realization_stage("OKI", {"oki": acc(roi=0.02, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert result.total_tax == 0.0
    assert result.total_withdrawn > 0


def test_oki_asset_tax_above_100k():
    stages = [
        accumulation_stage(
            {"oki": acc(starting_balance=200000, roi=0.02)}, start=40, end=41
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert result.total_tax == pytest.approx((202000 - 100000) * 0.0085, abs=0.01)
    assert result.final_wealth == pytest.approx(200000 * 1.02 - 867.0, abs=0.5)


def test_oki_savings_assets_limit_25k():
    stages = [
        accumulation_stage(
            {
                "oki": acc(
                    starting_balance=50000, annual_contribution=0, roi=0.02,
                    asset_exemption=25000,
                )
            },
            start=40,
            end=41,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert result.total_tax == pytest.approx((50500 - 25000) * 0.0085, abs=0.01)


def test_oki_no_belka_on_early_withdrawal():
    stages = [
        realization_stage(
            "OKI przed emeryturą",
            {"oki": acc(starting_balance=200000, roi=0.02, buffer=100000)},
            45,
            46,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=45))
    y = result.years[-1]
    assert y.tax_paid == pytest.approx((150000 - 100000) * 0.0085, abs=0.01)
    assert result.total_tax == y.tax_paid


def test_oki_asset_tax_during_realization():
    stages = [
        realization_stage(
            "OKI realizacja",
            {"oki": acc(starting_balance=200000, roi=0.02, buffer=200000)},
            40,
            43,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=42))
    assert result.total_tax == pytest.approx(3 * 850.0, rel=0.1)
    assert result.final_wealth == pytest.approx(200000.0, rel=0.1)
    assert all(y.tax_paid > 0 for y in result.years)


def test_oki_in_accounts_list():
    stages = [accumulation_stage({"oki": acc(annual_contribution=10000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "oki" in result.accounts
