"""Wspólne metryki prezentacyjne dla wszystkich ekranów wyników.

Ten moduł jest jedynym źródłem prawdy dla liczb pokazywanych w Asystencie,
Symulatorze i Porównywarce. Ekrany nie liczą już własnych wersji
``total_net_benefit``, ``avg_monthly``, ``tax_efficiency`` ani ``roi_multiple``.
"""

from app.core.base import resolve_base
from app.simulation.config import base_account_key
from app.simulation.schemas import ResultSummary, SimulationInput, SimulationResult


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


def _has_part_time_income(input_data: SimulationInput, age: int) -> bool:
    """Czy w danym roku działa etap części etatu (Barista)."""
    return any(
        stage.stage_type == "realizacja"
        and stage.part_time_net_monthly > 0
        and stage.start_age <= age < stage.end_age
        for stage in input_data.stages
    )


def build_summary(
    input_data: SimulationInput, result: SimulationResult
) -> ResultSummary:
    """Zbuduj spójny zestaw metryk z wyniku silnika."""
    years = result.years
    payout_years = [year for year in years if year.annual_withdrawal > 0]
    monthly_values = [
        year.monthly_withdrawal for year in payout_years if year.monthly_withdrawal > 0
    ]
    # Minimum liczymy po całym oknie realizacji, także po latach z zerem
    # (wyczerpanie portfela). Inaczej karta „minimalna wypłata” kłamie przy
    # nieosiągalnym celu.
    realization_ages = [
        age
        for stage in input_data.stages
        if stage.stage_type == "realizacja"
        for age in range(stage.start_age, stage.end_age)
    ]
    if realization_ages:
        first_age, last_age = min(realization_ages), max(realization_ages)
        window_values = [
            year.monthly_withdrawal
            for year in years
            if first_age <= year.age <= last_age
            and not _has_part_time_income(input_data, year.age)
        ]
    elif payout_years:
        first_age = min(year.age for year in payout_years)
        last_age = max(year.age for year in payout_years)
        window_values = [
            year.monthly_withdrawal
            for year in years
            if first_age <= year.age <= last_age
        ]
    else:
        window_values = []
    avg_monthly = (
        result.total_withdrawn / 12 / len(payout_years) if payout_years else None
    )
    min_monthly = min(window_values) if window_values else None
    max_monthly = max(monthly_values) if monthly_values else None
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
