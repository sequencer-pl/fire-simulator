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


# --- Składki: podstawowa (pracodawca) + dodatkowa (uczestnik) ---


def test_ppe_contributions_from_employer_pct_and_additional():
    # podstawa 8000 zł/mies. -> 3,5% * 96 000 = 3 360 + składka dodatkowa 6 000 = 9 360
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    monthly_base=8000,
                    employer_pct=0.035,
                    annual_contribution=6000,
                    roi=0.0,
                )
            }
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["ppe"] == pytest.approx(9360.0)


def test_ppe_growth_and_contribution():
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    starting_balance=50000,
                    monthly_base=8000,
                    employer_pct=0.035,
                    annual_contribution=6000,
                    roi=0.06,
                )
            }
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["ppe"] == pytest.approx(50000 * 1.06 + 9360)


# --- Wypłaty ---


def test_ppe_withdrawal_after_60_tax_free():
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    starting_balance=200000,
                    monthly_base=8000,
                    employer_pct=0.035,
                    annual_contribution=6000,
                    roi=0.02,
                )
            },
            start=40,
            end=65,
        ),
        realization_stage("PPE", {"ppe": acc(roi=0.02, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert result.total_tax == 0.0
    assert result.total_withdrawn > 0


def test_ppe_early_withdrawal_taxed_19pct_on_gains():
    contribution = 8000 * 12 * 0.035 + 6000  # 9 360 zł/rok
    accumulation = accumulation_stage(
        {
            "ppe": acc(
                starting_balance=0,
                monthly_base=8000,
                employer_pct=0.035,
                annual_contribution=6000,
                roi=0.06,
            )
        },
        start=40,
        end=55,
    )
    acc_only = simulate(SimulationInput(stages=[accumulation], max_age=54))
    bal = acc_only.final_wealth
    contributions = contribution * 15
    assert bal > contributions

    stages = [
        accumulation,
        realization_stage("PPE przed 60", {"ppe": acc(roi=0.02, buffer=0)}, 55, 56),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=55))
    y = result.years[-1]
    assert y.tax_paid == pytest.approx((bal - contributions) * 0.19, abs=0.5)


def test_ppe_in_accounts_list():
    stages = [accumulation_stage({"ppe": acc(monthly_base=8000, employer_pct=0.035)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "ppe" in result.accounts


# --- Ostrzeżenia ---


def test_ppe_warning_employer_pct_over_7():
    stages = [
        accumulation_stage(
            {"ppe": acc(monthly_base=8000, employer_pct=0.08, annual_contribution=0)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("przekracza ustawowy limit 7%" in w for w in result.warnings)


def test_ppe_warning_additional_over_limit():
    stages = [
        accumulation_stage(
            {"ppe": acc(monthly_base=0, employer_pct=0.0, annual_contribution=50000)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("42,390" in w for w in result.warnings)


def test_ppe_early_withdrawal_30pct_warning():
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    starting_balance=50000,
                    monthly_base=8000,
                    employer_pct=0.035,
                    annual_contribution=0,
                )
            },
            start=40,
            end=55,
        ),
        realization_stage("PPE przed 60", {"ppe": acc(roi=0.02, buffer=0)}, 55, 60),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    assert any("30% składek podstawowych" in w for w in result.warnings)
