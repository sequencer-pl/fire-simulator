"""Kolejność wypłat: wariant tax_asc wybiera najtańsze podatkowo konta."""

from conftest import acc, realization_stage

from app.simulation.config import TaxConfig
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput

CFG = TaxConfig(inflation=0.0, prog_indexation=None)


def _run(policy: str):
    stage = realization_stage(
        "Wypłaty",
        {
            "oki_inw": acc(starting_balance=100_000, roi=0.03),
            "broker": acc(
                starting_balance=100_000,
                roi=0.03,
                cost_basis_enabled=True,
                cost_basis=50_000,
            ),
        },
        55,
        60,
    )
    stage.withdrawal_target_gross_monthly = 3_000
    return simulate(
        SimulationInput(
            stages=[stage],
            max_age=59,
            config=CFG,
            withdrawal_policy=policy,
        ),
        target=3_000,
    )


def test_tax_asc_prefers_oki_before_taxable_broker():
    tier = _run("defer_tier")
    tax = _run("defer_tax")
    tier_first = next(y for y in tier.years if y.withdrawals)
    tax_first = next(y for y in tax.years if y.withdrawals)

    # Proporcjonalny wariant bierze po połowie z OKI i brokera, płacąc Belkę.
    assert tier_first.withdrawals.get("broker", 0) > 0
    assert tier_first.taxes.get("broker", 0) > 0

    # tax_asc najpierw opróżnia OKI (bez Belki), dopiero potem brokera.
    assert tax_first.withdrawals.get("broker", 0) == 0
    assert tax_first.taxes.get("broker", 0) == 0
    assert tax_first.withdrawals.get("oki_inw", 0) > tier_first.withdrawals.get(
        "oki_inw", 0
    )
