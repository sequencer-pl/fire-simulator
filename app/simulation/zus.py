"""Klaster ZUS — wyodrębniony z engine.py (waloryzacja, konwersja kapitału, wiek).

Funkcje pozostają wewnętrznymi helperami silnika (importują je moduły engine /
planner); trzymamy je tu, by trzymać engine.py w czytelnych granicach.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.base import resolve_base
from app.simulation.config import TaxConfig
from app.simulation.constants import DEFAULT_ROI, MONTHS_PER_YEAR
from app.simulation.schemas import StageInput
from app.simulation.tablica_sdtz import sdtz_months

if TYPE_CHECKING:
    from app.simulation.engine import SimulationState


def _estimate_zus_pension(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float] | None = None,
    zus_pensions: dict[str, float] | None = None,
    config: TaxConfig | None = None,
    state: SimulationState | None = None,
) -> float:
    """Estimate the annual ZUS pension for this year without modifying state."""
    if state is not None:
        balances = state.balances
        zus_pensions = state.zus_pensions
        config = state.config
    assert balances is not None and zus_pensions is not None and config is not None
    for si in active_stages:
        if si.stage_type != "realizacja" or "zus" not in si.accounts:
            continue
        cfg = si.accounts["zus"]
        # Manual pension override — use it directly.
        if cfg.monthly_pension > 0:
            return cfg.monthly_pension * MONTHS_PER_YEAR
        zus_cfg = config.zus
        if age == si.start_age and "zus" not in zus_pensions:
            # Capital-to-pension conversion: capital / SDTZ(age) * 12.
            capital = balances.get("zus", 0.0) + balances.get("zus:ofe", 0.0)
            months = sdtz_months(age)
            return (capital / months * MONTHS_PER_YEAR) if months > 0 else 0.0
        if "zus" in zus_pensions:
            waloryzacja = (
                cfg.waloryzacja_swiadczenia
                if cfg.waloryzacja_swiadczenia is not None
                else zus_cfg.waloryzacja_swiadczenia
            )
            return zus_pensions["zus"] * (1 + waloryzacja) * MONTHS_PER_YEAR
    return 0.0


def _accumulate_zus(
    cfg: dict,
    balances: dict,
    config: TaxConfig,
    monthly_gross: float = 0.0,
) -> None:
    """Annual contribution and pension capital indexation (accumulation)."""
    zus_cfg = config.zus
    base_annual = resolve_base(cfg, monthly_gross) * MONTHS_PER_YEAR
    cap = zus_cfg.limit_base_annual
    capped = min(base_annual, cap) if cap and cap > 0 else base_annual
    total_contrib = capped * zus_cfg.skladka_rate

    if cfg.get("ofe_member"):
        if "zus:ofe" not in balances and cfg.get("starting_balance_ofe", 0.0) > 0:
            balances["zus:ofe"] = cfg["starting_balance_ofe"]
        ofe_contrib = capped * zus_cfg.ofe_rate
        zus_contrib = total_contrib - ofe_contrib
        waloryzacja = (
            cfg.get("waloryzacja_skladek")
            if cfg.get("waloryzacja_skladek") is not None
            else zus_cfg.waloryzacja_skladek
        )
        balances["zus"] = balances.get("zus", 0.0) * (1 + waloryzacja) + zus_contrib
        balances["zus:ofe"] = (
            balances.get("zus:ofe", 0.0) * (1 + cfg.get("roi", DEFAULT_ROI)) + ofe_contrib
        )
    else:
        waloryzacja = (
            cfg.get("waloryzacja_skladek")
            if cfg.get("waloryzacja_skladek") is not None
            else zus_cfg.waloryzacja_skladek
        )
        balances["zus"] = balances.get("zus", 0.0) * (1 + waloryzacja) + total_contrib


def _convert_zus(
    zus_pensions: dict[str, float],
    age: int,
    start_age: int,
    accounts_config: dict,
    balances: dict,
    config: TaxConfig,
) -> None:
    """Convert capital to pension at the start of the realization stage.

    Pension = capital / SDTZ(age). Injecting it into the stage config as
    monthly_pension causes RealizacjaStage to treat it as a regular
    benefit. After conversion the capital is zeroed out, and the benefit
    is annually adjusted by waloryzacja_swiadczenia.
    """
    cfg = accounts_config["zus"]
    if cfg.get("monthly_pension", 0.0) > 0:
        return
    zus_cfg = config.zus
    if age == start_age and "zus" not in zus_pensions:
        capital = balances.pop("zus", 0.0) + balances.pop("zus:ofe", 0.0)
        months = sdtz_months(age)
        zus_pensions["zus"] = capital / months if months > 0 else 0.0
    elif "zus" in zus_pensions:
        waloryzacja = (
            cfg.get("waloryzacja_swiadczenia")
            if cfg.get("waloryzacja_swiadczenia") is not None
            else zus_cfg.waloryzacja_swiadczenia
        )
        zus_pensions["zus"] = zus_pensions["zus"] * (1 + waloryzacja)
    cfg["monthly_pension"] = zus_pensions.get("zus", 0.0)


def _pension_age(config: TaxConfig, gender: str) -> int:
    """Statutory retirement age by gender (women 60, men 65, since 1.10.2017)."""
    return config.zus.wiek_emerytalny_k if gender == "k" else config.zus.wiek_emerytalny_m
