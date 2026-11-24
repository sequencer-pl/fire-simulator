"""Gross↔net salary conversion for etat and B2B (JDG).

The wizard lets the user declare either gross or net pay. Net is the real
take-home amount and the base for "% of salary" displays. For B2B the
conversion depends on the tax form (ryczałt / liniowy / skala) and the ZUS
base, so the caller passes those explicitly.
"""

from app.core.tax import danina_solidarnosciowa, scale_tax
from app.simulation.config import TaxConfig

MONTHS_PER_YEAR = 12


def etat_annual_social(gross_monthly: float, config: TaxConfig) -> tuple[float, float]:
    """Roczne składki społeczne pracownika: (emerytalna+rentowa, chorobowa).

    Emerytalna i rentowa są objęte rocznym limitem 30-krotności; chorobowa
    (2,45%) nie. Zwracamy kwoty roczne, bo limit jest roczny.
    """
    annual = max(0.0, gross_monthly) * MONTHS_PER_YEAR
    zus = config.zus
    capped = min(annual, zus.limit_base_annual) if zus.limit_base_annual > 0 else annual
    pension_rent = capped * (zus.employee_pension_rate + zus.employee_rent_rate)
    sickness = annual * zus.employee_sickness_rate
    return pension_rent, sickness


def etat_taxable_income(gross_monthly: float, config: TaxConfig) -> float:
    """Roczny dochód etatu do PIT (po składkach społecznych i KUP)."""
    pension_rent, sickness = etat_annual_social(gross_monthly, config)
    annual = max(0.0, gross_monthly) * MONTHS_PER_YEAR
    return max(0.0, annual - pension_rent - sickness - config.kup)


def b2b_social_monthly(
    zus_mode: str,
    config: TaxConfig,
    custom_base: float = 5_652.0,
) -> tuple[float, float]:
    """Zwraca (miesięczna podstawa wymiaru, miesięczna składka społeczna ZUS).

    Emerytalna+rentowa są ograniczone rocznym limitem 30-krotności; wypadkowa
    i Fundusz Pracy liczone są od pełnej podstawy.
    """
    b2b = config.b2b
    if zus_mode == "ulga":
        return 0.0, 0.0
    if zus_mode == "maly":
        base = b2b.preferential_base_monthly
        full = False
    elif zus_mode == "custom":
        base = max(0.0, custom_base)
        # Poniżej progu nie ma obowiązku opłacać Funduszu Pracy — wtedy
        # obowiązują stawki preferencyjne (bez 2,45% FP).
        full = base >= b2b.full_zus_min_base
    else:
        base = config.zus.b2b_base_monthly
        full = True
    annual_base = base * MONTHS_PER_YEAR
    cap = config.zus.limit_base_annual
    capped = min(annual_base, cap) if cap and cap > 0 else annual_base
    social_annual = capped * b2b.pension_rent_rate + annual_base * b2b.accident_rate
    if full:
        social_annual += annual_base * b2b.fp_rate
    return base, social_annual / MONTHS_PER_YEAR


def b2b_zus_base_and_social(
    zus_mode: str,
    config: TaxConfig,
    custom_base: float = 5_652.0,
) -> tuple[float, float]:
    """Kompatybilny wrapper: (podstawa miesięczna, składka społeczna miesięczna)."""
    return b2b_social_monthly(zus_mode, config, custom_base)


def b2b_net_from_gross(
    revenue_monthly: float,
    config: TaxConfig,
    *,
    tax_form: str = "ryczalt",
    lump_rate: float = 0.12,
    zus_mode: str = "duzy",
    custom_zus_base: float = 5_652.0,
) -> float:
    """Miesięczna kwota „na czysto” dla B2B z przychodu netto na fakturze
    (po kosztach działalności)."""
    rev = max(0.0, revenue_monthly)
    if rev <= 0:
        return 0.0
    _base, social_m = b2b_zus_base_and_social(zus_mode, config, custom_zus_base)
    annual_rev = rev * MONTHS_PER_YEAR
    annual_social = social_m * MONTHS_PER_YEAR

    if tax_form == "ryczalt":
        # 3 progi składki zdrowotnej na ryczałcie (do 60k, 60k-300k, >300k rocznie)
        low, high = config.b2b.lump_health_thresholds
        if annual_rev <= low:
            health_m = config.b2b.lump_health_amounts[0]
        elif annual_rev <= high:
            health_m = config.b2b.lump_health_amounts[1]
        else:
            health_m = config.b2b.lump_health_amounts[2]
        annual_health = health_m * MONTHS_PER_YEAR
        taxable = max(0.0, annual_rev - annual_social - 0.5 * annual_health)
        tax_annual = taxable * max(0.0, lump_rate)
        return max(0.0, rev - social_m - health_m - tax_annual / MONTHS_PER_YEAR)

    income_m = max(0.0, rev - social_m)
    annual_income = income_m * MONTHS_PER_YEAR

    if tax_form == "liniowy":
        health_m = max(config.b2b.min_health_monthly, income_m * config.b2b.linear_health_rate)
        annual_health = health_m * MONTHS_PER_YEAR
        deductible_health = min(annual_health, config.b2b.linear_health_deduction_annual)
        taxable = max(0.0, annual_income - deductible_health)
        pit = taxable * 0.19 + danina_solidarnosciowa(
            taxable, danina_prog=config.danina_prog, danina_rate=config.danina_rate
        )
        return max(0.0, rev - social_m - health_m - pit / MONTHS_PER_YEAR)

    # Skala podatkowa (12% / 32%)
    health_m = max(config.b2b.min_health_monthly, income_m * config.health_rate)
    pit = scale_tax(annual_income, **config.scale_kwargs()) + danina_solidarnosciowa(
        annual_income, danina_prog=config.danina_prog, danina_rate=config.danina_rate
    )
    return max(0.0, rev - social_m - health_m - pit / MONTHS_PER_YEAR)


def b2b_gross_from_net(
    net_monthly: float,
    config: TaxConfig,
    *,
    tax_form: str = "ryczalt",
    lump_rate: float = 0.12,
    zus_mode: str = "duzy",
    custom_zus_base: float = 5_652.0,
) -> float:
    """Przychód miesięczny na B2B (po kosztach), z którego zostaje ``net_monthly`` na rękę."""
    net = max(0.0, net_monthly)
    if net <= 0:
        return 0.0
    lo = 0.0
    hi = max(net * 2.5, net + 5_000.0)
    while (
        b2b_net_from_gross(
            hi,
            config,
            tax_form=tax_form,
            lump_rate=lump_rate,
            zus_mode=zus_mode,
            custom_zus_base=custom_zus_base,
        )
        < net
        and hi < 1e9
    ):
        hi *= 2.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if (
            b2b_net_from_gross(
                mid,
                config,
                tax_form=tax_form,
                lump_rate=lump_rate,
                zus_mode=zus_mode,
                custom_zus_base=custom_zus_base,
            )
            < net
        ):
            lo = mid
        else:
            hi = mid
    return hi


def net_from_gross(gross_monthly: float, config: TaxConfig, *, ppk_pct: float = 0.0) -> float:
    """Monthly net pay from gross (etat): ZUS, health, PIT and employee PPK."""
    gross = max(0.0, gross_monthly)
    if gross <= 0:
        return 0.0
    annual = gross * MONTHS_PER_YEAR
    pension_rent, sickness = etat_annual_social(gross, config)
    zus_annual = pension_rent + sickness
    # Podstawa zdrowotnej to bieżące wynagrodzenie pomniejszone o składki
    # społeczne; przy przekroczeniu limitu 30× emerytalna+rentowa już nie
    # schodzą, więc zdrowotna liczy się od większej podstawy.
    zus_monthly = zus_annual / MONTHS_PER_YEAR
    health = max(0.0, gross - zus_monthly) * config.health_rate
    annual_income = max(0.0, annual - zus_annual - config.kup)
    pit = scale_tax(annual_income, **config.scale_kwargs())
    pit += danina_solidarnosciowa(
        annual_income,
        danina_prog=config.danina_prog,
        danina_rate=config.danina_rate,
    )
    ppk = gross * max(0.0, ppk_pct)
    return max(0.0, gross - zus_monthly - health - pit / MONTHS_PER_YEAR - ppk)


def gross_from_net(net_monthly: float, config: TaxConfig, *, ppk_pct: float = 0.0) -> float:
    """Monthly gross whose net pay equals ``net_monthly`` (monotone bisection)."""
    net = max(0.0, net_monthly)
    if net <= 0:
        return 0.0
    lo = 0.0
    hi = max(net * 3.0, net + 5_000.0)
    while net_from_gross(hi, config, ppk_pct=ppk_pct) < net and hi < 1e9:
        hi *= 2.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if net_from_gross(mid, config, ppk_pct=ppk_pct) < net:
            lo = mid
        else:
            hi = mid
    return hi


def salary_preview(
    amount: float,
    salary_mode: str,
    employment: str,
    config: TaxConfig,
    *,
    ppk_pct: float = 0.0,
    b2b_tax_form: str | None = None,
    b2b_lump_rate: float = 0.12,
    b2b_zus_mode: str = "duzy",
    b2b_custom_zus_base: float = 5_652.0,
) -> tuple[float, float | None]:
    """Return ``(gross_monthly, net_monthly)`` for the wizard preview.

    For ``etat`` converts gross↔net using employee ZUS, health, PIT and PPK.
    For ``b2b`` when ``b2b_tax_form`` is provided (Asystent), converts between
    monthly invoice revenue (after business costs) and take-home net. Legacy
    calls without ``b2b_tax_form`` return ``(value, None)``.
    """
    value = max(0.0, amount)
    if employment == "b2b" and b2b_tax_form in ("ryczalt", "liniowy", "skala"):
        if salary_mode == "net":
            gross = b2b_gross_from_net(
                value,
                config,
                tax_form=b2b_tax_form,
                lump_rate=b2b_lump_rate,
                zus_mode=b2b_zus_mode,
                custom_zus_base=b2b_custom_zus_base,
            )
            net = b2b_net_from_gross(
                gross,
                config,
                tax_form=b2b_tax_form,
                lump_rate=b2b_lump_rate,
                zus_mode=b2b_zus_mode,
                custom_zus_base=b2b_custom_zus_base,
            )
            return gross, net
        return value, b2b_net_from_gross(
            value,
            config,
            tax_form=b2b_tax_form,
            lump_rate=b2b_lump_rate,
            zus_mode=b2b_zus_mode,
            custom_zus_base=b2b_custom_zus_base,
        )
    if employment != "etat":
        return value, None
    if salary_mode == "net":
        gross = gross_from_net(value, config, ppk_pct=ppk_pct)
        return gross, net_from_gross(gross, config, ppk_pct=ppk_pct)
    return value, net_from_gross(value, config, ppk_pct=ppk_pct)
