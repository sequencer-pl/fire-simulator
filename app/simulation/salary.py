"""Gross↔net salary conversion for etat and B2B (JDG).

The wizard lets the user declare either gross or net pay. Net is the real
take-home amount and the base for "% of salary" displays. For B2B the
conversion depends on the tax form (ryczałt / liniowy / skala) and the ZUS
base, so the caller passes those explicitly.
"""

from app.core.tax import danina_solidarnosciowa, scale_tax
from app.simulation.config import TaxConfig

MONTHS_PER_YEAR = 12

# Parametry B2B (2026):
# - Duży ZUS: podstawa 60% prognozowanego przeciętnego wynagrodzenia
#   (config.zus.b2b_base_monthly = 5 652 zł).
# - Mały ZUS (preferencyjny przez 24 mies.): podstawa 30% płacy minimalnej
#   (ok. 1 442 zł).
# - Stopa składek społecznych: emerytalna 19,52% + rentowa 8% + wypadkowa
#   1,67% (+ FP 2,45% na dużym ZUS).
B2B_PREFERENTIAL_BASE = 1_442.0
B2B_SOCIAL_RATE_FULL = 0.3164
B2B_SOCIAL_RATE_PREF = 0.2919
B2B_MIN_HEALTH_MONTHLY = 432.54
B2B_LINEAR_HEALTH_DEDUCTION_ANNUAL = 14_100.0


def b2b_zus_base_and_social(
    zus_mode: str,
    config: TaxConfig,
    custom_base: float = 5_652.0,
) -> tuple[float, float]:
    """Zwraca (miesięczna podstawa wymiaru składek ZUS, miesięczna składka społeczna ZUS)."""
    if zus_mode == "ulga":
        return 0.0, 0.0
    if zus_mode == "maly":
        base = B2B_PREFERENTIAL_BASE
        return base, base * B2B_SOCIAL_RATE_PREF
    if zus_mode == "custom":
        base = max(0.0, custom_base)
        rate = B2B_SOCIAL_RATE_FULL if base >= 3_000.0 else B2B_SOCIAL_RATE_PREF
        return base, base * rate
    base = config.zus.b2b_base_monthly
    return base, base * B2B_SOCIAL_RATE_FULL


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
        if annual_rev <= 60_000:
            health_m = 498.35
        elif annual_rev <= 300_000:
            health_m = 830.58
        else:
            health_m = 1_495.04
        annual_health = health_m * MONTHS_PER_YEAR
        taxable = max(0.0, annual_rev - annual_social - 0.5 * annual_health)
        tax_annual = taxable * max(0.0, lump_rate)
        return max(0.0, rev - social_m - health_m - tax_annual / MONTHS_PER_YEAR)

    income_m = max(0.0, rev - social_m)
    annual_income = income_m * MONTHS_PER_YEAR

    if tax_form == "liniowy":
        health_m = max(B2B_MIN_HEALTH_MONTHLY, income_m * 0.049)
        annual_health = health_m * MONTHS_PER_YEAR
        deductible_health = min(annual_health, B2B_LINEAR_HEALTH_DEDUCTION_ANNUAL)
        taxable = max(0.0, annual_income - deductible_health)
        pit = taxable * 0.19 + danina_solidarnosciowa(
            taxable, danina_prog=config.danina_prog, danina_rate=config.danina_rate
        )
        return max(0.0, rev - social_m - health_m - pit / MONTHS_PER_YEAR)

    # Skala podatkowa (12% / 32%)
    health_m = max(B2B_MIN_HEALTH_MONTHLY, income_m * config.health_rate)
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
    zus = gross * config.zus.employee_rate
    health = max(0.0, gross - zus) * config.health_rate
    annual_income = max(0.0, (gross - zus) * MONTHS_PER_YEAR - config.kup)
    pit = scale_tax(annual_income, **config.scale_kwargs())
    pit += danina_solidarnosciowa(
        annual_income,
        danina_prog=config.danina_prog,
        danina_rate=config.danina_rate,
    )
    ppk = gross * max(0.0, ppk_pct)
    return max(0.0, gross - zus - health - pit / MONTHS_PER_YEAR - ppk)


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
