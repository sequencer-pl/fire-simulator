import json
import os
import sqlite3
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError

from app.core.base import resolve_base
from app.simulation.config import (
    ACCOUNT_LABELS,
    BUILTIN_PRESETS,
    TaxConfig,
    account_display_label,
    base_account_key,
    default_config,
)
from app.simulation.engine import simulate
from app.simulation.planner import (
    SalaryPreviewRequest,
    WizardAnswers,
    WizardPlanRequest,
    WizardSuggestRequest,
    estimate_pool_monthly,
    plan,
    resolve_config,
    suggest_allocations,
)
from app.simulation.salary import salary_preview
from app.simulation.schemas import SimulationInput, SimulationResult
from app.stages.metadata import STAGE_META
from app.stages.registry import get_all_stage_types
from app.storage import db
from app.web.limits import check_limit

router = APIRouter()
BASE_DIR = Path(__file__).resolve().parents[2]
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

STATIC_DIR = BASE_DIR / "static"


def _asset_version_uncached() -> str:
    """Static asset version based on mtime — forces cache refresh after file changes."""
    mtimes = [
        os.path.getmtime(STATIC_DIR / rel)
        for rel in (
            "css/style.css",
            "js/sim-utils.js",
            "js/sim-metadata.js",
            "js/sim-cards.js",
            "js/sim-stages.js",
            "js/simulator.js",
            "js/wizard.js",
            "css/wizard.css",
            "js/session.js",
            "js/common.js",
            "js/simulations.js",
            "js/landing.js",
            "js/compare.js",
        )
        if (STATIC_DIR / rel).exists()
    ]
    return str(int(max(mtimes))) if mtimes else "0"


@lru_cache(maxsize=1)
def _asset_version() -> str:
    return _asset_version_uncached()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _current_user_id(request: Request) -> int | None:
    return request.session.get("user_id")


def _require_user(request: Request) -> int:
    user_id = _current_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Zaloguj się, aby kontynuować.")
    return user_id


def _user_tax_config(request: Request) -> TaxConfig | None:
    """Saved config for the current user, or None for anonymous/legacy users."""
    user_id = _current_user_id(request)
    if not user_id:
        return None
    saved = db.get_user_config(user_id)
    if not saved:
        return None
    try:
        payload = json.loads(saved)
        if isinstance(payload, dict) and "config" in payload:
            payload = payload["config"]
        return TaxConfig.model_validate(payload)
    except (json.JSONDecodeError, TypeError, ValidationError):
        return None


def _wizard_answers(request: Request, answers: WizardAnswers) -> WizardAnswers:
    """Server config wins for logged-in users; anonymous clients may send theirs."""
    if _current_user_id(request):
        return answers.model_copy(update={"base_config": _user_tax_config(request)})
    return answers


def _summary_from_result(result: SimulationResult) -> dict:
    years = result.years
    return {
        "final_wealth": result.final_wealth,
        "final_wealth_net": result.final_wealth_net,
        "exit_tax": result.exit_tax,
        "total_tax_refund": result.total_tax_refund,
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
        base_name = base_account_key(name)
        if base_name in ("gotowka", "zus"):
            continue
        elif base_name == "ppk":
            total_annual += cfg.employee_pct * resolve_base(cfg.model_dump(), monthly_gross) * 12
        elif base_name == "ppe":
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
            base_name = base_account_key(name)
            if base_name in ("gotowka", "zus"):
                continue
            if base_name == "ppk":
                base_annual = resolve_base(cfg.model_dump(), input_data.monthly_gross) * 12
                total += cfg.employee_pct * base_annual * years
            elif base_name == "ppe":
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
        for key, cfg in stage.accounts.items():
            if cfg.custom_name and cfg.custom_name.strip():
                acc_label = cfg.custom_name.strip()
            else:
                base_key = base_account_key(key)
                acc_label = (
                    meta.get("available_accounts", {}).get(key, {}).get("label")
                    or account_display_label(key)
                    or meta.get("available_accounts", {}).get(base_key, {}).get("label", key)
                )
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
        "model_version": row["model_version"],
        "summary": json.loads(row["summary_json"]),
    }


# --- Views ---


@router.get("/", response_class=HTMLResponse)
async def landing(request: Request):
    return templates.TemplateResponse(
        request,
        "landing.html",
        {
            "version": _asset_version(),
        },
    )


@router.get("/moje-symulacje", response_class=HTMLResponse)
async def simulations(request: Request):
    return templates.TemplateResponse(
        request,
        "simulations.html",
        {
            "version": _asset_version(),
        },
    )


@router.get("/login", response_class=HTMLResponse)
async def login(request: Request):
    return templates.TemplateResponse(
        request,
        "login.html",
        {
            "version": _asset_version(),
        },
    )


@router.get("/sim", response_class=HTMLResponse)
async def sim(request: Request):
    return templates.TemplateResponse(
        request,
        "simulator.html",
        {
            "version": _asset_version(),
            "stage_types": get_all_stage_types(),
        },
    )


@router.get("/compare", response_class=HTMLResponse)
async def compare(request: Request):
    return templates.TemplateResponse(
        request,
        "compare.html",
        {
            "version": _asset_version(),
        },
    )


@router.get("/wizard", response_class=HTMLResponse)
async def wizard(request: Request):
    return templates.TemplateResponse(
        request,
        "wizard.html",
        {
            "version": _asset_version(),
            "stage_types": get_all_stage_types(),
        },
    )


# --- Simulation API (existing) ---


@router.post("/api/wizard/plan")
def api_wizard_plan(body: WizardPlanRequest, request: Request):
    check_limit("wizard_plan", request)
    try:
        answers = _wizard_answers(request, body.answers)
        return plan(body.path, answers, body.target_monthly)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/wizard/suggest")
def api_wizard_suggest(body: WizardSuggestRequest, request: Request):
    check_limit("wizard_suggest", request)
    try:
        answers = _wizard_answers(request, body.answers)
        pool_monthly = estimate_pool_monthly(
            answers, body.path, body.target_monthly
        )
        pool = pool_monthly * 12.0
        return {
            "allocations": suggest_allocations(answers, resolve_config(answers), pool),
            "pool_monthly": round(pool_monthly, 2),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/wizard/salary")
def api_wizard_salary(body: SalaryPreviewRequest, request: Request):
    check_limit("wizard_salary", request)
    ppk_pct = body.ppk_employee_pct if body.use_ppk else 0.0
    if _current_user_id(request):
        config = _user_tax_config(request) or default_config()
    else:
        config = body.base_config or default_config()
    gross, net = salary_preview(
        body.amount,
        body.salary_mode,
        body.employment,
        config,
        ppk_pct=ppk_pct,
    )
    return {
        "gross_monthly": round(gross, 2),
        "net_monthly": round(net, 2) if net is not None else None,
    }


@router.post("/api/simulate")
def api_simulate(input_data: SimulationInput, request: Request):
    check_limit("simulate", request)
    try:
        result = simulate(input_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return result


@router.get("/api/stage-types")
async def api_stage_types():
    return get_all_stage_types()


@router.get("/api/metadata")
async def api_metadata():
    return {"account_labels": ACCOUNT_LABELS, "builtin_presets": list(BUILTIN_PRESETS.keys())}


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
    payload = json.loads(saved)
    if isinstance(payload, dict) and "config" in payload and "baseline" in payload:
        return payload
    return {
        "config": payload,
        "baseline": None,
        "preset_id": None,
        "preset_name": "Własna konfiguracja",
        "overrides": [],
    }


def _validate_tax_config(body: dict) -> TaxConfig:
    try:
        cfg = TaxConfig.model_validate(body)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Nieprawidłowa konfiguracja.") from None
    if cfg.prog2 is not None:
        if cfg.rate_middle is None:
            raise HTTPException(
                status_code=422, detail="rate_middle wymagane gdy prog2 jest ustawione"
            )
        if cfg.prog2 <= cfg.prog:
            raise HTTPException(status_code=422, detail="prog2 musi być większe od prog")
        if not 0 <= cfg.rate_middle <= 1:
            raise HTTPException(status_code=422, detail="rate_middle musi być w [0, 1]")
    return cfg


@router.put("/api/config/user")
async def api_save_user_config(request: Request):
    user_id = _require_user(request)
    body = await request.json()
    if isinstance(body, dict) and "config" in body and "baseline" in body:
        config = body["config"]
        baseline = body["baseline"]
        _validate_tax_config(config)
        _validate_tax_config(baseline)
        overrides = body.get("overrides", [])
        preset_id = body.get("preset_id")
        preset_name = body.get("preset_name", "Własna konfiguracja")
        if not isinstance(overrides, list) or not all(isinstance(path, str) for path in overrides):
            raise HTTPException(
                status_code=422,
                detail="overrides musi być listą ścieżek konfiguracji",
            )
        if preset_id is not None and not isinstance(preset_id, int):
            raise HTTPException(status_code=422, detail="preset_id musi być liczbą lub null")
        if not isinstance(preset_name, str):
            raise HTTPException(status_code=422, detail="preset_name musi być tekstem")
        payload = {
            "config": config,
            "baseline": baseline,
            "preset_id": preset_id,
            "preset_name": preset_name[:100],
            "overrides": overrides,
        }
    else:
        _validate_tax_config(body)
        payload = body
    db.save_user_config(user_id, json.dumps(payload, separators=(",", ":")), _now())
    return {"ok": True}


@router.delete("/api/config/user")
async def api_delete_user_config(request: Request):
    user_id = _require_user(request)
    db.delete_user_config(user_id)
    return {"ok": True}


# --- Presets ---


@router.get("/api/presets")
async def api_list_presets(request: Request):
    user_id = _current_user_id(request)
    result: list[dict] = []

    for name in BUILTIN_PRESETS:
        result.append({"id": None, "name": name, "is_builtin": True})

    if user_id is not None:
        for row in db.list_user_presets(user_id):
            result.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "is_builtin": False,
                }
            )

    return {"presets": result}


@router.get("/api/presets/{preset_id}")
async def api_get_preset(preset_id: int, request: Request):
    user_id = _require_user(request)
    row = db.get_preset(preset_id, user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"config": json.loads(row["config_json"])}


@router.post("/api/presets")
async def api_create_preset(request: Request):
    user_id = _require_user(request)
    data = await request.json()
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if len(name) > 100:
        raise HTTPException(status_code=400, detail="Name too long (max 100)")
    if name in BUILTIN_PRESETS:
        raise HTTPException(status_code=400, detail="Cannot overwrite builtin preset")
    config = data.get("config")
    if config is None:
        raise HTTPException(status_code=400, detail="Config required")
    _validate_tax_config(config)
    now = datetime.now(UTC).isoformat()
    try:
        preset_id = db.save_preset(user_id, name, json.dumps(config), now)
    except sqlite3.IntegrityError as e:
        if "UNIQUE" in str(e):
            raise HTTPException(
                status_code=409, detail="Preset with this name already exists"
            ) from e
        raise
    return {"id": preset_id, "name": name, "is_builtin": False}


@router.delete("/api/presets/{preset_id}")
async def api_delete_preset(preset_id: int, request: Request):
    user_id = _require_user(request)
    if not db.delete_preset(preset_id, user_id):
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"ok": True}
