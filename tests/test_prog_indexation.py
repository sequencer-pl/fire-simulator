import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.core.tax import scale_tax
from app.simulation.config import (
    TaxConfig,
    backfill_tax_config,
    default_config,
    get_builtin_preset,
)
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

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


def test_default_config_keeps_thresholds_real():
    assert default_config().prog_indexation is None
    assert default_config(2027).prog_indexation is None


def test_conservative_preset_indexes_thresholds_below_inflation():
    preset = get_builtin_preset("Konserwatywne")
    assert preset is not None
    assert preset["prog_indexation"] == 0.01
    assert preset["inflation"] == 0.035
    realne = get_builtin_preset("Realne")
    assert realne is not None
    assert realne["prog_indexation"] == 0.015
    assert realne["inflation"] == 0.025
    for name in ("Domyślne 2026", "2027 (projekt UD458)", "Optymistyczne"):
        p = get_builtin_preset(name)
        assert p is not None and p["prog_indexation"] is None


def test_backfill_adds_prog_indexation_to_legacy_config():
    legacy = {"year": 2026, "inflation": 0.03}
    filled = backfill_tax_config(legacy)
    assert "prog_indexation" in filled and filled["prog_indexation"] is None
    assert TaxConfig(**filled).threshold_factor(10) == 1.0


# --- Silnik: emerytura ZUS na skali ------------------------------------------


def _zus_pension_run(prog_indexation):
    cfg = TaxConfig(inflation=INFL, prog_indexation=prog_indexation)
    stages = [realization_stage("ZUS", {"zus": acc(monthly_pension=5000)}, 65, 96)]
    return simulate(SimulationInput(stages=stages, max_age=95, config=cfg))


def test_zus_pension_net_identical_in_first_year():
    frozen = _zus_pension_run(0.0)
    real = _zus_pension_run(None)
    assert frozen.years[0].zus_monthly == pytest.approx(real.years[0].zus_monthly)
    assert frozen.years[0].tax_paid == pytest.approx(real.years[0].tax_paid)


def test_zus_pension_net_falls_over_time_with_frozen_thresholds():
    frozen = _zus_pension_run(0.0)
    real = _zus_pension_run(None)
    # progi stałe realnie -> stała emerytura netto; zamrożone -> malejąca
    assert real.years[20].zus_monthly == pytest.approx(real.years[0].zus_monthly)
    assert frozen.years[20].zus_monthly < frozen.years[0].zus_monthly
    assert frozen.years[20].tax_paid > real.years[20].tax_paid
    # 60 000 zł/rok, po 20 latach kwota wolna realnie 30 000 / 1.025^20
    expected_tax = scale_tax(60_000, kwota_wolna=30_000 / 1.025**20)
    assert frozen.years[20].tax_paid == pytest.approx(expected_tax, abs=0.01)


def test_none_indexation_matches_previous_behaviour():
    legacy_cfg = TaxConfig(inflation=INFL)
    explicit = TaxConfig(inflation=INFL, prog_indexation=INFL)
    stages = [realization_stage("ZUS", {"zus": acc(monthly_pension=5000)}, 65, 96)]
    a = simulate(SimulationInput(stages=stages, max_age=95, config=legacy_cfg))
    b = simulate(SimulationInput(stages=stages, max_age=95, config=explicit))
    for ya, yb in zip(a.years, b.years, strict=True):
        assert ya.tax_paid == pytest.approx(yb.tax_paid)


# --- Silnik: oszczędność podatkowa IKZE --------------------------------------


def _ikze_run(prog_indexation):
    cfg = TaxConfig(inflation=INFL, prog_indexation=prog_indexation)
    stages = [
        accumulation_stage(
            {
                "ikze": acc(annual_contribution=10_000, monthly_base=9_000),
                "broker": acc(starting_balance=0, roi=0.0),
            },
            start=40,
            end=65,
        )
    ]
    return simulate(SimulationInput(stages=stages, max_age=64, config=cfg))


def test_ikze_saving_grows_when_thresholds_freeze():
    frozen = _ikze_run(0.0)
    real = _ikze_run(None)
    # rok 0: identycznie; później dochód 108k wpada realnie coraz głębiej w II próg,
    # więc odliczenie IKZE jest warte więcej (ujemny podatek = oszczędność)
    assert frozen.years[0].tax_paid == pytest.approx(real.years[0].tax_paid)
    assert real.years[15].tax_paid == pytest.approx(real.years[0].tax_paid)
    assert frozen.years[15].tax_paid < real.years[15].tax_paid


# --- API ----------------------------------------------------------------------


def test_api_config_exposes_prog_indexation(client):
    body = client.get("/api/config").json()
    assert "prog_indexation" in body and body["prog_indexation"] is None


def test_api_user_config_accepts_explicit_zero(client):
    assert (
        client.post(
            "/api/register", json={"email": "idx@example.com", "password": "haslo12345"}
        ).status_code
        == 200
    )
    config = {**client.get("/api/config").json(), "prog_indexation": 0.0}
    assert client.put("/api/config/user", json=config).status_code == 200
    assert client.get("/api/config/user").json()["config"]["prog_indexation"] == 0.0
