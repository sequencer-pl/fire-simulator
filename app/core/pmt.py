import math


def pmt(rate: float, nper: int, pv: float, fv: float = 0.0, when: int = 0) -> float:
    """
    Oblicza ratę annuitetu (wypłatę roczną) - wierna kopia Excel PMT.

    PMT(rate, nper, pv, [fv], [type])

    Args:
        rate: stopa procentowa za okres (np. 0.02 = 2%)
        nper: liczba okresów
        pv: wartość bieżąca (saldo, z minusem jak w Excelu)
        fv: wartość przyszła (bufor, domyślnie 0)
        when: 0 = na koniec okresu, 1 = na początek

    Returns:
        Wysokość raty (wypłaty rocznej)
    """
    if nper <= 0:
        return 0.0

    if rate == 0:
        return -(pv + fv) / nper

    if when:
        pay_rate = 1 + rate
    else:
        pay_rate = 1.0

    temp = pow(1 + rate, nper)
    result = (-pv * temp * rate - fv * rate) / (pay_rate * (temp - 1))
    return result
