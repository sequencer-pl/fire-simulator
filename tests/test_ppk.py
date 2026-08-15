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


def test_ppk_early_withdrawal_taxed_19pct_on_gains():
    base = 8000
    contrib_first = base * 12 * 0.035 + 250 + 240
    contrib_next = base * 12 * 0.035 + 240
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
    acc_only = simulate(SimulationInput(stages=[accumulation], max_age=54))
    bal = acc_only.final_wealth
    contributions = contrib_first + contrib_next * 14
    assert bal > contributions

    stages = [
        accumulation,
        realization_stage("PPK przed 60", {"ppk": acc(roi=0.02, buffer=0)}, 55, 56),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=55))
    y = result.years[-1]
    # jednookresowy annuitet wypłaca całość — Belka 19% od zysku
    assert y.tax_paid == pytest.approx((bal - contributions) * 0.19, abs=0.5)


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


def test_ppk_early_withdrawal_own_contrib_warning():
    stages = [
        accumulation_stage(
            {"ppk": acc(starting_balance=50000, monthly_base=8000)}, start=40, end=55
        ),
        realization_stage("PPK przed 60", {"ppk": acc(roi=0.02, buffer=0)}, 55, 60),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    assert any("tylko wpłaty własne" in w for w in result.warnings)
