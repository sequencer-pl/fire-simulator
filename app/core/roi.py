from app.core.inflation import fisher_nominal, fisher_real

DEFAULT_ROI = 0.02


def effective_roi(account: str, roi: float) -> float:
    if account == "gotowka" and roi > 0:
        return -roi
    return roi


def periodic_net_roi(
    account: str,
    tax_rate: float,
    roi_gross: float,
    term_months: int = 12,
    inflation: float = 0.0,
) -> float:
    """Real net return after periodic Belka, from a real gross ROI.

    ``roi_gross`` is the real return before tax. The nominal gross rate is
    derived with Fisher, Belka is deducted on interest at every term, and the
    result is deflated back to real zł. For terms longer than 12 months the
    annualized net return reflects tax deferral until maturity.
    """
    roi_gross = effective_roi(account, roi_gross)
    if roi_gross <= 0:
        return roi_gross

    term_months = max(1, int(term_months))
    nominal_gross_annual = fisher_nominal(roi_gross, inflation)
    if nominal_gross_annual <= -1:
        return roi_gross

    if term_months <= 12:
        intervals = 12 / term_months
        gross_per_interval = (1 + nominal_gross_annual) ** (1 / intervals) - 1
        net_per_interval = gross_per_interval * (1 - tax_rate)
        net_nominal_annual = (1 + net_per_interval) ** intervals - 1
        return fisher_real(net_nominal_annual, inflation)

    term_years = max(2, term_months // 12)
    gross_factor = (1 + nominal_gross_annual) ** term_years
    interest = gross_factor - 1
    net_nominal_factor = gross_factor - interest * tax_rate
    net_real_factor = net_nominal_factor / (1 + inflation) ** term_years
    return net_real_factor ** (1 / term_years) - 1
