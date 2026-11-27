"""Wspólne przeliczenia dochodu i budżetu na życie.

Trzymamy je poza ``summary.py``, bo z tych samych definicji korzysta silnik
(roczne pola wyniku) i warstwa metryk. Dzięki temu front i backend nie liczą
budżetu dwiema różnymi metodami.
"""

from app.simulation.schemas import SimulationInput, YearResult


def extra_income_monthly(input_data: SimulationInput, year: YearResult) -> float:
    """Dochód z pracy na część etatu w danym roku."""
    extra_income = 0.0
    for stage in input_data.stages:
        if (
            stage.stage_type == "realizacja"
            and "zus" not in stage.accounts
            and stage.start_age <= year.age < stage.end_age
            and stage.part_time_net_monthly > 0
        ):
            extra_income = max(extra_income, stage.part_time_net_monthly)
    return extra_income


def obligations_monthly(input_data: SimulationInput, age: int) -> float:
    """Suma aktywnych zobowiązań czasowych w danym wieku."""
    return sum(
        obligation.monthly
        for obligation in input_data.effective_obligations()
        if obligation.start_age <= age < obligation.end_age
    )


def total_net_income_monthly(input_data: SimulationInput, year: YearResult) -> float:
    """Łączny dochód netto przed zobowiązaniami: portfel + ZUS + praca."""
    return year.monthly_withdrawal + extra_income_monthly(input_data, year)


def lifestyle_monthly_net(input_data: SimulationInput, year: YearResult) -> float:
    """Budżet na życie: łączny dochód netto minus aktywne zobowiązania."""
    return max(
        0.0,
        total_net_income_monthly(input_data, year)
        - obligations_monthly(input_data, year.age),
    )
