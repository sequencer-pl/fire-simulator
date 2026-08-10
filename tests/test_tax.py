import pytest

from app.core.tax import flat_tax, scale_tax
from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import AccountConfig, SimulationInput, StageInput


def acc(**kwargs):
    return AccountConfig(**kwargs)


def accumulation_stage(accounts, start=40, end=45):
    return StageInput(
        stage_type="akumulacja", name="Akumulacja", start_age=start, end_age=end, accounts=accounts
    )


def realization_stage(name, accounts, start, end):
    return StageInput(
        stage_type="realizacja", name=name, start_age=start, end_age=end, accounts=accounts
    )


# --- Skala PIT 2026 ---


@pytest.mark.parametrize(
    "income,expected",
    [
        (0, 0),
        (30_000, 0),  # kwota wolna
        (36_000, 720),  # 12% powyżej kwoty wolnej
        (120_000, 10_800),  # koniec I progu
        (200_000, 36_400),  # II próg: 10800 + 32%*80000
    ],
)
def test_scale_tax(income, expected):
    assert scale_tax(income) == pytest.approx(expected)


def test_flat_tax():
    assert flat_tax(100_000, 0.19) == pytest.approx(19_000)
    assert flat_tax(0, 0.19) == 0


# --- IKZE po 65: 10% ryczałt od całości ---


def test_ikze_after_65_flat_10_percent():
    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=65),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    y = result.years[25]
    # 500k rozłożone na 5 lat PMT = 100k/rok brutto; 10% podatku od całości -> 90k netto
    assert y.annual_withdrawal == pytest.approx(90_000, rel=1e-3)
    assert y.tax_paid == pytest.approx(10_000, rel=1e-3)


# --- IKZE przed 65: jednorazowy zwrot całości, skala PIT ---


def test_ikze_before_65_zwrot_lump_tax():
    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=50),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 50, 55),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=54))
    lump = result.years[10]
    # Zwrot całości w 50 r.ż.: skala 2026 od 500k = 132 400 zł.
    # Kapitał netto 367 600 zł rozłożony PMT na 5 lat -> 73 520 zł/rok.
    assert lump.tax_paid == pytest.approx(132_400, rel=1e-3)
    assert lump.annual_withdrawal == pytest.approx(73_520, rel=1e-3)
    assert lump.balances["ikze"] == pytest.approx(500_000)
    for y in result.years[11:]:
        assert y.tax_paid == 0
        assert y.annual_withdrawal == pytest.approx(73_520, rel=1e-3)
    assert result.total_tax == pytest.approx(132_400, rel=1e-3)
    assert result.total_withdrawn == pytest.approx(367_600, rel=1e-3)


def test_ikze_zwrot_no_tax_after_65():
    # Po jednorazowym zwrocie przed 65 r.ż. kolejne lata (także po 65) nie są
    # ponownie opodatkowane (brak podwójnego opodatkowania 10% ryczałtem).
    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=50),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 50, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert result.years[10].tax_paid == pytest.approx(132_400, rel=1e-3)
    assert all(y.tax_paid == 0 for y in result.years[11:])


# --- IKE przed 60: Belka od zysku; po 60: 0% ---


def test_ike_before_60_gains_tax_then_tax_free():
    stages = [
        accumulation_stage({"ike": acc(starting_balance=100_000, roi=0.02)}, start=40, end=50),
        realization_stage("IKE", {"ike": acc(roi=0.02, buffer=0)}, 50, 65),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=64))

    early = result.years[10]
    assert early.tax_paid > 0  # Belka od zysku przed 60

    late = result.years[20]
    assert late.tax_paid == 0  # po 60 bez podatku


# --- Broker: Belka tylko od zysku (kapitał bez podatku) ---


def test_broker_taxes_gains_only():
    # Kapitał 100k, brak wzrostu -> zysk 0 -> podatek 0
    stages_no_gain = [
        accumulation_stage({"broker": acc(starting_balance=100_000, roi=0.0)}, start=40, end=45),
        realization_stage("Broker", {"broker": acc(roi=0.0, buffer=0)}, 45, 50),
    ]
    r1 = simulate(SimulationInput(stages=stages_no_gain, max_age=49))
    assert r1.years[5].tax_paid == 0

    # Wzrost 20% -> część wypłat to zysk -> podatek > 0
    stages_gain = [
        accumulation_stage({"broker": acc(starting_balance=100_000, roi=0.0)}, start=40, end=45),
        realization_stage(
            "Broker",
            {"broker": acc(roi=0.2, buffer=0)},
            45,
            50,
        ),
    ]
    r2 = simulate(SimulationInput(stages=stages_gain, max_age=49))
    assert sum(y.tax_paid for y in r2.years) > 0


# --- ZUS opodatkowany skalą, wspólna kwota wolna z IKZE-early ---


def test_zus_scale_tax_with_kwota_wolna():
    stages = [realization_stage("ZUS", {"zus": acc(monthly_pension=2_000)}, 67, 100)]
    result = simulate(SimulationInput(stages=stages, max_age=100))
    y = result.years[0]
    # 24k/rok < kwota wolna 30k -> podatek 0
    assert y.tax_paid == 0
    assert y.monthly_withdrawal == pytest.approx(2_000)


# --- Konfiguracja nadpisuje domyślne stawki ---


def test_custom_config_belka_zero():
    config = default_config()
    config.accounts["broker"].tax_rate = 0.0
    stages = [
        accumulation_stage({"broker": acc(starting_balance=100_000, roi=0.1)}, start=40, end=45),
        realization_stage("Broker", {"broker": acc(roi=0.1, buffer=0)}, 45, 50),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49, config=config))
    assert result.years[5].tax_paid == 0


# --- Ostrzeżenia ---


def test_warning_ikze_before_65():
    stages = [
        accumulation_stage({"ikze": acc(starting_balance=200_000)}, start=40, end=50),
        realization_stage("IKZE", {"ikze": acc(roi=0.02)}, 50, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert any("IKZE" in w and "skali" in w for w in result.warnings)


def test_warning_ike_before_60():
    stages = [realization_stage("IKE", {"ike": acc(starting_balance=200_000)}, 50, 70)]
    result = simulate(SimulationInput(stages=stages, max_age=69))
    assert any("IKE" in w and "19%" in w for w in result.warnings)


def test_warning_over_limit_contribution():
    stages = [
        accumulation_stage({"ikze": acc(annual_contribution=20_000)}, start=40, end=45),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44))
    assert any("limit" in w and "IKZE" in w for w in result.warnings)


def test_warning_ikze_limit_self_employed_ok():
    stages = [
        accumulation_stage(
            {"ikze": acc(annual_contribution=15_000, ikze_limit="self_employed")},
            start=40,
            end=45,
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44))
    assert not any("limit" in w and "IKZE" in w for w in result.warnings)


def test_warning_ikze_limit_self_employed_over():
    stages = [
        accumulation_stage(
            {"ikze": acc(annual_contribution=18_000, ikze_limit="self_employed")},
            start=40,
            end=45,
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44))
    assert any("16,956" in w and "IKZE" in w for w in result.warnings)
