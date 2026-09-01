DEFAULT_ROI = 0.02


def effective_roi(account: str, roi: float) -> float:
    if account == "gotowka" and roi > 0:
        return -roi
    return roi


def periodic_net_roi(account: str, tax_rate: float, roi: float, term_months: int = 12) -> float:
    roi = effective_roi(account, roi)
    if roi <= 0:
        return roi
    intervals = 12 / max(1, int(term_months))
    rate = roi / intervals
    if rate > 1:
        return roi
    net_mult = (1 + rate * (1 - tax_rate)) ** intervals
    return net_mult - 1
