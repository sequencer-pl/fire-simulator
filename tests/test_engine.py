import pytest
from conftest import acc, accumulation_stage, realization_stage

from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput


def test_stage_order_irrelevant_for_sequential():
    # Kolejność etapów w liście nie ma wpływu na wyniki dla etapów sekwencyjnych
    # (silnik przetwarza wieki chronologicznie)
    stage_a = accumulation_stage(
        {"broker": acc(starting_balance=100000, roi=0.02, annual_contribution=24000)},
        end=45,
    )
    stage_b = realization_stage("Broker", {"broker": acc(roi=0.02, buffer=100000)}, 45, 50)

    def months(stages):
        r = simulate(SimulationInput(stages=stages, max_age=49))
        return [(y.monthly_withdrawal, y.total_wealth) for y in r.years]

    assert months([stage_a, stage_b]) == months([stage_b, stage_a])


# --- Akumulacja ---


def test_accumulation_growth_only():
    stages = [
        accumulation_stage(
            {"broker": acc(starting_balance=100000, roi=0.02)},
            start=40,
            end=45,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44))
    assert result.years[0].balances["broker"] == pytest.approx(100000)
    assert result.years[1].balances["broker"] == pytest.approx(102000)
    assert result.years[4].balances["broker"] == pytest.approx(108243.22, rel=1e-4)


def test_accumulation_with_contribution():
    stages = [
        accumulation_stage(
            {"broker": acc(starting_balance=100000, roi=0.02, annual_contribution=24000)},
            start=40,
            end=45,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=44))
    assert result.years[1].balances["broker"] == pytest.approx(126000)
    assert result.years[2].balances["broker"] == pytest.approx(152520)


# --- Realizacja ---


def test_realization_pmt_with_buffer():
    stages = [
        accumulation_stage({"broker": acc(starting_balance=1000000, roi=0.02)}, start=40, end=45),
        realization_stage("Broker", {"broker": acc(roi=0.02, buffer=100000)}, 45, 60),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    # Saldo rośnie do ~1.08M, potem wypłaty PMT
    y = result.years[5]
    assert y.annual_withdrawal > 0
    assert y.stage_name == "Broker"


def test_passive_growth_for_unhandled_accounts():
    stages = [
        accumulation_stage(
            {
                "broker": acc(starting_balance=100000, roi=0.02),
                "ike": acc(starting_balance=100000, roi=0.02),
            },
            end=45,
        ),
        realization_stage("Broker", {"broker": acc(roi=0.02, buffer=100000)}, 45, 50),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49))
    # IKE rośnie pasywnie 2% rocznie mimo braku w etapie realizacji
    ike_balances = [y.balances["ike"] for y in result.years[5:]]
    for i in range(1, len(ike_balances)):
        assert ike_balances[i] > ike_balances[i - 1]


# --- Nakładające się etapy ---


def test_realization_cannot_overlap_accumulation():
    stages = [
        accumulation_stage({"broker": acc(starting_balance=100000, roi=0.02)}, start=40, end=50),
        realization_stage("Broker", {"broker": acc(roi=0.02, buffer=0)}, 45, 60),
    ]
    with pytest.raises(ValueError, match="przed końcem etapu akumulacji"):
        simulate(SimulationInput(stages=stages, max_age=59))


def test_realization_after_accumulation_ok():
    stages = [
        accumulation_stage({"broker": acc(starting_balance=100000, roi=0.02)}, start=40, end=50),
        realization_stage("Broker", {"broker": acc(roi=0.02, buffer=0)}, 50, 60),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    assert result.years[0].age == 40
    assert result.years[-1].age == 59


def test_realization_only_without_accumulation_ok():
    stages = [
        realization_stage(
            "Broker",
            {"broker": acc(starting_balance=100000, roi=0.02, buffer=0)},
            45,
            60,
        )
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    assert result.years[0].annual_withdrawal > 0


def test_overlapping_stages_merge_withdrawal():
    stages = [
        accumulation_stage({"ike": acc(starting_balance=300000, roi=0.02)}, start=40, end=45),
        realization_stage(
            "IKE+ZUS",
            {"ike": acc(roi=0.02, buffer=0), "zus": acc(monthly_pension=4000)},
            45,
            50,
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49))
    y = result.years[5]
    # ZUS 4000*12 = 48000 + PMT z IKE
    assert y.annual_withdrawal > 48000
    assert y.monthly_withdrawal == pytest.approx(y.annual_withdrawal / 12)
    assert result.has_pension


def test_deduplication_same_account():
    stages = [
        realization_stage(
            "ZUS+IKE",
            {
                "zus": acc(monthly_pension=4000),
                "ike": acc(starting_balance=300000, roi=0.02, buffer=0),
            },
            45,
            55,
        ),
        realization_stage(
            "ZUS+IKZE",
            {
                "zus": acc(monthly_pension=5000),
                "ikze": acc(starting_balance=200000, roi=0.02, buffer=0),
            },
            50,
            60,
        ),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=59))
    # Na wieku 50-54 ZUS przetwarzany raz (pierwszy etap wygrywa): 4000*12 = 48000
    overlapping = [y for y in result.years if y.age >= 50 and y.age < 55]
    for y in overlapping:
        # ZUS nie może być policzony podwójnie (48000, nie 108000)
        assert y.annual_withdrawal < 108000


# --- ZUS ---


def test_zus_has_pension_flag():
    stages = [realization_stage("ZUS", {"zus": acc(monthly_pension=4000)}, 67, 100)]
    result = simulate(SimulationInput(stages=stages, max_age=100))
    assert result.has_pension
    assert "zus" not in result.accounts


def test_no_pension_flag_without_zus():
    stages = [
        accumulation_stage({"broker": acc(starting_balance=100000, roi=0.02)}, end=45),
        realization_stage("Broker", {"broker": acc(roi=0.02, buffer=0)}, 45, 50),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=49))
    assert not result.has_pension


def test_zus_sequential_stages():
    stages = [
        realization_stage("ZUS", {"zus": acc(monthly_pension=3000)}, 45, 50),
        realization_stage("ZUS", {"zus": acc(monthly_pension=3500)}, 50, 52),
        realization_stage("ZUS", {"zus": acc(monthly_pension=4000)}, 52, 100),
    ]
    result = simulate(SimulationInput(stages=stages, max_age=100))
    # Rosnąca emerytura: 3000 -> 3500 -> 4000 PLN/mies. (netto po skali PIT)
    assert result.years[0].monthly_withdrawal == pytest.approx(2940.0)
    assert result.years[5].monthly_withdrawal == pytest.approx(3380.0)
    assert result.years[7].monthly_withdrawal == pytest.approx(3820.0)
    assert result.years[-1].annual_withdrawal == pytest.approx(45840.0)
