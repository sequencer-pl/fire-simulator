from app.simulation.engine import simulate
from app.simulation.schemas import AccountConfig, SimulationInput, StageInput


def test_multiple_lokata_and_broker_instances_with_custom_names():
    data = SimulationInput(
        stages=[
            StageInput(
                stage_type="akumulacja",
                name="Akumulacja",
                start_age=35,
                end_age=45,
                accounts={
                    "lokata": AccountConfig(
                        custom_name="Lokata mBank",
                        starting_balance=50_000,
                        roi=0.015,
                        lokata_term_months=12,
                    ),
                    "lokata:2": AccountConfig(
                        custom_name="Lokata PKO",
                        starting_balance=50_000,
                        roi=0.03,
                        lokata_term_months=24,
                    ),
                    "broker": AccountConfig(
                        custom_name="XTB — ETF Świat",
                        starting_balance=100_000,
                        annual_contribution=12_000,
                        roi=0.04,
                        cost_basis_enabled=True,
                        cost_basis=100_000,
                    ),
                    "broker:2": AccountConfig(
                        custom_name="IBKR — Akcje USA",
                        starting_balance=100_000,
                        annual_contribution=12_000,
                        roi=0.07,
                        cost_basis_enabled=True,
                        cost_basis=100_000,
                    ),
                },
            ),
            StageInput(
                stage_type="realizacja",
                name="Realizacja",
                start_age=45,
                end_age=55,
                accounts={
                    "lokata": AccountConfig(roi=0.015, lokata_term_months=12),
                    "lokata:2": AccountConfig(roi=0.03, lokata_term_months=24),
                    "broker": AccountConfig(roi=0.04),
                    "broker:2": AccountConfig(roi=0.07),
                },
            ),
        ]
    )
    res = simulate(data)
    assert res.account_labels["lokata"] == "Lokata mBank"
    assert res.account_labels["lokata:2"] == "Lokata PKO"
    assert res.account_labels["broker"] == "XTB — ETF Świat"
    assert res.account_labels["broker:2"] == "IBKR — Akcje USA"

    end_accum = next(y for y in res.years if y.age == 44)
    assert end_accum.ending_balances["lokata:2"] > end_accum.ending_balances["lokata"]
    assert end_accum.ending_balances["broker:2"] > end_accum.ending_balances["broker"]
    assert res.total_withdrawn > 0


def test_real_estate_rental_income_and_liquidation():
    data = SimulationInput(
        stages=[
            StageInput(
                stage_type="akumulacja",
                name="Akumulacja",
                start_age=40,
                end_age=45,
                accounts={
                    "nieruchomosc": AccountConfig(
                        custom_name="Kawalerka wynajem",
                        starting_balance=500_000,
                        roi=0.01,
                        rental_income_monthly=2_500,
                        liquidation_age=47,
                    ),
                    "broker": AccountConfig(
                        starting_balance=0,
                        roi=0.05,
                    ),
                },
            ),
            StageInput(
                stage_type="realizacja",
                name="Realizacja",
                start_age=45,
                end_age=50,
                accounts={
                    "nieruchomosc": AccountConfig(
                        roi=0.01,
                        rental_income_monthly=2_500,
                        liquidation_age=47,
                    ),
                    "broker": AccountConfig(roi=0.05),
                },
                withdrawal_target_gross_monthly=4_000,
            ),
        ]
    )
    res = simulate(data)
    # W wieku 40 r.ż. najem (30 000 zł/rok brutto, podatek 8,5% = 2 550 zł) zasila brokera.
    y40 = next(y for y in res.years if y.age == 40)
    assert round(y40.taxes["nieruchomosc"], 2) == 2_550.0
    assert round(y40.ending_balances["broker"], 2) == 27_450.0

    # W wieku 45-46 r.ż. nieruchomość wypłaca czynsz, a w wieku 47 r.ż. jest sprzedawana (0% PIT).
    y46 = next(y for y in res.years if y.age == 46)
    assert y46.ending_balances["nieruchomosc"] > 500_000
    assert y46.withdrawals["nieruchomosc"] == 30_000.0

    y47 = next(y for y in res.years if y.age == 47)
    assert y47.ending_balances.get("nieruchomosc", 0.0) == 0.0
    assert y47.balances["broker"] > 500_000


def test_b2b_ikze_tax_regimes():
    def _run_regime(regime: str, lump_rate: float = 0.12) -> float:
        inp = SimulationInput(
            monthly_gross=20_000,
            stages=[
                StageInput(
                    stage_type="akumulacja",
                    name="Akumulacja",
                    start_age=35,
                    end_age=36,
                    accounts={
                        "ikze": AccountConfig(
                            annual_contribution=16_956,
                            ikze_limit="self_employed",
                            ikze_tax_regime=regime,  # type: ignore[arg-type]
                            ikze_lump_sum_rate=lump_rate,
                            ikze_refund_target="broker",
                        ),
                        "broker": AccountConfig(starting_balance=0, roi=0.05),
                    },
                )
            ],
        )
        return simulate(inp).total_tax_refund

    refund_flat = _run_regime("flat_19")
    refund_lump_12 = _run_regime("lump_sum", 0.12)
    refund_lump_85 = _run_regime("lump_sum", 0.085)

    assert round(refund_flat, 2) == round(16_956 * 0.19, 2)
    assert round(refund_lump_12, 2) == round(16_956 * 0.12, 2)
    assert round(refund_lump_85, 2) == round(16_956 * 0.085, 2)


def test_barista_fire_and_mortgage_in_realization():
    inp = SimulationInput(
        mortgage_monthly=2_000,
        mortgage_end_age=52,
        stages=[
            StageInput(
                stage_type="akumulacja",
                name="Akumulacja",
                start_age=45,
                end_age=50,
                accounts={
                    "gotowka": AccountConfig(starting_balance=800_000, roi=0.0),
                },
            ),
            StageInput(
                stage_type="realizacja",
                name="Barista FIRE",
                start_age=50,
                end_age=55,
                withdrawal_target_gross_monthly=6_000,
                part_time_net_monthly=3_000,
                accounts={
                    "gotowka": AccountConfig(roi=0.0),
                },
            ),
        ],
    )
    res = simulate(inp)
    # W wieku 50 i 51 r.ż. jest praca na pół etatu (3 000 zł) i kredyt (2 000 zł):
    # potrzebna wypłata z portfela = 6 000 - 3 000 + 2 000 = 5 000 zł/mies.
    y50 = next(y for y in res.years if y.age == 50)
    assert round(y50.monthly_withdrawal, 2) == 5_000.0
    # Od wieku 52 r.ż. kredyt spłacony: potrzebna wypłata = 6 000 - 3 000 = 3 000 zł/mies.
    y52 = next(y for y in res.years if y.age == 52)
    assert round(y52.monthly_withdrawal, 2) == 3_000.0
