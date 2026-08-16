import json
import os
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from app.core.security import hash_password, is_valid_password, verify_password
from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput, SimulationResult
from app.stages.registry import get_all_stage_types
from app.storage import db

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "static")


def _asset_version() -> str:
    """Wersja statyków wg mtime — wymusza odświeżenie cache po zmianie plików."""
    mtimes = [
        os.path.getmtime(os.path.join(STATIC_DIR, rel))
        for rel in ("css/style.css", "js/simulator.js", "js/home.js", "js/compare.js")
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


def _simulation_response(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "summary": json.loads(row["summary_json"]),
    }


# --- Widoki ---


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request,
        "home.html",
        {"asset_version": _asset_version()},
    )


@router.get("/sim", response_class=HTMLResponse)
async def simulator(request: Request):
    return templates.TemplateResponse(
        request,
        "simulator.html",
        {
            "stage_types": get_all_stage_types(),
            "defaults": _get_defaults(),
            "asset_version": _asset_version(),
        },
    )


@router.get("/compare", response_class=HTMLResponse)
async def compare_view(request: Request):
    return templates.TemplateResponse(
        request,
        "compare.html",
        {"asset_version": _asset_version()},
    )


# --- API symulacji (istniejące) ---


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


# --- Autoryzacja ---


class AuthPayload(BaseModel):
    email: str
    password: str


@router.post("/api/register")
async def api_register(payload: AuthPayload, request: Request):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Podaj poprawny adres e-mail.")
    if not is_valid_password(payload.password):
        raise HTTPException(
            status_code=400, detail="Hasło musi mieć co najmniej 8 znaków."
        )
    try:
        user_id = db.create_user(email, hash_password(payload.password), _now())
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Konto z tym e-mailem już istnieje.") from None
    request.session["user_id"] = user_id
    return {"email": email}


@router.post("/api/login")
async def api_login(payload: AuthPayload, request: Request):
    email = payload.email.strip().lower()
    user = db.get_user_by_email(email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Nieprawidłowy e-mail lub hasło.")
    request.session["user_id"] = user["id"]
    return {"email": email}


@router.post("/api/logout")
async def api_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/api/session")
async def api_session(request: Request):
    user_id = _current_user_id(request)
    if not user_id:
        return {"email": None}
    user = db.get_user_by_id(user_id)
    if not user:
        request.session.clear()
        return {"email": None}
    return {"email": user["email"]}


# --- Zapisane symulacje ---


class SaveSimulationPayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    input: SimulationInput


class RenamePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@router.post("/api/simulations")
async def api_save_simulation(payload: SaveSimulationPayload, request: Request):
    user_id = _require_user(request)
    try:
        result = simulate(payload.input)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    now = _now()
    sim_id = db.insert_simulation(
        user_id=user_id,
        name=payload.name.strip(),
        created_at=now,
        input_json=json.dumps(payload.input.model_dump(mode="json")),
        result_json=json.dumps(result.model_dump(mode="json")),
        summary_json=json.dumps(_summary_from_result(result)),
    )
    row = db.get_simulation(sim_id, user_id)
    return _simulation_response(row)


@router.get("/api/simulations")
async def api_list_simulations(request: Request):
    user_id = _require_user(request)
    rows = db.list_simulations(user_id)
    return [_simulation_response(row) for row in rows]


@router.get("/api/simulations/{sim_id}")
async def api_get_simulation(sim_id: int, request: Request):
    user_id = _require_user(request)
    row = db.get_simulation(sim_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Symulacja nie znaleziona.")
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "input": json.loads(row["input_json"]),
        "result": json.loads(row["result_json"]),
        "summary": json.loads(row["summary_json"]),
    }


@router.patch("/api/simulations/{sim_id}")
async def api_rename_simulation(sim_id: int, payload: RenamePayload, request: Request):
    user_id = _require_user(request)
    if not db.update_simulation_name(sim_id, user_id, payload.name.strip(), _now()):
        raise HTTPException(status_code=404, detail="Symulacja nie znaleziona.")
    row = db.get_simulation(sim_id, user_id)
    return _simulation_response(row)


@router.post("/api/simulations/{sim_id}/duplicate")
async def api_duplicate_simulation(sim_id: int, request: Request):
    user_id = _require_user(request)
    row = db.get_simulation(sim_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Symulacja nie znaleziona.")
    new_id = db.duplicate_simulation(
        sim_id, user_id, f"Kopia: {row['name']}", _now()
    )
    new_row = db.get_simulation(new_id, user_id)
    return _simulation_response(new_row)


@router.delete("/api/simulations/{sim_id}")
async def api_delete_simulation(sim_id: int, request: Request):
    user_id = _require_user(request)
    if not db.delete_simulation(sim_id, user_id):
        raise HTTPException(status_code=404, detail="Symulacja nie znaleziona.")
    return {"ok": True}


# --- Porównanie ---


@router.get("/api/compare")
async def api_compare(ids: str, request: Request):
    user_id = _require_user(request)
    try:
        sim_ids = [int(i) for i in ids.split(",") if i.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Nieprawidłowe identyfikatory.") from None
    if not 1 <= len(sim_ids) <= 4:
        raise HTTPException(
            status_code=400, detail="Porównaj od 1 do 4 symulacji naraz."
        )
    items = []
    for sim_id in sim_ids:
        row = db.get_simulation(sim_id, user_id)
        if not row:
            raise HTTPException(
                status_code=404, detail=f"Symulacja o id {sim_id} nie znaleziona."
            )
        items.append(
            {
                "id": row["id"],
                "name": row["name"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "input": json.loads(row["input_json"]),
                "result": json.loads(row["result_json"]),
                "summary": json.loads(row["summary_json"]),
            }
        )
    return items


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
