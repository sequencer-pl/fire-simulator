import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

# --- Składki: podstawowa (pracodawca) + dodatkowa (uczestnik) ---


def test_ppe_contributions_from_employer_pct_and_additional():
    # podstawa 8000 zł/mies. -> 3,5% * 96 000 = 3 360 -> 70% do PPE = 2 352
    # + składka dodatkowa 6 000 = 8 352 do PPE; 30% pracodawcy (1 008) → ZUS
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    base_override_enabled=True,
                    monthly_base=8000,
                    employer_pct=0.035,
                    annual_contribution=6000,
                    roi=0.0,
                )
            }
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["ppe"] == pytest.approx(8352.0)
    # 1 008 trafia do ZUS i rośnie z waloryzacją 1%/rok
    assert result.years[1].balances["zus"] == pytest.approx(1008 * 1.01)


def test_ppe_growth_and_contribution():
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    base_override_enabled=True,
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
    # 70% pracodawcy (2 352) + składka dodatkowa (6 000) = 8 352
    assert result.years[1].balances["ppe"] == pytest.approx(50000 * 1.06 + 8352)


# --- Wypłaty ---


def test_ppe_withdrawal_after_60_tax_free():
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    base_override_enabled=True,
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
    # 70% pracodawcy + składka dodatkowa = 2 352 + 6 000 = 8 352 do PPE rocznie
    ppe_contribution = 8000 * 12 * 0.035 * 0.70 + 6000
    accumulation = accumulation_stage(
        {
                "ppe": acc(
                    base_override_enabled=True,
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
    stages = [
        accumulation,
        realization_stage("PPE przed 60", {"ppe": acc(roi=0.02, buffer=0)}, 55, 56),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=55))
    y = result.years[-1]
    # PPE balance at start of realization (age 55) — after 15 years of growth
    ppe_bal = y.balances["ppe"]
    contributions = ppe_contribution * 15
    assert ppe_bal > contributions
    # Tax 19% on full amount (early_tax_basis="full")
    expected_tax = ppe_bal * 0.19
    assert y.tax_paid == pytest.approx(expected_tax, abs=0.5)


def test_ppe_in_accounts_list():
    stages = [accumulation_stage({"ppe": acc(base_override_enabled=True, monthly_base=8000, employer_pct=0.035)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "ppe" in result.accounts


# --- Ostrzeżenia ---


def test_ppe_warning_employer_pct_over_7():
    stages = [
        accumulation_stage(
            {"ppe": acc(base_override_enabled=True, monthly_base=8000, employer_pct=0.08, annual_contribution=0)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("przekracza ustawowy limit 7%" in w for w in result.warnings)


def test_ppe_warning_additional_over_limit():
    stages = [
        accumulation_stage(
            {"ppe": acc(base_override_enabled=True, monthly_base=0, employer_pct=0.0, annual_contribution=50000)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("42,390" in w for w in result.warnings)


def test_ppe_early_withdrawal_30pct_goes_to_zus():
    # 30% składek podstawowych pracodawcy trafia do ZUS (subkonto)
    stages = [
        accumulation_stage(
            {
                "ppe": acc(
                    base_override_enabled=True,
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
    # Rok 1 (wiek 41): 1 008 trafia do ZUS i rośnie z waloryzacją 1%
    zus_year1 = result.years[1].balances.get("zus", 0)
    assert zus_year1 == pytest.approx(1008 * 1.01)
    # PPE: 70% składek pracodawcy = 2 352
    ppe_year1 = result.years[1].balances.get("ppe", 0)
    assert ppe_year1 == pytest.approx(50000 * 1.02 + 2352)
