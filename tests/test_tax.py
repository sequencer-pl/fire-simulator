import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.core.tax import danina_solidarnosciowa, scale_tax
from app.simulation.config import TaxConfig, backfill_tax_config, default_config
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

CFG_NOINFL = TaxConfig(inflation=0.0)

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


# --- Skala PIT 2027 (projekt UD458): 12% do 130k, 24% do 150k, 32% powyżej ---


def _scale_2027(income: float) -> float:
    return scale_tax(
        income,
        kwota_wolna=30_000,
        prog=130_000,
        prog2=150_000,
        rate_lower=0.12,
        rate_middle=0.24,
        rate_upper=0.32,
    )


@pytest.mark.parametrize(
    "income,expected",
    [
        (0, 0),
        (30_000, 0),  # kwota wolna bez zmian
        (130_000, 12_000),  # koniec I progu: 130k*12% - 3600
        (140_000, 14_400),  # 12000 + 24%*10k
        (150_000, 16_800),  # 12000 + 24%*20k
        (180_000, 26_400),  # 16800 + 32%*30k
    ],
)
def test_scale_tax_2027_draft(income, expected):
    assert _scale_2027(income) == pytest.approx(expected)


@pytest.mark.parametrize(
    "income,old,new,saving",
    [
        (120_000, 10_800, 10_800, 0),
        (125_000, 12_400, 11_400, 1_000),
        (130_000, 14_000, 12_000, 2_000),
        (140_000, 17_200, 14_400, 2_800),
        (150_000, 20_400, 16_800, 3_600),
        (180_000, 30_000, 26_400, 3_600),
    ],
)
def test_scale_2027_savings_vs_2026(income, old, new, saving):
    assert scale_tax(income) == pytest.approx(old)
    assert _scale_2027(income) == pytest.approx(new)
    assert scale_tax(income) - _scale_2027(income) == pytest.approx(saving)


def test_scale_tax_backward_compat_none():
    # prog2=None musi dawać bit-w-bit stary wynik 2-progowy.
    for income in (0, 30_000, 100_000, 120_000, 200_000, 1_500_000):
        assert scale_tax(income, prog2=None, rate_middle=None) == pytest.approx(
            scale_tax(income)
        )


def test_danina_solidarnosciowa():
    assert danina_solidarnosciowa(900_000) == 0
    assert danina_solidarnosciowa(1_200_000) == pytest.approx(200_000 * 0.04)
    assert danina_solidarnosciowa(1_200_000, danina_rate=0.05) == pytest.approx(
        200_000 * 0.05
    )


def test_default_config_years():
    cfg26 = default_config()
    assert cfg26.year == 2026
    assert cfg26.prog == 120_000
    assert cfg26.prog2 is None
    assert cfg26.rate_middle is None
    assert cfg26.danina_rate == pytest.approx(0.04)
    cfg27 = default_config(2027)
    assert cfg27.year == 2027
    assert cfg27.prog == 130_000
    assert cfg27.prog2 == 150_000
    assert cfg27.rate_middle == pytest.approx(0.24)
    assert cfg27.danina_rate == pytest.approx(0.05)
    assert cfg27.kup_50_limit == 130_000


def test_backfill_tax_config_old_shape():
    old = {"kwota_wolna": 30_000, "prog": 120_000, "inflation": 0.0}
    filled = backfill_tax_config(dict(old))
    cfg = TaxConfig.model_validate(filled)
    assert cfg.prog2 is None
    assert cfg.rate_middle is None
    assert cfg.year == 2026
    assert cfg.danina_rate == pytest.approx(0.04)


def test_engine_2027_zus_bracket():
    # ZUS 140k/rok: 2026 -> 17200, 2027 -> 14400 (oszczędność 2800).
    cfg27 = default_config(2027)
    cfg27.inflation = 0.0
    stages = [realization_stage("ZUS", {"zus": acc(monthly_pension=140_000 / 12)}, 67, 68)]
    r27 = simulate(SimulationInput(stages=stages, max_age=67, config=cfg27))
    r26 = simulate(SimulationInput(stages=stages, max_age=67, config=CFG_NOINFL))
    assert r27.years[0].tax_paid == pytest.approx(14_400, rel=1e-3)
    assert r26.years[0].tax_paid == pytest.approx(17_200, rel=1e-3)


# --- IKZE po 65: 10% ryczałt od całości ---


def test_ikze_after_65_flat_10_percent():
    stages = [
        accumulation_stage({"ikze": acc(starting_balance=500_000, roi=0.0)}, start=40, end=65),
        realization_stage("IKZE", {"ikze": acc(roi=0.0, buffer=0)}, 65, 70),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=69, config=CFG_NOINFL))
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
    result = simulate(SimulationInput(stages=stages, max_age=54, config=CFG_NOINFL))
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
    result = simulate(SimulationInput(stages=stages, max_age=69, config=CFG_NOINFL))
    assert result.years[10].tax_paid == pytest.approx(132_400, rel=1e-3)
    assert all(y.tax_paid == 0 for y in result.years[11:])


# --- IKE przed 60: Belka od zysku; po 60: 0% ---


def test_ike_before_60_gains_tax_then_tax_free():
    stages = [
        accumulation_stage({"ike": acc(starting_balance=100_000, roi=0.02)}, start=40, end=50),
        realization_stage("IKE", {"ike": acc(roi=0.02, buffer=0)}, 50, 65),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=64, config=CFG_NOINFL))

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
    r1 = simulate(SimulationInput(stages=stages_no_gain, max_age=49, config=CFG_NOINFL))
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
    r2 = simulate(SimulationInput(stages=stages_gain, max_age=49, config=CFG_NOINFL))
    assert sum(y.tax_paid for y in r2.years) > 0


# --- ZUS opodatkowany skalą, wspólna kwota wolna z IKZE-early ---


def test_zus_scale_tax_with_kwota_wolna():
    stages = [realization_stage("ZUS", {"zus": acc(monthly_pension=2_000)}, 67, 100)]
    result = simulate(SimulationInput(stages=stages, max_age=100, config=CFG_NOINFL))
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
    result = simulate(SimulationInput(stages=stages, max_age=69, config=CFG_NOINFL))
    assert any("IKZE" in w and "skali" in w for w in result.warnings)


def test_warning_ike_before_60():
    stages = [realization_stage("IKE", {"ike": acc(starting_balance=200_000)}, 50, 70)]
    result = simulate(SimulationInput(stages=stages, max_age=69, config=CFG_NOINFL))
    assert any("IKE" in w and "19%" in w for w in result.warnings)


def test_warning_over_limit_contribution():
    stages = [
        accumulation_stage({"ikze": acc(annual_contribution=20_000)}, start=40, end=45),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44, config=CFG_NOINFL))
    assert any("limit" in w and "IKZE" in w for w in result.warnings)


def test_warning_ikze_limit_self_employed_ok():
    stages = [
        accumulation_stage(
            {"ikze": acc(annual_contribution=15_000, ikze_limit="self_employed")},
            start=40,
            end=45,
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44, config=CFG_NOINFL))
    assert not any("limit" in w and "IKZE" in w for w in result.warnings)


def test_warning_ikze_limit_self_employed_over():
    stages = [
        accumulation_stage(
            {"ikze": acc(annual_contribution=18_000, ikze_limit="self_employed")},
            start=40,
            end=45,
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44, config=CFG_NOINFL))
    assert any("16,956" in w and "IKZE" in w for w in result.warnings)


def test_scale_tax_indexed_with_inflation():
    # Emerytura 4500 zł/mies. (54k/rok) po 35 latach akumulacji nie wpada w II próg 32%
    # wskutek inflacji — progi podatkowe rosną razem z inflacją.
    stages = [
        accumulation_stage({"broker": acc(starting_balance=10_000, roi=0.0)}, start=30, end=65),
        realization_stage("ZUS", {"zus": acc(monthly_pension=4_500)}, 65, 70),
    ]
    r_noinfl = simulate(SimulationInput(stages=stages, max_age=69, config=TaxConfig(inflation=0.0)))
    r_infl = simulate(
        SimulationInput(stages=stages, max_age=69, config=TaxConfig(inflation=0.025))
    )
    y_noinfl = next(y for y in r_noinfl.years if y.age == 65)
    y_infl = next(y for y in r_infl.years if y.age == 65)
    assert y_infl.tax_paid == pytest.approx(y_noinfl.tax_paid, abs=0.01)


def test_ikze_saving_reinvested_into_broker():
    # Zwrot podatku z wpłaty na IKZE powiększa saldo aktywnego konta maklerskiego.
    stages_solo = [
        accumulation_stage({"broker": acc(starting_balance=10_000, roi=0.0)}, start=40, end=42),
    ]
    stages_with_ikze = [
        accumulation_stage(
            {
                "broker": acc(starting_balance=10_000, roi=0.0),
                "ikze": acc(annual_contribution=11_304, roi=0.0),
            },
            start=40,
            end=42,
        ),
    ]
    r_solo = simulate(
        SimulationInput(stages=stages_solo, max_age=41, monthly_gross=10_000, config=CFG_NOINFL)
    )
    r_ikze = simulate(
        SimulationInput(
            stages=stages_with_ikze, max_age=41, monthly_gross=10_000, config=CFG_NOINFL
        )
    )
    assert r_ikze.years[1].balances["broker"] > r_solo.years[1].balances["broker"]


def test_ikze_saving_does_not_create_phantom_withdrawal():
    # Ulga z wpłaty na IKZE obniża podatek, ale nie jest wypłatą z portfela.
    for accounts in (
        {"ikze": acc(annual_contribution=11_304, roi=0.0)},
        {
            "broker": acc(starting_balance=10_000, roi=0.0),
            "ikze": acc(annual_contribution=11_304, roi=0.0),
        },
    ):
        result = simulate(
            SimulationInput(
                stages=[accumulation_stage(accounts, start=40, end=42)],
                max_age=41,
                monthly_gross=10_000,
                config=CFG_NOINFL,
            )
        )
        assert all(y.annual_withdrawal == 0 for y in result.years)
        assert result.total_withdrawn == 0
        assert result.total_tax == pytest.approx(-2_712.96)
        assert result.years[0].tax_paid == pytest.approx(-1_356.48)
