"""Wspólne metryki prezentacyjne dla wszystkich ekranów wyników.

Ten moduł jest jedynym źródłem prawdy dla liczb pokazywanych w Asystencie,
Symulatorze i Porównywarce. Ekrany nie liczą już własnych wersji
``total_net_benefit``, ``avg_monthly``, ``tax_efficiency`` ani ``roi_multiple``.
"""

from app.core.base import resolve_base
from app.simulation.cashflow import (
    lifestyle_monthly_net,
    obligations_monthly,
    total_net_income_monthly,
)
from app.simulation.config import base_account_key
from app.simulation.schemas import (
    ResultSummary,
    SimulationInput,
    SimulationResult,
)


def total_user_contributions(input_data: SimulationInput) -> float:
    """Suma wpłat własnych w etapach akumulacji.

    Liczymy wpłaty własne (także na gotówkę), ale nie składki ZUS ani
    etapy realizacji — tam konta tylko finansują wypłaty.
    """
    total = 0.0
    for stage in input_data.stages:
        if stage.stage_type != "akumulacja":
            continue
        years = max(0, (stage.end_age or 0) - (stage.start_age or 0))
        if years <= 0:
            continue
        for name, cfg in stage.accounts.items():
            base_name = base_account_key(name)
            if base_name == "zus":
                continue
            if base_name == "ppk":
                base_annual = resolve_base(cfg.model_dump(), input_data.monthly_gross) * 12
                total += cfg.employee_pct * base_annual * years
            else:
                total += cfg.annual_contribution * years
    return round(total, 2)


def initial_capital(input_data: SimulationInput) -> float:
    """Suma sald startowych kont (pierwsze wystąpienie chronologicznie)."""
    seen: set[str] = set()
    total = 0.0
    for stage in sorted(input_data.stages, key=lambda s: s.start_age or 0):
        for name, cfg in stage.accounts.items():
            if name not in seen and cfg.starting_balance > 0:
                total += cfg.starting_balance
                seen.add(name)
    return round(total, 2)


def realization_window(input_data: SimulationInput) -> tuple[int, int]:
    """Wiekowy przedział realizacji planu (prawy koniec ekskluzywny)."""
    stages = [
        stage
        for stage in input_data.stages
        if stage.stage_type == "realizacja" and "zus" not in stage.accounts
    ]
    if stages:
        return min(s.start_age for s in stages), max(s.end_age for s in stages)
    stages = [s for s in input_data.stages if s.stage_type == "realizacja"]
    if stages:
        return stages[0].start_age, stages[0].end_age
    return 0, 0


def build_summary(
    input_data: SimulationInput, result: SimulationResult
) -> ResultSummary:
    """Zbuduj spójny zestaw metryk z wyniku silnika."""
    years = result.years
    payout_years = [year for year in years if year.annual_withdrawal > 0]
    first_age, last_age = realization_window(input_data)
    if not last_age and payout_years:
        first_age = min(year.age for year in payout_years)
        last_age = max(year.age for year in payout_years) + 1
    window_years = [
        year for year in years if first_age <= year.age < last_age
    ] or payout_years
    # X = łączny dochód netto przed zobowiązaniami. Budżet na życie to X minus
    # aktywne zobowiązania; obie serie liczy backend, front tylko je pokazuje.
    income_values = [total_net_income_monthly(input_data, year) for year in window_years]
    lifestyle_values = [lifestyle_monthly_net(input_data, year) for year in window_years]
    obligation_values = [obligations_monthly(input_data, year.age) for year in window_years]
    portfolio_values = [year.monthly_withdrawal for year in window_years]
    avg_income = sum(income_values) / len(income_values) if income_values else None
    min_income = min(income_values) if income_values else None
    max_income = max(income_values) if income_values else None
    avg_monthly = sum(lifestyle_values) / len(lifestyle_values) if lifestyle_values else None
    min_monthly = min(lifestyle_values) if lifestyle_values else None
    max_monthly = max(lifestyle_values) if lifestyle_values else None
    avg_obligations = (
        sum(obligation_values) / len(obligation_values) if obligation_values else None
    )
    avg_monthly_portfolio = (
        sum(portfolio_values) / len(portfolio_values) if portfolio_values else None
    )
    min_monthly_portfolio = min(portfolio_values) if portfolio_values else None
    zus_total = sum((year.zus_monthly or 0.0) * 12 for year in years)
    private_total = max(0.0, result.total_withdrawn - zus_total)
    zus_monthly = next(
        (year.zus_monthly for year in reversed(years) if year.zus_monthly > 0),
        None,
    )
    total_net_benefit = result.total_withdrawn + result.final_wealth_net

    tax_denominator = result.total_withdrawn + result.total_tax + result.total_health
    tax_efficiency = (
        min(100.0, result.total_withdrawn / tax_denominator * 100)
        if tax_denominator > 0
        else None
    )

    initial = initial_capital(input_data)
    contributions = total_user_contributions(input_data)
    invested = initial + contributions
    roi_multiple = total_net_benefit / invested if invested > 0 else None

    return ResultSummary(
        final_wealth=result.final_wealth,
        final_wealth_net=result.final_wealth_net,
        exit_tax=result.exit_tax,
        peak_wealth=result.peak_wealth,
        total_withdrawn=result.total_withdrawn,
        total_tax=result.total_tax,
        total_health=result.total_health,
        total_tax_refund=result.total_tax_refund,
        total_net_benefit=round(total_net_benefit, 2),
        total_withdrawn_private=round(private_total, 2),
        total_withdrawn_zus=round(zus_total, 2),
        avg_monthly=round(avg_monthly, 2) if avg_monthly is not None else None,
        min_monthly=round(min_monthly, 2) if min_monthly is not None else None,
        max_monthly=round(max_monthly, 2) if max_monthly is not None else None,
        avg_income=round(avg_income, 2) if avg_income is not None else None,
        min_income=round(min_income, 2) if min_income is not None else None,
        max_income=round(max_income, 2) if max_income is not None else None,
        avg_obligations=(
            round(avg_obligations, 2) if avg_obligations is not None else None
        ),
        avg_monthly_portfolio=(
            round(avg_monthly_portfolio, 2) if avg_monthly_portfolio is not None else None
        ),
        min_monthly_portfolio=(
            round(min_monthly_portfolio, 2) if min_monthly_portfolio is not None else None
        ),
        zus_monthly=round(zus_monthly, 2) if zus_monthly is not None else None,
        payout_years=len(payout_years),
        tax_efficiency=round(tax_efficiency, 2) if tax_efficiency is not None else None,
        roi_multiple=round(roi_multiple, 4) if roi_multiple is not None else None,
        initial_capital=initial,
        total_user_contributions=contributions,
        years=len(years),
        start_age=years[0].age if years else None,
        end_age=years[-1].age if years else None,
        has_pension=result.has_pension,
        warnings_count=len(result.warnings),
        accounts=list(result.accounts),
        account_labels=dict(result.account_labels),
    )
