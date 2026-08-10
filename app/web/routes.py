from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput
from app.stages.registry import get_all_stage_types

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request,
        "simulator.html",
        {
            "stage_types": get_all_stage_types(),
            "defaults": _get_defaults(),
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
                "name": "ZUS",
                "start_age": 67,
                "end_age": 100,
                "accounts": {
                    "zus": {
                        "monthly_pension": 4000,
                    },
                },
            },
        ],
    }
