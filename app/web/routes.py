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
    BUILTIN_PRESETS,
    account_display_label,
    base_account_key,
    default_config,
)
from app.simulation.engine import simulate
from app.simulation.planner import (
    SalaryPreviewRequest,
    WizardPlanRequest,
    WizardSuggestRequest,
    estimate_pool_monthly,
    plan,
    resolve_config,
    suggest_allocations,
    suggest_priority,
)
from app.simulation.salary import salary_preview
from app.simulation.schemas import SimulationInput, SimulationResult
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
            "css/wizard.css",
            "css/library.css",
            "css/sim.css",
            "js/sim-utils.js",
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
        return plan(body.path, body.answers, body.target_monthly)
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
            "allocations": suggest_allocations(answers, config, pool),
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
        summary = _summary_from_result(result)
        summary["stages"] = _stages_summary(item.input, result)
        summary["total_user_contributions"] = _total_user_contributions(item.input)
        summary["initial_capital"] = _initial_capital(item.input)
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
