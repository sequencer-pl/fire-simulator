import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

# --- OKI: osobne konta inwestycyjne i oszczędnościowe (2027), brak Belki w limicie ---


def test_oki_default_rules():
    cfg = default_config()
    inw = cfg.accounts["oki_inw"]
    assert inw.tax_model == "assets"
    assert inw.asset_tax_rate == pytest.approx(0.0085)
    assert inw.asset_exemption == 100_000
    assert inw.asset_group == "oki"
    assert inw.asset_class == "inwestycyjne"
    osk = cfg.accounts["oki_osk"]
    assert osk.tax_model == "assets"
    assert osk.asset_tax_rate == pytest.approx(0.0085)
    assert osk.asset_exemption == 25_000
    assert osk.asset_class == "oszczednosciowe"


def test_oki_accumulation_like_broker():
    stages = [
        accumulation_stage(
            {"oki_inw": acc(starting_balance=10000, annual_contribution=5000, roi=0.02)}
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    assert result.years[1].balances["oki_inw"] == pytest.approx(10000 * 1.02 + 5000)


def test_oki_no_tax_below_limit_full_cycle():
    stages = [
        accumulation_stage(
            {"oki_inw": acc(starting_balance=10000, annual_contribution=0, roi=0.02)},
            start=40,
            end=65,
        ),
        realization_stage("OKI", {"oki_inw": acc(roi=0.02, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert result.total_tax == 0.0
    assert result.total_withdrawn > 0


def test_oki_asset_tax_above_100k():
    stages = [
        accumulation_stage(
            {"oki_inw": acc(starting_balance=200000, roi=0.02)}, start=40, end=41
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert result.total_tax == pytest.approx((202000 - 100000) * 0.0085, abs=0.01)
    assert result.final_wealth == pytest.approx(200000 * 1.02 - 867.0, abs=0.5)


def test_oki_savings_assets_limit_25k():
    stages = [
        accumulation_stage(
            {"oki_osk": acc(starting_balance=50000, annual_contribution=0, roi=0.02)},
            start=40,
            end=41,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert result.total_tax == pytest.approx((50500 - 25000) * 0.0085, abs=0.01)


def test_oki_no_belka_on_early_withdrawal():
    stages = [
        realization_stage(
            "OKI przed emeryturą",
            {"oki_inw": acc(starting_balance=200000, roi=0.02, buffer=100000)},
            45,
            46,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=45))
    y = result.years[-1]
    assert y.tax_paid == pytest.approx((150000 - 100000) * 0.0085, abs=0.01)
    assert result.total_tax == y.tax_paid


def test_oki_asset_tax_during_realization():
    stages = [
        realization_stage(
            "OKI realizacja",
            {"oki_inw": acc(starting_balance=200000, roi=0.02, buffer=200000)},
            40,
            43,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=42))
    assert result.total_tax == pytest.approx(3 * 850.0, rel=0.1)
    assert result.final_wealth == pytest.approx(200000.0, rel=0.1)
    assert all(y.tax_paid > 0 for y in result.years)


def test_oki_in_accounts_list():
    stages = [accumulation_stage({"oki_inw": acc(annual_contribution=10000)})]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert "oki_inw" in result.accounts


# --- Wspólny limit OKI (100k łącznie, max 25k w części oszczędnościowej) ---


def _mix(osk, inw, start=40, end=41, roi=0.0):
    stages = [
        accumulation_stage(
            {
                "oki_osk": acc(starting_balance=osk, roi=roi),
                "oki_inw": acc(starting_balance=inw, roi=roi),
            },
            start=start,
            end=end,
        )
    ]
    return simulate(SimulationInput(stages=stages, max_age=end - 1))


def test_oki_mix_25k_osk_75k_inw_no_tax():
    result = _mix(25_000, 75_000)
    assert result.total_tax == 0.0
    assert result.years[0].tax_paid == 0.0


def test_oki_mix_25k_osk_100k_inw_tax_on_25k():
    result = _mix(25_000, 100_000)
    assert result.total_tax == pytest.approx(25_000 * 0.0085, abs=0.01)


def test_oki_mix_50k_osk_50k_inw_tax_on_savings_excess():
    result = _mix(50_000, 50_000)
    assert result.total_tax == pytest.approx(25_000 * 0.0085, abs=0.01)


def test_oki_mix_50k_osk_100k_inw_tax_on_both():
    result = _mix(50_000, 100_000)
    assert result.total_tax == pytest.approx(50_000 * 0.0085, abs=0.01)


def test_oki_mix_0_osk_100k_inw_no_tax():
    result = _mix(0, 100_000)
    assert result.total_tax == 0.0


def test_oki_mix_separate_rois():
    stages = [
        accumulation_stage(
            {
                "oki_osk": acc(starting_balance=15_000, roi=0.02),
                "oki_inw": acc(starting_balance=70_000, roi=0.08),
            },
            start=40,
            end=42,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=41))
    y = result.years[-1]
    assert y.balances["oki_osk"] == pytest.approx(15_000 * 1.02, abs=0.01)
    assert y.balances["oki_inw"] == pytest.approx(70_000 * 1.08, abs=0.01)
    assert result.total_tax == 0.0


def test_oki_mix_25k_osk_75k_inw_exactly_at_limit():
    stages = [
        accumulation_stage(
            {
                "oki_inw": acc(starting_balance=75_000, roi=0.0),
                "oki_osk": acc(starting_balance=25_000, roi=0.0),
            },
            start=40,
            end=41,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=40))
    assert result.total_tax == 0.0
