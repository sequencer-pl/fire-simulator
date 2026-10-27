import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.simulation.config import TaxConfig
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

CFG_NOINFL = TaxConfig(inflation=0.0)
CFG_INFL = TaxConfig(inflation=0.025)

# --- Gotówka: akumulacja kurczy saldo (ujemny ROI = inflacja) ---


def test_gotowka_accumulation_negative_roi():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=100000)})]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_INFL))
    assert result.years[1].balances["gotowka"] == pytest.approx(100000 * 0.975)


def test_gotowka_no_contributions():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=100000)})]
    result = simulate(SimulationInput(stages=stages, max_age=42, config=CFG_INFL))
    # brak dopłat — po 2 latach tylko sama erozja
    assert result.years[2].balances["gotowka"] == pytest.approx(100000 * 0.975**2)


def test_gotowka_tax_none_even_with_positive_roi():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=100000)}, start=40, end=60),
        realization_stage("Gotówka", {"gotowka": acc(buffer=0)}, 60, 61),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=60, config=CFG_INFL))
    assert result.total_tax == 0.0
    assert result.total_withdrawn > 0


def test_gotowka_in_accounts_list():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40, config=CFG_INFL))
    assert "gotowka" in result.accounts


# --- Realizacja z ujemną stopą: dodatnia wypłata, bez wyjątku ---


def test_gotowka_realization_negative_roi_positive_withdrawal():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=100000)}, start=40, end=60),
        realization_stage("Gotówka", {"gotowka": acc(buffer=0)}, 60, 65),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=64, config=CFG_INFL))
    assert result.total_withdrawn > 0
    assert any(y.monthly_withdrawal > 0 for y in result.years)


# --- Ostrzeżenia o braku inflacji (ROI >= 0%) ---


def test_gotowka_warning_at_zero_roi():
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40, config=CFG_NOINFL))
    assert any("Gotówka" in w and "deflacj" in w for w in result.warnings)


def test_gotowka_warning_positive_roi():
    # Gotówka czyta inflację globalną — brak własnego ROI
    # Testujemy że przy braku inflacji ostrzeżenie występuje
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40, config=CFG_NOINFL))
    assert any("Gotówka" in w for w in result.warnings)


def test_gotowka_no_warning_with_negative_roi():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=10000)}, start=40, end=45),
        realization_stage("Gotówka", {"gotowka": acc(buffer=0)}, 45, 50),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49, config=CFG_INFL))
    assert not any("Gotówka" in w for w in result.warnings)


def test_gotowka_warning_deduplicated_across_stages():
    stages = [
        accumulation_stage({"gotowka": acc(starting_balance=10000)}, start=40, end=45),
        realization_stage("Gotówka", {"gotowka": acc(buffer=0)}, 45, 50),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49, config=CFG_NOINFL))
    gotowka_warnings = [w for w in result.warnings if "Gotówka" in w]
    assert len(gotowka_warnings) == 1


# --- Walidacja ROI <= -100% ---


def test_gotowka_roi_at_minus_100_raises():
    # Gotówka nie ma już własnego ROI, więc walidacja dotyczy inflacji
    # Przy inflacji 100% gotówka -100% — granica
    cfg = TaxConfig(inflation=1.0)
    stages = [accumulation_stage({"gotowka": acc(starting_balance=10000)})]
    with pytest.raises(ValueError):
        simulate(SimulationInput(stages=stages, max_age=40, config=cfg))


def test_any_account_roi_below_minus_100_raises():
    with pytest.raises(ValueError):
        stages = [accumulation_stage({"broker": acc(starting_balance=10000, roi=-1.5)})]
        simulate(SimulationInput(stages=stages, max_age=40, config=CFG_NOINFL))
