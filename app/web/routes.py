import json
import os
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.simulation.config import default_config
from app.simulation.engine import _resolve_base, simulate
from app.simulation.schemas import SimulationInput, SimulationResult
from app.stages.metadata import STAGE_META
from app.stages.registry import get_all_stage_types
from app.storage import db

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


def _monthly_contribution(stage, monthly_gross: float = 0.0) -> float | None:
    """Employee's own monthly investment cost for an accumulation stage."""
    total_annual = 0.0
    for name, cfg in stage.accounts.items():
        if name in ("gotowka", "lokata", "zus"):
            continue
        elif name == "ppk":
            total_annual += cfg.employee_pct * _resolve_base(cfg.model_dump(), monthly_gross) * 12
        elif name == "ppe":
            total_annual += cfg.annual_contribution
        else:
            total_annual += cfg.annual_contribution
    return round(total_annual / 12, 2) if total_annual > 0 else None


def _total_user_contributions(input_data: SimulationInput) -> float:
    """Total employee contributions across all stages (lifetime)."""
    total = 0.0
    for stage in input_data.stages:
        years = max(0, (stage.end_age or 0) - (stage.start_age or 0))
        if years <= 0:
            continue
        for name, cfg in stage.accounts.items():
            if name in ("gotowka", "lokata", "zus"):
                continue
            if name == "ppk":
                total += cfg.employee_pct * _resolve_base(cfg.model_dump(), input_data.monthly_gross) * years * 12
            elif name == "ppe":
                total += cfg.annual_contribution * years
            else:
                total += cfg.annual_contribution * years
    return round(total, 2)


def _initial_capital(input_data: SimulationInput) -> float:
    """Sum of starting_balance for each unique account (first occurrence only)."""
    seen: set[str] = set()
    total = 0.0
    for stage in sorted(input_data.stages, key=lambda s: s.start_age or 0):
        for name, cfg in stage.accounts.items():
            if name not in seen and cfg.starting_balance > 0:
                total += cfg.starting_balance
                seen.add(name)
    return round(total, 2)


def _stages_summary(
    input_data: SimulationInput, result: SimulationResult | None = None
) -> list[dict]:
    years_by_age = {y.age: y for y in result.years} if result else {}
    stages = []
    for stage in input_data.stages:
        meta = STAGE_META.get(stage.stage_type, {})
        accounts = []
        for key in stage.accounts:
            acc_label = meta.get("available_accounts", {}).get(key, {}).get("label", key)
            accounts.append(acc_label)
        info = {
            "label": meta.get("label", stage.stage_type),
            "start_age": stage.start_age,
            "end_age": stage.end_age,
            "accounts": accounts,
        }
        if stage.stage_type == "realizacja" and years_by_age:
            withdrawals = [
                years_by_age[a].monthly_withdrawal
                for a in range(stage.start_age, stage.end_age)
                if a in years_by_age and years_by_age[a].monthly_withdrawal > 0
            ]
            if withdrawals:
                info["avg_monthly_withdrawal"] = round(sum(withdrawals) / len(withdrawals), 2)
        elif stage.stage_type == "akumulacja":
            mc = _monthly_contribution(stage, input_data.monthly_gross)
            if mc is not None:
                info["monthly_contribution"] = mc
        stages.append(info)
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
        "defaults": _get_defaults(),
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


@router.get("/api/config/user")
async def api_user_config(request: Request):
    user_id = _current_user_id(request)
    if not user_id:
        return {"config": None}
    saved = db.get_user_config(user_id)
    if not saved:
        return {"config": None}
    return {"config": json.loads(saved)}


@router.put("/api/config/user")
async def api_save_user_config(request: Request):
    user_id = _require_user(request)
    body = await request.json()
    db.save_user_config(user_id, json.dumps(body, separators=(",", ":")), _now())
    return {"ok": True}


@router.delete("/api/config/user")
async def api_delete_user_config(request: Request):
    user_id = _require_user(request)
    db.delete_user_config(user_id)
    return {"ok": True}


# --- Helpers ---


def _get_defaults() -> dict:
    return {
        "monthly_gross": 8700,
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
                        "employee_pct": 0.02,
                        "employer_pct": 0.015,
                        "state_topups": True,
                        "roi": 0.06,
                    },
                    "ppe": {
                        "starting_balance": 50000,
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
