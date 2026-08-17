import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

# --- Gotówka: akumulacja kurczy saldo (ujemny ROI = inflacja) ---


def test_gotowka_accumulation_negative_roi():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=100000, roi=-0.025)})]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["gotowka"] == pytest.approx(100000 * 0.975)


def test_gotowka_no_contributions():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=100000, roi=-0.025)})
    ]
    result = simulate(SimulationInput(stages=stages, max_age=42))
    # brak dopłat — po 2 latach tylko sama erozja
    assert result.years[2].balances["gotowka"] == pytest.approx(100000 * 0.975**2)


def test_gotowka_tax_none_even_with_positive_roi():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=100000, roi=0.02)}, start=40, end=60),
        realization_stage("Gotówka", {"gotowka": acc(roi=0.02, buffer=0)}, 60, 61),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=60))
    assert result.total_tax == 0.0
    assert result.total_withdrawn > 0


def test_gotowka_in_accounts_list():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000, roi=-0.025)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "gotowka" in result.accounts


# --- Realizacja z ujemną stopą: dodatnia wypłata, bez wyjątku ---


def test_gotowka_realization_negative_roi_positive_withdrawal():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=100000, roi=-0.025)}, start=40, end=60),
        realization_stage("Gotówka", {"gotowka": acc(roi=-0.025, buffer=0)}, 60, 65),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=64))
    assert result.total_withdrawn > 0
    assert any(y.monthly_withdrawal > 0 for y in result.years)


# --- Ostrzeżenia o braku inflacji (ROI >= 0%) ---


def test_gotowka_warning_at_zero_roi():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000, roi=0)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("Gotówka" in w and "deflacj" in w for w in result.warnings)


def test_gotowka_warning_positive_roi():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000, roi=0.03)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert any("Gotówka" in w for w in result.warnings)


def test_gotowka_no_warning_with_negative_roi():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=10000, roi=-0.025)}, start=40, end=45),
        realization_stage("Gotówka", {"gotowka": acc(roi=-0.025, buffer=0)}, 45, 50),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49))
    assert not any("Gotówka" in w for w in result.warnings)


def test_gotowka_warning_deduplicated_across_stages():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=10000, roi=0)}, start=40, end=45),
        realization_stage("Gotówka", {"gotowka": acc(roi=0, buffer=0)}, 45, 50),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49))
    gotowka_warnings = [w for w in result.warnings if "Gotówka" in w]
    assert len(gotowka_warnings) == 1


# --- Walidacja ROI <= -100% ---


def test_gotowka_roi_at_minus_100_raises():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000, roi=-1)})]
    with pytest.raises(ValueError):
        simulate(SimulationInput(stages=stages, max_age=40))


def test_any_account_roi_below_minus_100_raises():
    stages = [accumulation_stage({"broker": acc(starting_balance=10000, roi=-1.5)})]
    with pytest.raises(ValueError):
        simulate(SimulationInput(stages=stages, max_age=40))
