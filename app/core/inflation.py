def fisher_real(nominal: float, inflation: float) -> float:
    if inflation <= -1:
        raise ValueError("Inflacja musi być > -100%")
    return (1 + nominal) / (1 + inflation) - 1


def fisher_nominal(real: float, inflation: float) -> float:
    if inflation <= -1:
        raise ValueError("Inflacja musi być > -100%")
    return (1 + real) * (1 + inflation) - 1


def cumulative_factor(inflation: float, years: int) -> float:
    if years <= 0:
        return 1.0
    return (1 + inflation) ** years


def deflate(nominal: float, inflation: float, years: int) -> float:
    return nominal / cumulative_factor(inflation, years)


def inflate(real: float, inflation: float, years: int) -> float:
    return real * cumulative_factor(inflation, years)


def nominal_brutto_from_real_net(real_net: float, inflation: float, tax_rate: float) -> float:
    if tax_rate >= 1:
        raise ValueError("tax_rate musi być < 100%")
    if tax_rate < 0:
        raise ValueError("tax_rate musi być >= 0")
    nominal_net = fisher_nominal(real_net, inflation)
    if tax_rate == 0:
        return nominal_net
    return nominal_net / (1 - tax_rate)


def real_net_from_nominal_brutto(nominal_brutto: float, inflation: float, tax_rate: float) -> float:
    nominal_net = nominal_brutto * (1 - tax_rate)
    return fisher_real(nominal_net, inflation)
