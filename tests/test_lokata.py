import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.simulation.config import TaxConfig
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

CFG_NOINFL = TaxConfig(inflation=0.0)

# --- Lokata: Belka naliczana co interwał (tax_periodic) ---

TAX = 0.19
ROI = 0.05
BAL = 100_000


def net_balance_after(intervals_in_year, years):
    """Compound balance after full years with periodic Belka — ROI is REAL netto."""
    rate = ROI / intervals_in_year
    mult = (1 + rate) ** intervals_in_year
    return BAL * mult**years


def test_lokata_annual_term_no_contribution():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    assert result.years[1].balances["lokata"] == pytest.approx(net_balance_after(1, 1))


def test_lokata_annual_term_two_years():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})]
    result = simulate(SimulationInput(stages=stages, max_age=42, config=CFG_NOINFL))
    assert result.years[2].balances["lokata"] == pytest.approx(net_balance_after(1, 2))


def test_lokata_quarterly_term_compounds_more():
    stages = [
        accumulation_stage(
            {
                "lokata": acc(
                    starting_balance=BAL,
                    roi=ROI,
                    lokata_term_months=3,
                )
            }
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    assert result.years[1].balances["lokata"] == pytest.approx(net_balance_after(4, 1))


def test_lokata_monthly_term_compounds_more():
    stages = [
        accumulation_stage(
            {
                "lokata": acc(
                    starting_balance=BAL,
                    roi=ROI,
                    lokata_term_months=1,
                )
            }
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    assert result.years[1].balances["lokata"] == pytest.approx(net_balance_after(12, 1))


def test_lokata_shorter_term_greater_balance():
    annual = simulate(
        SimulationInput(
            stages=[accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})],
            max_age=41,
        )
    )
    quarterly = simulate(
        SimulationInput(
            stages=[
                accumulation_stage(
                    {
                        "lokata": acc(
                            starting_balance=BAL,
                            roi=ROI,
                            lokata_term_months=3,
                        )
                    }
                )
            ],
            max_age=41,
        )
    )
    assert quarterly.years[1].balances["lokata"] > annual.years[1].balances["lokata"]


def test_lokata_tax_paid_equals_interest_tax():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    brutto = ROI / (1 - TAX)
    interest_nom = BAL * brutto
    assert result.years[0].tax_paid == pytest.approx(interest_nom * TAX)


def test_lokata_annual_contribution_added_after_growth():
    contribution = 10_000
    stages = [
        accumulation_stage(
            {
                "lokata": acc(
                    starting_balance=BAL,
                    roi=ROI,
                    annual_contribution=contribution,
                )
            }
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    expected = net_balance_after(1, 1) + contribution
    assert result.years[1].balances["lokata"] == pytest.approx(expected)


def test_lokata_no_positive_roi_no_tax():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=0)})]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    assert result.years[1].balances["lokata"] == pytest.approx(BAL)
    assert result.years[1].tax_paid == 0.0


def test_lokata_realization_not_double_taxed():
    stages = [
        accumulation_stage(
            {"lokata": acc(starting_balance=BAL, roi=ROI)},
            start=40,
            end=50,
        ),
        realization_stage("Lokata", {"lokata": acc(roi=ROI, buffer=0)}, 50, 55),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=54, config=CFG_NOINFL))
    # Tax was paid annually during accumulation — no additional Belka at withdrawal.
    balance_45 = net_balance_after(1, 5)
    assert result.years[5].balances["lokata"] == pytest.approx(balance_45)


def test_lokata_accumulation_tax_recorded_across_years():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})]
    result = simulate(SimulationInput(stages=stages, max_age=43, config=CFG_NOINFL))
    assert result.total_tax > 0
    brutto = ROI / (1 - TAX)
    assert result.years[0].tax_paid == pytest.approx(BAL * brutto * TAX)
