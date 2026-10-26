"""Gross↔net salary conversion for an employment contract (etat).

The wizard lets the user declare either gross or net pay. Net is the real
take-home amount and the base for "% of salary" displays. B2B is deliberately
not handled here — its net depends on the chosen taxation form.
"""

from app.core.tax import danina_solidarnosciowa, scale_tax
from app.simulation.config import TaxConfig

MONTHS_PER_YEAR = 12


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
) -> tuple[float, float | None]:
    """Return ``(gross_monthly, net_monthly)`` for the wizard preview.

    Only an etat has a well-defined net here; B2B and unemployed return the
    declared amount as gross and ``None`` as net.
    """
    value = max(0.0, amount)
    if employment != "etat":
        return value, None
    if salary_mode == "net":
        gross = gross_from_net(value, config, ppk_pct=ppk_pct)
        return gross, net_from_gross(gross, config, ppk_pct=ppk_pct)
    return value, net_from_gross(value, config, ppk_pct=ppk_pct)
