import os

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput
from app.stages.registry import get_all_stage_types

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "static")


def _asset_version() -> str:
    """Wersja statyków wg mtime — wymusza odświeżenie cache po zmianie plików."""
    mtimes = [
        os.path.getmtime(os.path.join(STATIC_DIR, rel))
        for rel in ("css/style.css", "js/simulator.js")
        if os.path.exists(os.path.join(STATIC_DIR, rel))
    ]
    return str(int(max(mtimes))) if mtimes else "0"


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request,
        "simulator.html",
        {
            "stage_types": get_all_stage_types(),
            "defaults": _get_defaults(),
            "asset_version": _asset_version(),
        },
    )


@router.post("/api/simulate")
async def api_simulate(input_data: SimulationInput):
    try:
        result = simulate(input_data)
        return result.model_dump()
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@router.get("/api/stage-types")
async def api_stage_types():
    return get_all_stage_types()


@router.get("/api/defaults")
async def api_defaults():
    return _get_defaults()


@router.get("/api/config")
async def api_config():
    return default_config().model_dump()


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
                    "oki": {
                        "starting_balance": 20000,
                        "roi": 0.06,
                        "annual_contribution": 10000,
                        "asset_exemption": 100000,
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
                    "oki": {
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
