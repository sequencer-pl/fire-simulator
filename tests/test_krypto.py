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


# --- Krypto: aktywo opodatkowane 19% Belki od zysku (jak broker) ---


def test_krypto_default_rules():
    cfg = default_config()
    rules = cfg.accounts["krypto"]
    assert rules.tax_model == "flat"
    assert rules.tax_rate == pytest.approx(0.19)
    assert rules.tax_basis == "gains"


def test_krypto_accumulation_like_broker():
    stages = [
        accumulation_stage(
            {"krypto": acc(starting_balance=10000, annual_contribution=5000, roi=0.02)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["krypto"] == pytest.approx(10000 * 1.02 + 5000)


def test_krypto_flat_tax_from_gains():
    accumulation = accumulation_stage(
        {"krypto": acc(annual_contribution=10000, roi=0.06)}, start=40, end=45
    )
    acc_only = simulate(SimulationInput(stages=[accumulation], max_age=44))
    bal = acc_only.final_wealth
    contributions = 10000 * 5
    assert bal > contributions

    stages = [
        accumulation,
        realization_stage("Krypto", {"krypto": acc(roi=0.02, buffer=0)}, 45, 46),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=45))
    y = result.years[-1]
    assert y.tax_paid == pytest.approx((bal - contributions) * 0.19, abs=0.5)


def test_krypto_realization_with_buffer():
    stages = [
        realization_stage(
            "Krypto realizacja",
            {"krypto": acc(starting_balance=50000, roi=0.02, buffer=25000)},
            45,
            48,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=47))
    assert result.total_tax > 0
    assert result.total_withdrawn > 0


def test_krypto_in_accounts_list():
    stages = [accumulation_stage({"krypto": acc(annual_contribution=10000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "krypto" in result.accounts
