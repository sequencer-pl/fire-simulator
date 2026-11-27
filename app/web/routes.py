import os
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from app.core.base import resolve_base
from app.simulation.config import (
    ACCOUNT_LABELS,
    BUILTIN_PRESET_YEARS,
    account_display_label,
    base_account_key,
    default_config,
)
from app.simulation.engine import simulate
from app.simulation.optimizer import (
    WizardOptimizeRequest,
    optimize_plan,
    plan_optimized,
)
from app.simulation.planner import (
    SalaryPreviewRequest,
    WizardPlanRequest,
    WizardSuggestRequest,
    allocation_asset_mix,
    build_projection,
    estimate_pool_monthly,
    plan,
    resolve_config,
    suggest_allocation_plan,
    suggest_allocations,
    suggest_priority,
)
from app.simulation.salary import salary_preview
from app.simulation.schemas import SimulationInput, SimulationResult
from app.simulation.summary import build_summary
from app.stages.metadata import STAGE_META
from app.stages.registry import get_all_stage_types
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
            "css/base.css",
            "css/components.css",
            "css/results.css",
            "css/landing.css",
            "css/wizard.css",
            "css/library.css",
            "css/sim.css",
            "js/sim-utils.js",
            "js/results-model.js",
            "js/results-metrics.js",
            "js/results-banners.js",
            "js/results-view.js",
            "js/results-summary.js",
            "js/results-charts.js",
            "js/results-plan-time.js",
            "js/results-table.js",
            "js/sim-metadata.js",
            "js/sim-cards.js",
            "js/sim-stages.js",
            "js/simulator.js",
            "js/wizard.js",
            "js/compare.js",
        )
        if (STATIC_DIR / rel).exists()
    ]
    return str(int(max(mtimes))) if mtimes else "0"


@lru_cache(maxsize=1)
def _asset_version() -> str:
    return _asset_version_uncached()


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


def _stage_display_name(name: str) -> str:
    for marker in (" (z zobowiązaniem)", " (po zobowiązaniu"):
        if marker in name:
            return name.split(marker, 1)[0]
    return name


def _stages_summary(
    input_data: SimulationInput, result: SimulationResult | None = None
) -> list[dict]:
    years_by_age = {y.age: y for y in result.years} if result else {}
    groups: dict[str, list] = {}
    order: list[str] = []
    for index, stage in enumerate(input_data.stages):
        key = stage.origin_stage_id or f"solo-{index}"
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(stage)

    stages = []
    for key in order:
        group = groups[key]
        first = group[0]
        meta = STAGE_META.get(first.stage_type, {})
        accounts = []
        seen_accounts: set[str] = set()
        for stage in group:
            for account, cfg in stage.accounts.items():
                if cfg.custom_name and cfg.custom_name.strip():
                    acc_label = cfg.custom_name.strip()
                else:
                    base_key = base_account_key(account)
                    acc_label = (
                        meta.get("available_accounts", {}).get(account, {}).get("label")
                        or account_display_label(account)
                        or meta.get("available_accounts", {})
                        .get(base_key, {})
                        .get("label", account)
                    )
                if acc_label not in seen_accounts:
                    seen_accounts.add(acc_label)
                    accounts.append(acc_label)
        start_age = min(stage.start_age for stage in group)
        end_age = max(stage.end_age for stage in group)
        info = {
            "label": meta.get("label", first.stage_type),
            "name": _stage_display_name(first.name),
            "start_age": start_age,
            "end_age": end_age,
            "accounts": accounts,
        }
        if first.stage_type == "realizacja" and years_by_age:
            withdrawals = [
                years_by_age[a].monthly_withdrawal
                for a in range(start_age, end_age)
                if a in years_by_age and years_by_age[a].monthly_withdrawal > 0
            ]
            if withdrawals:
                info["avg_monthly_withdrawal"] = round(
                    sum(withdrawals) / len(withdrawals), 2
                )
        elif first.stage_type == "akumulacja":
            duration = max(0, end_age - start_age)
            weighted = 0.0
            for stage in group:
                monthly = _monthly_contribution(stage, input_data.monthly_gross)
                if monthly is not None:
                    weighted += monthly * max(0, stage.end_age - stage.start_age)
            if duration > 0 and weighted > 0:
                info["monthly_contribution"] = round(weighted / duration, 2)
        stages.append(info)
    return stages


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


@router.get("/moje-symulacje")
@router.get("/login")
async def legacy_library_routes():
    """Stare wejścia do biblioteki/logowania prowadzą do Porównywarki."""
    return RedirectResponse("/compare", status_code=308)


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
    """Jedyny Asystent FIRE — prowadzi przez drzewo krótkich pytań."""
    return templates.TemplateResponse(
        request,
        "wizard.html",
        {
            "version": _asset_version(),
            "stage_types": get_all_stage_types(),
        },
    )


@router.get("/wizard-v1")
@router.get("/wizard-v2")
async def wizard_legacy():
    """Stare adresy Asystenta prowadzą do jedynej wersji."""
    return RedirectResponse("/wizard", status_code=308)


# --- Simulation API (existing) ---


@router.post("/api/wizard/plan")
def api_wizard_plan(body: WizardPlanRequest, request: Request):
    check_limit("wizard_plan", request)
    try:
        if body.optimize and body.path == 1:
            return plan_optimized(
                body.path, body.answers, body.target_monthly
            )
        return plan(body.path, body.answers, body.target_monthly)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/wizard/optimize")
def api_wizard_optimize(body: WizardOptimizeRequest, request: Request):
    check_limit("wizard_optimize", request)
    try:
        return optimize_plan(
            body.answers,
            objective=body.objective,
            bequest=body.bequest_target,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/wizard/suggest")
def api_wizard_suggest(body: WizardSuggestRequest, request: Request):
    check_limit("wizard_suggest", request)
    try:
        answers = body.answers
        pool_monthly = estimate_pool_monthly(
            answers, body.path, body.target_monthly
        )
        pool = pool_monthly * 12.0
        config = resolve_config(answers)
        allocations, wrapper_vehicles = suggest_allocation_plan(answers, config, pool)
        mix_answers = answers.model_copy(
            update={"wrapper_vehicles": wrapper_vehicles}, deep=True
        )
        strategy_previews = {
            strategy: suggest_allocations(
                answers.model_copy(update={"strategy": strategy}), config, pool
            )
            for strategy in ("konserwatywna", "zbilansowana", "agresywna")
        }
        strategy_priorities = {
            strategy: suggest_priority(
                answers.model_copy(update={"strategy": strategy}), config
            )
            for strategy in ("konserwatywna", "zbilansowana", "agresywna")
        }
        return {
            "allocations": allocations,
            "wrapper_vehicles": wrapper_vehicles,
            "asset_mix": allocation_asset_mix(mix_answers, config, allocations),
            "pool_monthly": round(pool_monthly, 2),
            "strategy_previews": strategy_previews,
            "strategy_priorities": strategy_priorities,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/wizard/salary")
def api_wizard_salary(body: SalaryPreviewRequest, request: Request):
    check_limit("wizard_salary", request)
    ppk_pct = body.ppk_employee_pct if body.use_ppk else 0.0
    config = body.base_config or default_config()
    gross, net = salary_preview(
        body.amount,
        body.salary_mode,
        body.employment,
        config,
        ppk_pct=ppk_pct,
        b2b_tax_form=body.b2b_tax_form,
        b2b_lump_rate=body.b2b_lump_rate,
        b2b_zus_mode=body.b2b_zus_mode,
        b2b_custom_zus_base=body.b2b_custom_zus_base,
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
    payload = result.model_dump()
    payload["summary"] = build_summary(input_data, result).model_dump()
    payload["projection"] = build_projection(input_data, result).model_dump()
    return payload


@router.get("/api/stage-types")
async def api_stage_types():
    return get_all_stage_types()


@router.get("/api/metadata")
async def api_metadata():
    return {"account_labels": ACCOUNT_LABELS, "builtin_presets": list(BUILTIN_PRESET_YEARS.keys())}


@router.get("/api/config")
async def api_config():
    return default_config().model_dump()


@router.get("/api/presets")
async def api_presets():
    return {
        name: default_config(year).model_dump()
        for name, year in BUILTIN_PRESET_YEARS.items()
    }




# --- Porównywarka JSON (stateless) ---


class CompareEvaluateItem(BaseModel):
    name: str = Field(default="Symulacja z pliku", min_length=1, max_length=200)
    input: SimulationInput


class CompareEvaluatePayload(BaseModel):
    items: list[CompareEvaluateItem] = Field(min_length=1, max_length=4)


@router.post("/api/compare/evaluate")
def api_compare_evaluate(payload: CompareEvaluatePayload, request: Request):
    check_limit("simulate", request)
    items = []
    for idx, item in enumerate(payload.items, start=1):
        try:
            result = simulate(item.input)
        except ValueError as e:
            raise HTTPException(
                status_code=400, detail=f"{item.name}: {e}"
            ) from e
        summary = build_summary(item.input, result).model_dump()
        summary["warnings"] = summary["warnings_count"]
        summary["stages"] = _stages_summary(item.input, result)
        items.append(
            {
                "id": None,
                "name": item.name.strip() or f"Plik JSON #{idx}",
                "created_at": None,
                "updated_at": None,
                "from_json": True,
                "input": item.input.model_dump(mode="json"),
                "result": result.model_dump(mode="json"),
                "summary": summary,
            }
        )
    return items
