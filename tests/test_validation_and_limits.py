import pytest
from conftest import acc, accumulation_stage
from pydantic import ValidationError
from starlette.requests import Request

from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput, StageInput
from app.web.limits import LIMITS, client_ip


def _request(headers: dict[str, str], client=("1.2.3.4", 1234)) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
            "client": client,
        }
    )


def test_stage_end_must_be_after_start():
    with pytest.raises(ValidationError):
        StageInput(stage_type="akumulacja", start_age=40, end_age=40)
    with pytest.raises(ValidationError):
        StageInput(stage_type="akumulacja", start_age=50, end_age=40)


def test_simulation_input_is_bounded():
    with pytest.raises(ValidationError):
        SimulationInput(stages=[], max_age=100_000)
    with pytest.raises(ValidationError):
        StageInput(stage_type="akumulacja", start_age=-1, end_age=40)
    with pytest.raises(ValidationError):
        StageInput(stage_type="akumulacja", start_age=40, end_age=121)


def test_stage_name_is_length_limited():
    with pytest.raises(ValidationError):
        StageInput(stage_type="akumulacja", name="x" * 201, start_age=40, end_age=41)


def test_simulate_caps_horizon_at_max_age():
    stage = accumulation_stage({"broker": acc(starting_balance=1000, roi=0.0)}, start=40, end=110)
    result = simulate(
        SimulationInput(stages=[stage], max_age=100),
    )
    assert result.years[-1].age == 100


def test_simulate_never_extends_past_last_stage():
    stage = accumulation_stage({"broker": acc(starting_balance=1000, roi=0.0)}, start=40, end=110)
    result = simulate(
        SimulationInput(stages=[stage], max_age=120),
    )
    assert result.years[-1].age == 109


def test_simulate_rate_limit(client):
    limiter = LIMITS["simulate"]
    previous = limiter.limit
    limiter.limit = 2
    try:
        payload = {"stages": [], "max_age": 100}
        assert client.post("/api/simulate", json=payload).status_code == 200
        assert client.post("/api/simulate", json=payload).status_code == 200
        response = client.post("/api/simulate", json=payload)
        assert response.status_code == 429
        assert response.headers["Retry-After"]
    finally:
        limiter.limit = previous


def test_client_ip_uses_last_forwarded_hop_in_production(monkeypatch):
    monkeypatch.setenv("FIRE_ENV", "production")
    request = _request({"x-forwarded-for": "9.9.9.9, 5.5.5.5"})
    assert client_ip(request) == "5.5.5.5"


def test_client_ip_ignores_forwarded_header_in_dev(monkeypatch):
    monkeypatch.delenv("FIRE_ENV", raising=False)
    request = _request({"x-forwarded-for": "9.9.9.9, 5.5.5.5"})
    assert client_ip(request) == "1.2.3.4"


def test_mortgage_requires_end_age():
    from pydantic import ValidationError

    from app.simulation.schemas import AccountConfig, SimulationInput, StageInput

    with pytest.raises(ValidationError):
        SimulationInput(
            stages=[
                StageInput(
                    stage_type="akumulacja",
                    start_age=40,
                    end_age=41,
                    accounts={"broker": AccountConfig()},
                )
            ],
            mortgage_monthly=3_000,
            mortgage_end_age=None,
        )


def test_mortgage_end_age_at_plan_start_is_accepted():
    """Kredyt spłacony w roku startu nie jest błędem — silnik nie dokłada raty."""
    from app.simulation.schemas import AccountConfig, SimulationInput, StageInput

    data = SimulationInput(
        stages=[
            StageInput(
                stage_type="akumulacja",
                start_age=40,
                end_age=41,
                accounts={"broker": AccountConfig()},
            )
        ],
        mortgage_monthly=3_000,
        mortgage_end_age=40,
    )
    assert data.mortgage_end_age == 40


def test_coast_with_mortgage_ending_at_current_age_does_not_raise():
    from app.simulation.planner import WizardAnswers, build_stages

    answers = WizardAnswers(
        gender="m",
        age_now=40,
        employment="etat",
        gross_monthly=12_000,
        capital={"broker": 200_000},
        savings=1_000,
        use_broker=True,
        mortgage_monthly=3_000,
        mortgage_end_age=40,
        semi_fire_enabled=True,
        semi_fire_mode="coast",
        semi_fire_age=40,
        retire_early_age=55,
    )
    stages = build_stages(answers)
    assert stages
