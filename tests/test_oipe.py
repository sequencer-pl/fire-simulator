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


def no_tax_config():
    cfg = default_config()
    cfg.kwota_wolna = 0.0
    cfg.rate_lower = 0.0
    cfg.rate_upper = 0.0
    return cfg


# --- OIPE zachowuje się jak IKE (dopłata roczna, profil podatkowy) ---


def test_oipe_accumulation_like_ike():
    stages = [
        accumulation_stage(
            {"oipe": acc(starting_balance=10000, annual_contribution=10000, roi=0.02)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["oipe"] == pytest.approx(10000 * 1.02 + 10000)


def test_oipe_withdrawal_after_60_tax_free():
    stages = [
        accumulation_stage(
            {
                "oipe": acc(
                    starting_balance=200000, annual_contribution=10000, roi=0.02
                )
            },
            start=40,
            end=65,
        ),
        realization_stage("OIPE", {"oipe": acc(roi=0.02, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert result.total_tax == 0.0
    assert result.total_withdrawn > 0


def test_oipe_early_withdrawal_belka_from_gains():
    accumulation = accumulation_stage(
        {"oipe": acc(annual_contribution=10000, roi=0.06)}, start=40, end=55
    )
    acc_only = simulate(SimulationInput(stages=[accumulation], max_age=54))
    bal = acc_only.final_wealth
    contributions = 10000 * 15
    assert bal > contributions

    stages = [
        accumulation,
        realization_stage("OIPE przed 60", {"oipe": acc(roi=0.02, buffer=0)}, 55, 56),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=55))
    y = result.years[-1]
    assert y.tax_paid == pytest.approx((bal - contributions) * 0.19, abs=0.5)


def test_oipe_in_accounts_list():
    stages = [accumulation_stage({"oipe": acc(annual_contribution=10000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "oipe" in result.accounts


def test_oipe_warning_over_limit():
    stages = [accumulation_stage({"oipe": acc(annual_contribution=30000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("28,260" in w for w in result.warnings)
