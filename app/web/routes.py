import json
import os
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput, SimulationResult
from app.stages.metadata import STAGE_META
from app.stages.registry import get_all_stage_types

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "static")


def _asset_version() -> str:
    """Static asset version based on mtime — forces cache refresh after file changes."""
    mtimes = [
        os.path.getmtime(os.path.join(STATIC_DIR, rel))
        for rel in (
            "css/style.css",
            "js/sim-utils.js",
            "js/sim-metadata.js",
            "js/sim-cards.js",
            "js/sim-stages.js",
            "js/simulator.js",
            "js/home.js",
            "js/compare.js",
        )
        if os.path.exists(os.path.join(STATIC_DIR, rel))
    ]
    return str(int(max(mtimes))) if mtimes else "0"


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _current_user_id(request: Request) -> int | None:
    return request.session.get("user_id")


def _require_user(request: Request) -> int:
    user_id = _current_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Zaloguj się, aby kontynuować.")
    return user_id


def _summary_from_result(result: SimulationResult) -> dict:
    years = result.years
    return {
        "final_wealth": result.final_wealth,
        "peak_wealth": result.peak_wealth,
        "total_withdrawn": result.total_withdrawn,
        "total_tax": result.total_tax,
        "accounts": result.accounts,
        "years": len(years),
        "warnings": len(result.warnings),
        "start_age": years[0].age if years else None,
        "end_age": years[-1].age if years else None,
        "has_pension": result.has_pension,
    }


def _stages_summary(input_data: SimulationInput) -> list[dict]:
    stages = []
    for stage in input_data.stages:
        meta = STAGE_META.get(stage.stage_type, {})
        accounts = []
        for key in stage.accounts:
            acc_label = meta.get("available_accounts", {}).get(key, {}).get("label", key)
            accounts.append(acc_label)
        stages.append({
            "label": meta.get("label", stage.stage_type),
            "start_age": stage.start_age,
            "end_age": stage.end_age,
            "accounts": accounts,
        })
    return stages


def _simulation_response(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "summary": json.loads(row["summary_json"]),
    }


# --- Views ---


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "home.html", {
        "version": _asset_version(),
    })


@router.get("/sim", response_class=HTMLResponse)
async def sim(request: Request):
    return templates.TemplateResponse(request, "simulator.html", {
        "version": _asset_version(),
        "stage_types": get_all_stage_types(),
    })


@router.get("/compare", response_class=HTMLResponse)
async def compare(request: Request):
    return templates.TemplateResponse(request, "compare.html", {
        "version": _asset_version(),
    })


# --- Simulation API (existing) ---


@router.post("/api/simulate")
async def api_simulate(input_data: SimulationInput):
    try:
        result = simulate(input_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return result


@router.get("/api/stage-types")
async def api_stage_types():
    return get_all_stage_types()


@router.get("/api/defaults")
async def api_defaults():
    return _get_defaults()


@router.get("/api/config")
async def api_config():
    return default_config().model_dump()


# --- Helpers ---


def _get_defaults() -> dict:
    return {
        "stages": [
            {
                "stage_type": "akumulacja",
                "name": "Akumulacja",
                "start_age": 40,
                "end_age": 45,
                "accounts": {
                    "broker": {
                        "starting_balance": 100000,
                        "roi": 0.02,
                        "annual_contribution": 24000,
                    },
                    "ike": {
                        "starting_balance": 100000,
                        "roi": 0.02,
                        "annual_contribution": 24000,
                    },
                    "ikze": {
                        "starting_balance": 100000,
                        "roi": 0.02,
                        "annual_contribution": 12000,
                    },
                    "ppk": {
                        "starting_balance": 30000,
                        "monthly_base": 8000,
                        "employee_pct": 0.02,
                        "employer_pct": 0.015,
                        "state_topups": True,
                        "roi": 0.06,
                    },
                    "ppe": {
                        "starting_balance": 50000,
                        "monthly_base": 8000,
                        "employer_pct": 0.035,
                        "annual_contribution": 6000,
                        "roi": 0.06,
                    },
                    "oipe": {
                        "starting_balance": 20000,
                        "roi": 0.06,
                        "annual_contribution": 10000,
                    },
                    "oki_inw": {
                        "starting_balance": 20000,
                        "roi": 0.06,
                        "annual_contribution": 10000,
                    },
                    "krypto": {
                        "starting_balance": 10000,
                        "roi": 0.08,
                        "annual_contribution": 6000,
                    },
                    "gotowka": {
                        "starting_balance": 20000,
                        "roi": -0.025,
                    },
                    "zus": {
                        "starting_balance": 150000,
                        "starting_balance_ofe": 50000,
                        "monthly_base": 8000,
                        "ofe_member": False,
                        "roi": 0.06,
                    },
                },
            },
            {
                "stage_type": "realizacja",
                "name": "Broker",
                "start_age": 45,
                "end_age": 60,
                "accounts": {
                    "broker": {
                        "roi": 0.02,
                        "buffer": 100000,
                    },
                    "oki_inw": {
                        "roi": 0.02,
                        "buffer": 0,
                    },
                    "krypto": {
                        "roi": 0.02,
                        "buffer": 0,
                    },
                },
            },
            {
                "stage_type": "realizacja",
                "name": "IKE",
                "start_age": 60,
                "end_age": 65,
                "accounts": {
                    "ike": {
                        "roi": 0.02,
                        "buffer": 0,
                    },
                },
            },
            {
                "stage_type": "realizacja",
                "name": "IKZE",
                "start_age": 65,
                "end_age": 70,
                "accounts": {
                    "ikze": {
                        "roi": 0.02,
                        "buffer": 0,
                    },
                },
            },
            {
                "stage_type": "realizacja",
                "name": "III filar (PPK/PPE/OIPE)",
                "start_age": 60,
                "end_age": 100,
                "accounts": {
                    "ppk": {
                        "roi": 0.02,
                        "buffer": 0,
                    },
                    "ppe": {
                        "roi": 0.02,
                        "buffer": 0,
                    },
                    "oipe": {
                        "roi": 0.02,
                        "buffer": 0,
                    },
                    "gotowka": {
                        "roi": -0.025,
                        "buffer": 0,
                    },
                },
            },
            {
                "stage_type": "realizacja",
                "name": "ZUS",
                "start_age": 67,
                "end_age": 100,
                "accounts": {
                    "zus": {
                        "monthly_pension": 0,
                    },
                },
            },
        ],
    }
