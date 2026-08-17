import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

# --- Składki i dopłaty państwa ---


def test_ppk_contributions_from_pct_of_base():
    # podstawa 8000 zł/mies. -> (2% + 1,5%) * 96 000 = 3 360 zł/rok
    stages = [
        accumulation_stage(
            {
                "ppk": acc(
                    monthly_base=8000,
                    employee_pct=0.02,
                    employer_pct=0.015,
                    state_topups=True,
                    roi=0.0,
                )
            }
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    # 3 360 + dopłata roczna 240 + powitalna 250 = 3 850
    assert result.years[1].balances["ppk"] == pytest.approx(3850.0)


def test_ppk_state_welcoming_one_time():
    stages = [
        accumulation_stage(
            {
                "ppk": acc(
                    monthly_base=8000,
                    employee_pct=0.02,
                    employer_pct=0.015,
                    state_topups=True,
                    roi=0.0,
                )
            }
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=42))
    # rok 2: 3 850 + 3 360 + 240 (bez powitalnej) = 7 450
    assert result.years[1].balances["ppk"] == pytest.approx(3850.0)
    assert result.years[2].balances["ppk"] == pytest.approx(7450.0)


def test_ppk_state_topups_optional():
    stages = [
        accumulation_stage(
            {
                "ppk": acc(
                    monthly_base=8000,
                    employee_pct=0.02,
                    employer_pct=0.015,
                    state_topups=False,
                    roi=0.0,
                )
            }
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["ppk"] == pytest.approx(8000 * 12 * 0.035)


def test_ppk_growth_and_contribution():
    stages = [
        accumulation_stage(
            {
                "ppk": acc(
                    starting_balance=10000,
                    monthly_base=8000,
                    employee_pct=0.02,
                    employer_pct=0.015,
                    state_topups=True,
                    roi=0.06,
                )
            }
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["ppk"] == pytest.approx(10000 * 1.06 + 3850)


# --- Wypłaty ---


def test_ppk_withdrawal_after_60_tax_free():
    stages = [
        accumulation_stage(
            {
                "ppk": acc(
                    starting_balance=200000,
                    monthly_base=8000,
                    employee_pct=0.02,
                    employer_pct=0.015,
                    state_topups=True,
                    roi=0.02,
                )
            },
            start=40,
            end=65,
        ),
        realization_stage("PPK", {"ppk": acc(roi=0.02, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert result.total_tax == 0.0
    assert result.total_withdrawn > 0


def test_ppk_early_withdrawal_forfeits_employer_state():
    base = 8000
    accumulation = accumulation_stage(
        {
            "ppk": acc(
                monthly_base=base,
                employee_pct=0.02,
                employer_pct=0.015,
                state_topups=True,
                roi=0.06,
            )
        },
        start=40,
        end=55,
    )

    # basis_employee = 1920 * 15 = 28 800; basis_total = 54 250
    emp_basis = base * 12 * 0.02 * 15  # 28 800
    total_basis = (base * 12 * 0.035 + 250 + 240) + (base * 12 * 0.035 + 240) * 14  # 54 250

    stages = [
        accumulation,
        realization_stage("PPK przed 60", {"ppk": acc(roi=0.02, buffer=0)}, 55, 56),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=55))
    y = result.years[-1]
    # PPK balance at start of realization — after forfeit, only employee portion remains
    remaining = y.balances["ppk"]

    # Po przepadku: gain_share = (remaining - emp_basis) / remaining
    # PMT na 1 rok wypłaca remaining, podatek 19% od zysku
    expected_tax = max(0.0, (remaining - emp_basis)) * 0.19
    assert y.tax_paid == pytest.approx(expected_tax, abs=1.0)
    assert result.total_withdrawn > 0
    # Przepadek: oryginalne saldo było większe (fraction < 1)
    total_original = remaining * total_basis / emp_basis
    assert result.total_withdrawn < total_original


def test_ppk_in_accounts_list():
    stages = [accumulation_stage({"ppk": acc(monthly_base=8000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "ppk" in result.accounts


# --- Ostrzeżenia ---


def test_ppk_warning_sum_over_8pct():
    stages = [
        accumulation_stage(
            {"ppk": acc(monthly_base=8000, employee_pct=0.06, employer_pct=0.04)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("przekracza ustawowy limit 8%" in w for w in result.warnings)


def test_ppk_early_withdrawal_forfeit_no_warning():
    stages = [
        accumulation_stage(
            {"ppk": acc(starting_balance=50000, monthly_base=8000)}, start=40, end=55
        ),
        realization_stage("PPK przed 60", {"ppk": acc(roi=0.02, buffer=0)}, 55, 60),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    # Przepadek jest zamodelowany — brak ostrzeżenia "tylko wpłaty własne"
    assert not any("tylko wpłaty własne" in w for w in result.warnings)
    assert result.total_withdrawn > 0


def test_ppk_starting_balance_treated_as_employee_money():
    # starting_balance bez składek — nie powinien ulec przepadkowi
    stages = [
        accumulation_stage({"ppk": acc(starting_balance=10000)}, start=40, end=55),
        realization_stage("PPK przed 60", {"ppk": acc(roi=0.0, buffer=0)}, 55, 60),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    # Saldo startowe = pieniądze pracownika → nie przepadają
    # Wypłacono co najmniej saldo startowe (brak przepadku)
    assert result.total_withdrawn >= 10000
