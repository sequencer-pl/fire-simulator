import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput
from app.storage import db

from .routes import (
    _initial_capital,
    _now,
    _require_user,
    _simulation_response,
    _stages_summary,
    _summary_from_result,
    _total_user_contributions,
)

router = APIRouter()


class SaveSimulationPayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    input: SimulationInput


class RenamePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class DeleteBulkPayload(BaseModel):
    ids: list[int]


@router.post("/api/simulations")
async def api_save_simulation(payload: SaveSimulationPayload, request: Request):
    user_id = _require_user(request)
    try:
        result = simulate(payload.input)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    now = _now()
    summary = _summary_from_result(result)
    summary["stages"] = _stages_summary(payload.input, result)
    summary["total_user_contributions"] = _total_user_contributions(payload.input)
    summary["initial_capital"] = _initial_capital(payload.input)
    sim_id = db.insert_simulation(
        user_id=user_id,
        name=payload.name.strip(),
        created_at=now,
        input_json=json.dumps(payload.input.model_dump(mode="json")),
        result_json=json.dumps(result.model_dump(mode="json")),
        summary_json=json.dumps(summary),
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


@router.post("/api/simulations/delete-bulk")
async def api_delete_simulations_bulk(payload: DeleteBulkPayload, request: Request):
    user_id = _require_user(request)
    if not payload.ids:
        raise HTTPException(status_code=400, detail="Podaj identyfikatory.")
    deleted = 0
    for sim_id in payload.ids:
        if db.delete_simulation(sim_id, user_id):
            deleted += 1
    return {"ok": True, "deleted": deleted}


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
