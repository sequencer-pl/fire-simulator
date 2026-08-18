"""Testy mechanizmu jednorazowego zwrotu IKZE przed 65 r.ż.

Model: w pierwszym roku etapu realizacji przed wiekiem uprawniającym podatek
wg skali PIT jest potrącany od CAŁOŚCI salda, a wypłaty ratalne są liczone
(PMT) od kapitału netto ("wypłata + lokata"). Konto jest oznaczane jako
"zwrócone" — kolejne wypłaty (także po 65 r.ż.) nie są ponownie opodatkowane.

Gdy w tym samym roku występuje też emerytura ZUS (skala), oba dochody są
łączone w jednym wezwaniu scale_tax() ze wspólną kwotą wolną.
"""

import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.core.pmt import pmt
from app.core.tax import scale_tax
from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput


def ikze_zwrot_scenario(balance, start=50, end=55, roi=0.0, buffer=0.0):
    """500k -> podatek skali 132 400; kapitał netto PMT na raty."""
    return simulate(
        SimulationInput(
            stages=[
                accumulation_stage(
                    {"ikze": acc(starting_balance=balance, roi=0.0)}, start=40, end=start
                ),
                realization_stage("IKZE", {"ikze": acc(roi=roi, buffer=buffer)}, start, end),
            ],
            max_age=end - 1,
        )
    )


# --- Konserwacja kapitału: podatek + wypłaty netto = kapitał wyjściowy ---


def test_zwrot_conservation_roi_zero():
    result = ikze_zwrot_scenario(500_000)
    assert result.total_tax == pytest.approx(132_400, rel=1e-3)
    assert result.total_withdrawn == pytest.approx(367_600, rel=1e-3)
    # podatek + wypłaty netto wyczerpują kapitał co do złotówki
    assert result.total_tax + result.total_withdrawn == pytest.approx(500_000, rel=1e-3)
    assert result.final_wealth == pytest.approx(0)


def test_zwrot_lump_is_one_off_at_stage_start():
    result = ikze_zwrot_scenario(500_000)
    y0 = result.years[10]  # 50 r.ż.
    y1 = result.years[11]  # 51 r.ż.
    assert y0.tax_paid == pytest.approx(132_400, rel=1e-3)
    assert y0.annual_withdrawal == pytest.approx(73_520, rel=1e-3)
    assert y0.balances["ikze"] == pytest.approx(500_000)  # saldo startowe przed zwrotem
    assert y1.balances["ikze"] == pytest.approx(294_080, rel=1e-3)  # 367 600 - 73 520
    assert all(y.tax_paid == 0 for y in result.years[11:])


# --- Granica 65 r.ż.: powyżej brak zwrotu, ryczałt 10% od każdej wypłaty ---


def test_zwrot_boundary_at_65_no_lump():
    stages_after = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=65),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages_after, max_age=69))
    assert result.total_tax == pytest.approx(50_000, rel=1e-3)  # 10% od każdej raty
    assert result.years[25].tax_paid == pytest.approx(10_000, rel=1e-3)
    assert result.years[25].annual_withdrawal == pytest.approx(90_000, rel=1e-3)
    assert not any(y.tax_paid == pytest.approx(132_400) for y in result.years)


def test_zwrot_boundary_one_year_early():
    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=64),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 64, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    # Rok wcześniej (64 r.ż.) — pełny zwrot: skala od 500k = 132 400; PMT na 6 lat.
    assert result.years[24].tax_paid == pytest.approx(132_400, rel=1e-3)
    assert result.years[24].annual_withdrawal == pytest.approx(367_600 / 6, rel=1e-3)
    assert all(y.tax_paid == 0 for y in result.years[25:])
    assert result.total_tax + result.total_withdrawn == pytest.approx(500_000, rel=1e-3)


# --- Wzrost w fazie realizacji: zwrot od pełnego salda, PMT od kapitału netto ---


def test_zwrot_with_growth():
    balance = 500_000
    result = ikze_zwrot_scenario(balance, start=50, end=60, roi=0.05)
    net = balance - scale_tax(balance)
    expected_pmt = pmt(0.05, 10, -net, 0.0, when=1)
    assert result.years[10].tax_paid == pytest.approx(132_400, rel=1e-3)
    assert result.years[10].annual_withdrawal == pytest.approx(expected_pmt, rel=1e-3)
    # Od drugiego roku etapu brak podatku — kapitał netto rośnie i jest wypłacany bez opodatkowania
    assert all(y.tax_paid == 0 for y in result.years[11:])
    assert result.total_tax == pytest.approx(132_400, rel=1e-3)
    assert result.final_wealth == pytest.approx(0, abs=1e-3)


# --- Kwota wolna: skala liczy się od pełnego salda, z pełną kwotą wolną ---


@pytest.mark.parametrize(
    "balance,expected_tax,expected_net",
    [
        (25_000, 0, 25_000),  # poniżej kwoty wolnej — brak podatku
        (100_000, 8_400, 91_600),  # (100k - 30k) * 12%
        (500_000, 132_400, 367_600),  # 10 800 + 32% * (500k - 120k)
    ],
)
def test_zwrot_tax_respects_kwota_wolna(balance, expected_tax, expected_net):
    result = ikze_zwrot_scenario(balance)
    assert result.years[10].tax_paid == pytest.approx(expected_tax, abs=1e-2)
    assert result.years[10].annual_withdrawal == pytest.approx(expected_net / 5, rel=1e-3)
    assert result.total_tax == pytest.approx(expected_tax, abs=1e-2)
    assert result.total_withdrawn == pytest.approx(expected_net, rel=1e-3)


# --- Podatek zwrotu nie pomniejsza wypłat innych kont w tym samym roku ---


def test_zwrot_year_mixed_with_broker_belka_is_additive():
    broker_stages = [
        accumulation_stage({"broker": acc(starting_balance=100_000, roi=0.02)}, end=50),
        realization_stage("Broker", {"broker": acc(roi=0.2, buffer=0)}, 50, 55),
    ]
    solo = simulate(SimulationInput(stages=broker_stages, max_age=54))

    combined = simulate(
        SimulationInput(
            stages=[
                *broker_stages,
                accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, end=50),
                realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 50, 55),
            ],
            max_age=54,
        )
    )
    solo_y = solo.years[10]
    combo_y = combined.years[10]
    assert solo_y.tax_paid > 0  # broker płaci Belkę od zysku
    # Podatek zwrotu jest DODATKOWY, nie pochłania wypłaty brokera.
    assert combo_y.tax_paid == pytest.approx(solo_y.tax_paid + 132_400, rel=1e-3)
    assert combo_y.annual_withdrawal == pytest.approx(solo_y.annual_withdrawal + 73_520, rel=1e-3)


def test_zwrot_year_mixed_with_zus_scale_is_additive():
    zus_stages = [realization_stage("ZUS", {"zus": acc(monthly_pension=10_000)}, 50, 55)]
    solo = simulate(SimulationInput(stages=zus_stages, max_age=54))

    combined = simulate(
        SimulationInput(
            stages=[
                *zus_stages,
                accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, end=50),
                realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 50, 55),
            ],
            max_age=54,
        )
    )
    solo_y = solo.years[0]  # ZUS zaczyna w 50 r.ż.
    combo_y = combined.years[10]
    # 120k/rok + 500k IKZE -> scale_tax(620k) = 170 800, prorated.
    assert solo_y.tax_paid == pytest.approx(10_800, rel=1e-3)
    assert combo_y.tax_paid == pytest.approx(170_800, rel=1e-3)
    assert combo_y.annual_withdrawal == pytest.approx(solo_y.annual_withdrawal + 50_194, rel=1e-3)


# --- Kolejny etap realizacji: brak podwójnego opodatkowania zwróconego kapitału ---


def test_zwrot_second_stage_no_double_taxation():
    grown = 500_000 * 1.02**10  # akumulacja 40-50 z ROI 2%
    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.02)}, start=40, end=50),
        # Etap A zostawia bufor 100k (powinien zostać wypłacony w etapie B bez podatku)
        realization_stage("IKZE A", {"ikze": acc(roi=0.02, buffer=100_000)}, 50, 55),
        realization_stage("IKZE B", {"ikze": acc(roi=0.02, buffer=0)}, 55, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))

    assert result.years[10].tax_paid == pytest.approx(scale_tax(grown), rel=1e-3)
    # Od 51 r.ż. aż do końca (także w etapie B) — zero podatku.
    assert all(y.tax_paid == 0 for y in result.years[11:])
    assert result.total_tax == pytest.approx(scale_tax(grown), rel=1e-3)
    # Etap B faktycznie wypłaca zaległy bufor.
    stage_b = [y for y in result.years if y.age >= 55]
    assert all(y.annual_withdrawal > 0 for y in stage_b)


# --- Zwrot dotyczy wyłącznie reżimu "scale" przed wiekiem uprawniającym ---


def test_zwrot_only_for_scale_early_model():
    config = default_config()
    rules = config.accounts["ikze"]
    rules.early_tax_model = "flat"
    rules.early_tax_rate = 0.10

    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=50),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 50, 55),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=54, config=config))

    # Bez zwrotu: ryczałt 10% od każdej wypłaty (PMT od pełnego kapitału).
    assert result.years[10].tax_paid == pytest.approx(10_000, rel=1e-3)
    assert result.years[10].annual_withdrawal == pytest.approx(90_000, rel=1e-3)
    assert result.years[11].balances["ikze"] == pytest.approx(400_000)  # brak potrącenia przed PMT
    assert result.total_tax == pytest.approx(50_000, rel=1e-3)


def test_zwrot_not_triggered_when_early_model_none():
    config = default_config()
    config.accounts["ikze"].early_tax_model = "none"

    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=50),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 50, 55),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=54, config=config))
    assert all(y.tax_paid == 0 for y in result.years)
    assert result.total_withdrawn == pytest.approx(500_000, rel=1e-3)


# --- Zwrot liczy się też, gdy saldo startowe jest zdefiniowane na etapie realizacji ---


def test_zwrot_with_starting_balance_on_realization_stage():
    stages = [realization_stage("IKZE", {"ikze": acc(starting_balance=500_000, roi=0.0)}, 50, 55)]
    result = simulate(SimulationInput(stages=stages, max_age=54))
    assert result.years[0].tax_paid == pytest.approx(132_400, rel=1e-3)
    assert result.years[0].annual_withdrawal == pytest.approx(73_520, rel=1e-3)
    assert result.total_tax + result.total_withdrawn == pytest.approx(500_000, rel=1e-3)
