"""Income taxes — PIT scale and flat-rate taxes (Poland 2026/2027 draft UD458)."""

from functools import lru_cache


@lru_cache(maxsize=4096)
def _scale_tax_cached(
    income: float,
    kwota_wolna: float,
    prog: float,
    rate_lower: float,
    rate_upper: float,
    prog2: float | None = None,
    rate_middle: float | None = None,
) -> float:
    if income <= 0:
        return 0.0
    kwota_zmniejszajaca = kwota_wolna * rate_lower
    if income <= kwota_wolna:
        return 0.0
    if income <= prog:
        return max(0.0, income * rate_lower - kwota_zmniejszajaca)
    # Trzy progi (projekt UD458 na 2027 r.): prog=130k/24% do prog2=150k, potem 32%.
    if prog2 is not None and rate_middle is not None and prog2 > prog:
        if income <= prog2:
            base = prog * rate_lower - kwota_zmniejszajaca
            return base + (income - prog) * rate_middle
        base = prog * rate_lower - kwota_zmniejszajaca
        base += (prog2 - prog) * rate_middle
        return base + (income - prog2) * rate_upper
    base = prog * rate_lower - kwota_zmniejszajaca
    return base + (income - prog) * rate_upper


def danina_solidarnosciowa(
    income: float,
    *,
    danina_prog: float = 1_000_000,
    danina_rate: float = 0.04,
) -> float:
    """Danina solidarnościowa od nadwyżki ponad próg (4% do 2026, projekt 5% od 2027)."""
    if income <= danina_prog:
        return 0.0
    return (income - danina_prog) * danina_rate


def scale_tax(
    income: float,
    *,
    kwota_wolna: float = 30_000,
    prog: float = 120_000,
    rate_lower: float = 0.12,
    rate_upper: float = 0.32,
    prog2: float | None = None,
    rate_middle: float | None = None,
) -> float:
    """PIT tax on scale (Art. 27 of the PIT Act).

    2026 scale: tax-free allowance 30,000 PLN, 12% up to 120,000 PLN, 32% above.
    2027 draft (UD458): 12% up to 130,000 PLN, 24% up to 150,000 PLN, 32% above.
    The tax-reducing amount is derived from the tax-free allowance (kwota_wolna * rate_lower).

    Args:
        income: annual income taxed on scale.
        kwota_wolna: annual tax-free allowance (0 tax up to this amount).
        prog: first tax threshold above which the middle/higher rate applies.
        rate_lower: rate in bracket I.
        rate_upper: rate in the top bracket.
        prog2: second threshold for the 3-bracket scale (None = legacy 2 brackets).
        rate_middle: rate between prog and prog2 (None = legacy 2 brackets).

    Returns:
        Tax due (>= 0).
    """
    return _scale_tax_cached(
        round(income, 2), kwota_wolna, prog, rate_lower, rate_upper, prog2, rate_middle
    )
