"""Wspólne metryki wyników — jedna definicja dla Asystenta i Symulatora."""

import pytest

from app.simulation.engine import simulate
from app.simulation.planner import WizardAnswers, plan
from app.simulation.summary import build_summary

BASE = dict(
    gender="m",
    age_now=35,
    employment="etat",
    gross_monthly=12_000,
    capital={"broker": 150_000},
    use_ppk=True,
    savings=3_000,
    strategy="zbilansowana",
    retire_early_age=55,
)


def test_wizard_summary_matches_simulator_for_same_input():
    result = plan(1, WizardAnswers(**BASE), scenarios=False, extend_chart=False)
    assert result.summary is not None

    replay = simulate(result.input)
    summary = build_summary(result.input, replay)

    assert result.summary.total_net_benefit == pytest.approx(
        summary.total_net_benefit, abs=2.0
    )
    assert result.summary.total_withdrawn == pytest.approx(
        summary.total_withdrawn, abs=2.0
    )
    assert result.summary.final_wealth_net == pytest.approx(
        summary.final_wealth_net, abs=2.0
    )
    assert result.summary.peak_wealth == pytest.approx(summary.peak_wealth, abs=2.0)
    assert result.summary.total_tax == pytest.approx(summary.total_tax, abs=2.0)
    assert result.summary.avg_monthly == pytest.approx(
        summary.avg_monthly, abs=0.05
    )
    assert result.summary.roi_multiple == pytest.approx(
        summary.roi_multiple, abs=0.001
    )


def test_summary_derived_metrics_are_consistent():
    result = plan(1, WizardAnswers(**BASE), scenarios=False, extend_chart=False)
    summary = result.summary
    assert summary is not None

    assert summary.total_net_benefit == pytest.approx(
        summary.total_withdrawn + summary.final_wealth_net, abs=0.05
    )
    assert summary.initial_capital == pytest.approx(150_000)
    assert summary.total_user_contributions > 0
    assert summary.avg_monthly is not None and summary.avg_monthly > 0
    assert summary.tax_efficiency is not None
    assert summary.roi_multiple is not None


def test_summary_reports_no_payout_metrics_gracefully():
    result = plan(1, WizardAnswers(**{**BASE, "capital": {}}), scenarios=False)
    summary = result.summary
    assert summary is not None
    if summary.total_withdrawn <= 0:
        assert summary.avg_monthly is None
        assert summary.tax_efficiency is None


def test_simulate_exposes_projection_for_shared_result_body(client):
    payload = {
        "stages": [
            {
                "stage_type": "akumulacja",
                "name": "Akumulacja",
                "start_age": 40,
                "end_age": 55,
                "accounts": {
                    "broker": {
                        "starting_balance": 200_000,
                        "roi": 0.05,
                        "annual_contribution": 24_000,
                    }
                },
            },
            {
                "stage_type": "realizacja",
                "name": "Emerytura",
                "start_age": 55,
                "end_age": 90,
                "accounts": {"broker": {"roi": 0.04}},
            },
        ],
        "max_age": 90,
    }
    response = client.post("/api/simulate", json=payload)
    assert response.status_code == 200
    body = response.json()
    projection = body["projection"]
    assert projection["phase_metrics"]
    assert projection["account_phases"]
    assert projection["chart"]["ages"] == [year["age"] for year in body["years"]]
    assert "broker" in projection["chart"]["balances"]
    assert body["summary"]["total_net_benefit"] == pytest.approx(
        body["summary"]["total_withdrawn"] + body["summary"]["final_wealth_net"],
        abs=0.05,
    )
