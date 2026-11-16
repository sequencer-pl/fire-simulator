import pytest

import app.simulation.planner as P
from app.core.tax import scale_tax
from app.simulation.config import (
    TaxConfig,
    backfill_tax_config,
    default_config,
    get_builtin_preset,
)

INFL = 0.025

# --- TaxConfig: mnożnik progów -----------------------------------------------


def test_threshold_factor_none_means_thresholds_constant_in_real_terms():
    cfg = TaxConfig(inflation=INFL, prog_indexation=None)
    assert cfg.threshold_factor(0) == 1.0
    assert cfg.threshold_factor(30) == 1.0


def test_threshold_factor_frozen_thresholds_erode_by_inflation():
    cfg = TaxConfig(inflation=INFL, prog_indexation=0.0)
    assert cfg.threshold_factor(0) == 1.0
    assert cfg.threshold_factor(10) == pytest.approx(1 / 1.025**10)


def test_threshold_factor_partial_indexation():
    cfg = TaxConfig(inflation=0.035, prog_indexation=0.01)
    assert cfg.threshold_factor(5) == pytest.approx((1.01 / 1.035) ** 5)


def test_threshold_factor_full_indexation_equals_none():
    cfg = TaxConfig(inflation=INFL, prog_indexation=INFL)
    assert cfg.threshold_factor(20) == pytest.approx(1.0)


def test_scale_kwargs_deflates_thresholds_but_not_rates():
    cfg = default_config(2027)
    cfg.inflation = INFL
    cfg.prog_indexation = 0.0
    f = 1 / 1.025**10
    kw = cfg.scale_kwargs(10)
    assert kw["kwota_wolna"] == pytest.approx(30_000 * f)
    assert kw["prog"] == pytest.approx(130_000 * f)
    assert kw["prog2"] == pytest.approx(150_000 * f)
    assert kw["rate_lower"] == 0.12
    assert kw["rate_middle"] == 0.24
    assert kw["rate_upper"] == 0.32
    assert cfg.danina_prog_at(10) == pytest.approx(1_000_000 * f)
    assert cfg.kup_at(10) == pytest.approx(3600 * f)


def test_scale_kwargs_year_zero_unchanged():
    cfg = TaxConfig(inflation=INFL, prog_indexation=0.0)
    assert cfg.scale_kwargs(0) == TaxConfig(inflation=INFL).scale_kwargs()
    assert cfg.scale_kwargs(0)["prog2"] is None


def test_frozen_thresholds_raise_tax_on_same_real_income():
    cfg = TaxConfig(inflation=INFL, prog_indexation=0.0)
    # 50 000 zł zostaje w I progu także po 20 latach (próg realnie ~73 000 zł)
    income = 50_000
    tax_now = scale_tax(income, **cfg.scale_kwargs(0))
    tax_later = scale_tax(income, **cfg.scale_kwargs(20))
    assert tax_later > tax_now
    # realnie mniejsza kwota wolna -> większy podatek o 12% różnicy kwoty wolnej
    kw_now, kw_later = cfg.scale_kwargs(0), cfg.scale_kwargs(20)
    assert kw_later["prog"] > income
    assert tax_later - tax_now == pytest.approx(
        0.12 * (kw_now["kwota_wolna"] - kw_later["kwota_wolna"])
    )
    # 100 000 zł po 20 latach przekracza już realny próg -> część w 32%
    assert scale_tax(100_000, **kw_later) > scale_tax(100_000, **kw_now) + 0.12 * (
        kw_now["kwota_wolna"] - kw_later["kwota_wolna"]
    )


# --- Presety i wsteczna zgodność --------------------------------------------


def test_default_config_uses_real_threshold_indexation():
    assert default_config().prog_indexation == pytest.approx(0.015)
    assert default_config(2027).prog_indexation == pytest.approx(0.015)


def test_bear_scenario_reproduces_expected_market_assumptions():
    cfg = default_config()
    bear = P._apply_scenario_modifier(cfg, cfg.scenarios.bear)
    assert bear.inflation == pytest.approx(0.035)
    assert bear.prog_indexation == pytest.approx(0.01)
    assert bear.accounts["broker"].default_roi == pytest.approx(0.0)
    assert bear.accounts["krypto"].default_roi == pytest.approx(-0.08)
    assert bear.accounts["obligacje"].default_roi == pytest.approx(0.005)
    assert bear.accounts["lokata"].default_roi == pytest.approx(0.0)
    assert bear.accounts["ppk"].default_roi == pytest.approx(0.005)
    assert bear.wrapper_vehicles["broker"].default_roi == pytest.approx(0.0)
    assert bear.wrapper_vehicles["fund"].default_roi == pytest.approx(0.005)


def test_real_default_sits_between_bear_and_bull():
    real = default_config()
    bear = P._apply_scenario_modifier(real, real.scenarios.bear)
    bull = P._apply_scenario_modifier(real, real.scenarios.bull)
    for account in (
        "broker",
        "ppk",
        "oki_inw",
        "obligacje",
        "lokata",
        "krypto",
        "zus",
        "nieruchomosc",
    ):
        low = bear.accounts[account].default_roi
        mid = real.accounts[account].default_roi
        high = bull.accounts[account].default_roi
        assert low < mid < high, account
    for vehicle in ("broker", "fund", "savings"):
        low = bear.wrapper_vehicles[vehicle].default_roi
        mid = real.wrapper_vehicles[vehicle].default_roi
        high = bull.wrapper_vehicles[vehicle].default_roi
        assert low < mid < high, vehicle
    assert bear.inflation > real.inflation > bull.inflation


def test_builtin_presets_are_two_tax_year_bases():
    assert get_builtin_preset("Konserwatywne") is None
    assert get_builtin_preset("Optymistyczne") is None
    base_2026 = get_builtin_preset("Domyślny 2026")
    base_2027 = get_builtin_preset("Domyślny 2027")
    assert base_2026 is not None and base_2027 is not None
    assert base_2026["year"] == 2026
    assert base_2027["year"] == 2027
    assert base_2027["prog"] == 130_000
    assert base_2027["prog2"] == 150_000
    assert base_2027["rate_middle"] == pytest.approx(0.24)
    assert base_2027["danina_rate"] == pytest.approx(0.05)
    assert base_2027["limits"]["ike_annual"] == pytest.approx(30_099.0)
    assert base_2027["limits"]["ikze_annual"] == pytest.approx(12_039.60)
    assert base_2027["limits"]["ikze_annual_self_employed"] == pytest.approx(18_059.40)
    assert base_2027["limits"]["oipe_annual"] == pytest.approx(30_099.0)
    assert base_2027["limits"]["ppe_additional_annual"] == pytest.approx(45_148.50)
    assert base_2027["zus"]["limit_base_annual"] == pytest.approx(300_990.0)


def test_backfill_adds_prog_indexation_to_legacy_config():
    legacy = {"year": 2026, "inflation": 0.03}
    filled = backfill_tax_config(legacy)
    assert filled["prog_indexation"] == pytest.approx(0.015)


# --- API ----------------------------------------------------------------------


def test_api_config_exposes_prog_indexation(client):
    body = client.get("/api/config").json()
    assert body["prog_indexation"] == pytest.approx(0.015)


def test_api_presets_exposes_two_tax_year_bases(client):
    body = client.get("/api/presets").json()
    assert set(body) == {"Domyślny 2026", "Domyślny 2027"}
    assert body["Domyślny 2027"]["limits"]["ike_annual"] == pytest.approx(30_099.0)
