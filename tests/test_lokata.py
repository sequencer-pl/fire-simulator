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
    """Compound balance after full years — ROI is REAL brutto, Belka co okres."""
    gross = (1 + ROI) ** (1 / intervals_in_year) - 1
    net = gross * (1 - TAX)
    return BAL * ((1 + net) ** intervals_in_year) ** years


def test_lokata_annual_term_no_contribution():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    assert result.years[1].balances["lokata"] == pytest.approx(net_balance_after(1, 1))


def test_lokata_annual_term_two_years():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})]
    result = simulate(SimulationInput(stages=stages, max_age=42, config=CFG_NOINFL))
    assert result.years[2].balances["lokata"] == pytest.approx(net_balance_after(1, 2))


def test_lokata_quarterly_term_balance():
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


def test_lokata_monthly_term_balance():
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


def test_lokata_annual_term_beats_quarterly_after_tax():
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
    # Przy brutto ROI częstsza Belka obniża kapitalizację: roczna lokata
    # wygrywa z kwartalną, bo podatek płacony jest rzadziej.
    assert annual.years[1].balances["lokata"] > quarterly.years[1].balances["lokata"]


def test_lokata_tax_paid_equals_interest_tax():
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)})]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=CFG_NOINFL))
    interest_nom = BAL * ROI
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
    assert result.years[0].tax_paid == pytest.approx(BAL * ROI * TAX)


def test_lokata_gross_roi_with_inflation():
    from app.core.inflation import fisher_nominal, fisher_real

    inflation = 0.025
    cfg = TaxConfig(inflation=inflation)
    stages = [accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)}, start=40, end=42)]
    result = simulate(SimulationInput(stages=stages, max_age=41, config=cfg))
    gross_nominal = fisher_nominal(ROI, inflation)
    expected_net_real = fisher_real(gross_nominal * (1 - TAX), inflation)
    assert result.years[1].balances["lokata"] == pytest.approx(BAL * (1 + expected_net_real))


def test_lokata_gap_uses_net_periodic_growth():
    stages = [
        accumulation_stage({"lokata": acc(starting_balance=BAL, roi=ROI)}, start=40, end=50),
        accumulation_stage({"broker": acc(starting_balance=1000, roi=0.0)}, start=60, end=70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69, config=CFG_NOINFL))
    year_60 = next(y for y in result.years if y.age == 60)
    expected = BAL * (1 + ROI * (1 - TAX)) ** 20
    assert year_60.balances["lokata"] == pytest.approx(expected)


# --- Lokata wieloletnia (>12 mies.): Belka tylko na koniec okresu ---

BRUTTO_ANNUAL = ROI  # ROI jest teraz realnym brutto


def mult_year_balance(term_months, years, config=CFG_NOINFL):
    stages = [
        accumulation_stage(
            {
                "lokata": acc(
                    starting_balance=BAL,
                    roi=ROI,
                    lokata_term_months=term_months,
                )
            }
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40 + years, config=config))
    return result.years[years].balances["lokata"]


def test_lokata_two_year_exact_balance():
    # Ręczne wyliczenie dla 24 mies. (Belka tylko na koniec 2. roku):
    # rok1: 100000 * (1+brutto); rok2: skumulowane odsetki brutto opodatkowane.
    b1 = BAL * (1 + BRUTTO_ANNUAL)
    interest2 = BAL * BRUTTO_ANNUAL + b1 * BRUTTO_ANNUAL
    expected = b1 * (1 + BRUTTO_ANNUAL) - interest2 * TAX
    assert mult_year_balance(24, 2) == pytest.approx(expected)


def test_lokata_multi_year_greater_than_annual_at_maturity():
    # Porównanie w punkcie wspólnej zapadalności (2 i 4 lata).
    assert mult_year_balance(24, 2) > mult_year_balance(12, 2)
    assert mult_year_balance(36, 3) > mult_year_balance(12, 3)
    assert mult_year_balance(24, 4) > mult_year_balance(12, 4)


def test_lokata_longer_term_deferral_benefit_over_full_terms():
    # 12m, 24m, 36m, 60m — po pełnych okresach dłuższe = więcej (odroczenie Belki).
    at12 = mult_year_balance(60, 12)
    assert mult_year_balance(24, 12) > mult_year_balance(12, 12)
    assert mult_year_balance(36, 12) > mult_year_balance(24, 12)
    assert at12 > mult_year_balance(24, 12)


def test_lokata_multi_year_tax_only_at_maturity():
    stages = [
        accumulation_stage(
            {"lokata": acc(starting_balance=BAL, roi=ROI, lokata_term_months=24)}
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=45, config=CFG_NOINFL))
    # 24 mies. (=2 lata), start_age=40. years[k] ma age=40+k; Belka jest w latach,
    # gdzie (k) % 2 == 1, czyli na końcu 2-letniego okresu.
    assert result.years[1].tax_paid > 0.0  # age 41 = koniec pierwszego 2-letniego okresu
    assert result.years[2].tax_paid == pytest.approx(0.0)  # age 42 = środek okresu
    assert result.years[3].tax_paid > 0.0  # age 43 = koniec drugiego okresu
    assert result.years[4].tax_paid == pytest.approx(0.0)  # age 44 = środek okresu


def test_lokata_multi_year_with_inflation_positive():
    cfg = TaxConfig(inflation=0.025)
    # Z inflacją model wieloletni nadal działa i daje rozsądne dodatnie saldo.
    assert mult_year_balance(36, 6, config=cfg) > 0
    assert mult_year_balance(36, 6, config=cfg) > mult_year_balance(12, 6, config=cfg)

