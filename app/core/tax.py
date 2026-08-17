"""Income taxes — PIT scale and flat-rate taxes (Poland 2026)."""


def scale_tax(
    income: float,
    *,
    kwota_wolna: float = 30_000,
    prog: float = 120_000,
    rate_lower: float = 0.12,
    rate_upper: float = 0.32,
) -> float:
    """PIT tax on scale (Art. 27 of the PIT Act).

    2026 scale: tax-free allowance 30,000 PLN, 12% up to 120,000 PLN, 32% above.
    The tax-reducing amount is derived from the tax-free allowance (kwota_wolna * rate_lower).

    Args:
        income: annual income taxed on scale.
        kwota_wolna: annual tax-free allowance (0 tax up to this amount).
        prog: tax threshold above which the higher rate applies.
        rate_lower: rate in bracket I.
        rate_upper: rate in bracket II.

    Returns:
        Tax due (>= 0).
    """
    if income <= 0:
        return 0.0
    kwota_zmniejszajaca = kwota_wolna * rate_lower
    if income <= kwota_wolna:
        return 0.0
    if income <= prog:
        return max(0.0, income * rate_lower - kwota_zmniejszajaca)
    base = prog * rate_lower - kwota_zmniejszajaca
    return base + (income - prog) * rate_upper
