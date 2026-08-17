"""Podatki dochodowe — skala PIT i podatki ryczałtowe (Polska 2026)."""


def scale_tax(
    income: float,
    *,
    kwota_wolna: float = 30_000,
    prog: float = 120_000,
    rate_lower: float = 0.12,
    rate_upper: float = 0.32,
) -> float:
    """Podatek PIT wg skali (art. 27 ustawy o PIT).

    Skala 2026: kwota wolna 30 000 zł, 12% do 120 000 zł, 32% ponad.
    Kwota zmniejszająca podatek jest pochodną kwoty wolnej (kwota_wolna * rate_lower).

    Args:
        income: roczny dochód opodatkowany skalą.
        kwota_wolna: roczna kwota wolna od podatku (0 zł podatku do tej kwoty).
        prog: próg podatkowy, od którego obowiązuje stawka wyższa.
        rate_lower: stawka w I progu.
        rate_upper: stawka w II progu.

    Returns:
        Należny podatek (>= 0).
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
