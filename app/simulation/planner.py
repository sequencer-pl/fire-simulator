from typing import Literal

from pydantic import BaseModel, Field

from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import (
    AccountConfig,
    SimulationInput,
    SimulationResult,
    StageInput,
)

SAVINGS_ACCOUNTS = ("broker", "lokata", "obligacje", "krypto")

STRATEGY_ROI: dict[str, dict[str, float]] = {
    "konserwatywna": {
        "broker": 0.04,
        "lokata": 0.04,
        "obligacje": 0.045,
        "krypto": 0.02,
        "ike": 0.05,
        "ikze": 0.05,
        "oipe": 0.05,
        "ppk": 0.04,
        "ppe": 0.04,
        "oki_inw": 0.04,
        "oki_osk": 0.03,
    },
    "zbilansowana": {
        "broker": 0.06,
        "lokata": 0.04,
        "obligacje": 0.05,
        "krypto": 0.04,
        "ike": 0.06,
        "ikze": 0.06,
        "oipe": 0.06,
        "ppk": 0.05,
        "ppe": 0.05,
        "oki_inw": 0.05,
        "oki_osk": 0.04,
    },
    "agresywna": {
        "broker": 0.08,
        "lokata": 0.04,
        "obligacje": 0.06,
        "krypto": 0.09,
        "ike": 0.08,
        "ikze": 0.08,
        "oipe": 0.08,
        "ppk": 0.07,
        "ppe": 0.07,
        "oki_inw": 0.06,
        "oki_osk": 0.04,
    },
}

# Preferred funding order of tax-privileged vehicles; the remainder lands in
# the "primary" savings account (broker by default).
TAX_SHELTER_ORDER = ("ikze", "ike", "oipe")
TAX_SHELTER_FLAG = {"ikze": "use_ikze", "ike": "use_ike", "oipe": "use_oipe"}

DEFAULT_PLAN_END = 96  # exclusive — plan covers ages up to 95
DEFAULT_ZUS_ROI = 0.05


class WizardAnswers(BaseModel):
    gender: Literal["k", "m"] = "m"
    age_now: int = Field(default=30, ge=0, le=110)
    employment: Literal["etat", "b2b", "niepracujacy"] = "etat"
    gross_monthly: float = Field(default=0.0, ge=0.0)

    # Current capital per account ("zus:ofe" allowed alongside accounts).
    capital: dict[str, float] = Field(default_factory=dict)

    use_zus: bool = True
    ofe_member: bool = False
    use_ppk: bool = False
    ppk_employee_pct: float = 0.02
    ppk_employer_pct: float = 0.015
    ppk_state_topups: bool = True
    use_ikze: bool = False
    use_ike: bool = False
    use_oipe: bool = False
    use_ppe: bool = False
    ppe_employer_pct: float = 0.07
    use_oki_inw: bool = False
    use_oki_osk: bool = False
    use_krypto: bool = False
    use_lokata: bool = False
    use_obligacje: bool = False

    retire_early_age: int | None = Field(default=None, ge=0, le=110)
    retirement_age: int | None = Field(default=None, ge=0, le=110)
    plan_end_age: int = Field(default=DEFAULT_PLAN_END, ge=1, le=120)

    savings_mode: Literal["amount", "pct"] = "pct"
    savings: float = Field(default=500.0, ge=0.0)

    strategy: Literal["konserwatywna", "zbilansowana", "agresywna"] = "zbilansowana"
    roi_overrides: dict[str, float] = Field(default_factory=dict)
    primary_account: Literal["broker", "lokata", "obligacje"] = "broker"


class WizardPlanRequest(BaseModel):
    path: Literal[1, 2, 3]
    target_monthly: float | None = Field(default=None, ge=0.0)
    answers: WizardAnswers


class PlanProjection(BaseModel):
    met: bool = False
    target_monthly: float | None = None
    min_monthly: float = 0.0
    mean_monthly: float = 0.0
    final_wealth: float = 0.0
    peak_wealth: float = 0.0
    exhaust_age: int | None = None
    warnings: list[str] = Field(default_factory=list)


class PlanSolved(BaseModel):
    savings_monthly: float | None = None
    savings_pct: float | None = None
    retire_early_age: int | None = None
    feasible: bool = True
    note: str = ""


class WizardPlanResult(BaseModel):
    path: int
    input: SimulationInput
    projection: PlanProjection
    solved: PlanSolved


def _retirement_age(a: WizardAnswers, config) -> int:
    """Resolve pension age: explicit answer or ZUS default by gender."""
    if a.retirement_age is not None:
        return a.retirement_age
    return config.zus.wiek_emerytalny_k if a.gender == "k" else config.zus.wiek_emerytalny_m


def _savings_monthly(a: WizardAnswers) -> float:
    if a.savings_mode == "amount":
        return a.savings
    return a.savings / 100.0 * max(0.0, a.gross_monthly)


def _roi(a: WizardAnswers, name: str) -> float:
    if name in a.roi_overrides:
        return a.roi_overrides[name]
    return STRATEGY_ROI[a.strategy].get(name, 0.05)


def _with_basis(name: str) -> bool:
    return name in ("broker", "obligacje", "krypto")


def _alloc_discretionary(a: WizardAnswers, config, annual_pool: float) -> dict[str, float]:
    """Split annual discretionary savings: tax shelters first, remainder → primary."""
    alloc: dict[str, float] = {}
    remaining = annual_pool
    limits = config.limits
    ikze_cap = limits.ikze_annual_self_employed if a.employment == "b2b" else limits.ikze_annual
    caps = {"ikze": ikze_cap, "ike": limits.ike_annual, "oipe": limits.oipe_annual}
    for inst in TAX_SHELTER_ORDER:
        if not getattr(a, TAX_SHELTER_FLAG[inst]):
            continue
        share = min(remaining, caps[inst])
        if share > 0:
            alloc[inst] = share
            remaining -= share
    if remaining > 0:
        alloc[a.primary_account] = alloc.get(a.primary_account, 0.0) + remaining
    return alloc


def _investment_used(a: WizardAnswers, name: str) -> bool:
    if name == "broker":
        return True
    flag = {"lokata": "use_lokata", "obligacje": "use_obligacje", "krypto": "use_krypto"}.get(name)
    return bool(getattr(a, flag)) if flag else bool(getattr(a, "use_" + name, False))


def _account_present(a: WizardAnswers, name: str, alloc: dict[str, float]) -> bool:
    """Account should appear in the accum stage: any capital, funded share or use flag."""
    if a.capital.get(name, 0.0) > 0:
        return True
    if alloc.get(name, 0.0) > 0:
        return True
    return _investment_used(a, name)


def _base_account(a: WizardAnswers, name: str, starting: float, roi) -> dict:
    cfg = {
        "starting_balance": starting,
        "roi": roi,
    }
    if _with_basis(name):
        cfg["cost_basis_enabled"] = True
        cfg["cost_basis"] = starting
    return cfg


def build_stages(a: WizardAnswers) -> SimulationInput:
    config = default_config()
    gross = max(0.0, a.gross_monthly)
    employed = a.employment in ("etat", "b2b") and gross > 0
    retirement = _retirement_age(a, config)
    re = a.retire_early_age if a.retire_early_age is not None else retirement
    re = max(re, a.age_now)
    retirement = max(retirement, re)
    plan_end = max(a.plan_end_age, retirement + 1)
    annual_pool = _savings_monthly(a) * 12.0
    alloc = _alloc_discretionary(a, config, annual_pool)

    stages: list[StageInput] = []
    accum_accounts: dict[str, AccountConfig] = {}

    inv_names = [
        n
        for n in SAVINGS_ACCOUNTS + ("ike", "ikze", "oipe", "oki_inw", "oki_osk")
        if _account_present(a, n, alloc)
    ]

    # --- Stage A: accumulation while working (from today until FIRE) ---
    if a.age_now < re and employed:
        for name in inv_names:
            starting = a.capital.get(name, 0.0)
            contrib = alloc.get(name, 0.0)
            cfg = _base_account(a, name, starting, _roi(a, name))
            cfg["annual_contribution"] = contrib
            if name == "ikze":
                cfg["ikze_limit"] = "self_employed" if a.employment == "b2b" else "etat"
                cfg["monthly_base"] = gross
            accum_accounts[name] = AccountConfig(**cfg)
        if a.capital.get("gotowka", 0.0) > 0:
            accum_accounts["gotowka"] = AccountConfig(
                starting_balance=a.capital["gotowka"], roi=0.0
            )
        if a.use_ppk:
            accum_accounts["ppk"] = AccountConfig(
                starting_balance=a.capital.get("ppk", 0.0),
                monthly_base=gross,
                employee_pct=a.ppk_employee_pct,
                employer_pct=a.ppk_employer_pct,
                state_topups=a.ppk_state_topups,
                roi=_roi(a, "ppk"),
            )
        if a.use_ppe:
            accum_accounts["ppe"] = AccountConfig(
                starting_balance=a.capital.get("ppe", 0.0),
                monthly_base=gross,
                employer_pct=a.ppe_employer_pct,
                annual_contribution=0.0,
                roi=_roi(a, "ppe"),
            )
        if a.use_zus:
            accum_accounts["zus"] = AccountConfig(
                starting_balance=a.capital.get("zus", 0.0),
                starting_balance_ofe=a.capital.get("zus:ofe", 0.0),
                ofe_member=a.ofe_member,
                monthly_base=gross,
                roi=DEFAULT_ZUS_ROI,
            )
        if accum_accounts:
            stages.append(
                StageInput(
                    stage_type="akumulacja",
                    name="Akumulacja do emerytury",
                    start_age=a.age_now,
                    end_age=re,
                    accounts=accum_accounts,
                )
            )

    # --- Stage B: bridging accumulation (FIRE → pension age, no more ZUS/PPK) ---
    if re < retirement:
        bridge: dict[str, AccountConfig] = {}
        for name in inv_names:
            cfg = _base_account(a, name, a.capital.get(name, 0.0), _roi(a, name))
            cfg["annual_contribution"] = 0.0
            if name == "ikze":
                cfg["ikze_limit"] = "self_employed" if a.employment == "b2b" else "etat"
            bridge[name] = AccountConfig(**cfg)
        if a.capital.get("gotowka", 0.0) > 0:
            bridge["gotowka"] = AccountConfig(starting_balance=a.capital["gotowka"], roi=0.0)
        stages.append(
            StageInput(
                stage_type="akumulacja",
                name="Brydż do emerytury",
                start_age=re,
                end_age=retirement,
                accounts=bridge or {},
            )
        )

    # --- Stage C: realization (annuitet) from pension age until plan end ---
    real_accounts: dict[str, AccountConfig] = {}

    def _has_capital(name: str) -> bool:
        if name in accum_accounts or name in a.capital:
            return True
        return name in ("ppk", "ppe", "zus") and getattr(a, "use_" + name, False)

    for name in SAVINGS_ACCOUNTS + (
        "ike",
        "ikze",
        "oipe",
        "oki_inw",
        "oki_osk",
        "gotowka",
        "ppk",
        "ppe",
        "zus",
    ):
        if not _has_capital(name):
            continue
        if name == "zus":
            real_accounts["zus"] = AccountConfig(
                starting_balance=a.capital.get("zus", 0.0),
                starting_balance_ofe=a.capital.get("zus:ofe", 0.0),
                ofe_member=a.ofe_member,
                roi=0.0,
                buffer=0.0,
                waloryzacja_swiadczenia=None,
            )
        else:
            real_accounts[name] = AccountConfig(
                starting_balance=a.capital.get(name, 0.0),
                roi=_roi(a, name),
                buffer=0.0,
            )

    stages.append(
        StageInput(
            stage_type="realizacja",
            name="Realizacja (emerytura)",
            start_age=retirement,
            end_age=plan_end,
            accounts=real_accounts,
        )
    )

    return SimulationInput(
        stages=stages,
        max_age=plan_end - 1,
        gender=a.gender,
        monthly_gross=gross,
        config=config,
    )


def _realization_window(data: SimulationInput) -> tuple[int, int]:
    for s in data.stages:
        if s.stage_type == "realizacja":
            return s.start_age, s.end_age
    return 0, 0


def _project(
    data: SimulationInput, result: SimulationResult, target: float | None
) -> PlanProjection:
    start, end = _realization_window(data)
    months = [
        (year.age, year.monthly_withdrawal) for year in result.years if start <= year.age < end
    ]
    values = [m for _, m in months]
    min_m = min(values) if values else 0.0
    mean_m = sum(values) / len(values) if values else 0.0
    exhaust = None
    if target:
        for age, m in months:
            if m < target - 1e-9:
                exhaust = age
                break
    return PlanProjection(
        met=target is None or exhaust is None,
        target_monthly=target,
        min_monthly=round(min_m, 2),
        mean_monthly=round(mean_m, 2),
        final_wealth=round(result.final_wealth, 2),
        peak_wealth=round(result.peak_wealth, 2),
        exhaust_age=exhaust,
        warnings=result.warnings,
    )


def _evaluate(data: SimulationInput, target: float | None) -> PlanProjection:
    return _project(data, simulate(data), target)


def _vary_savings(a: WizardAnswers, amount: float) -> SimulationInput:
    na = a.model_copy(deep=True)
    na.savings = amount
    na.savings_mode = "amount"
    return build_stages(na)


def _vary_re(a: WizardAnswers, re: int) -> SimulationInput:
    na = a.model_copy(deep=True)
    na.retire_early_age = re
    return build_stages(na)


def _solve_savings(a: WizardAnswers, target: float) -> tuple[float, bool]:
    """Minimum monthly savings whose projected payout meets target (bisection).

    Upper bound is capped at gross salary — you cannot save more than you earn.
    """
    lo = 0.0
    hi = max(1.0, a.gross_monthly)
    if _evaluate(_vary_savings(a, hi), target).min_monthly < target:
        return hi, False
    if _evaluate(_vary_savings(a, lo), target).min_monthly >= target:
        return 0.0, True
    for _ in range(40):
        mid = (lo + hi) / 2.0
        if _evaluate(_vary_savings(a, mid), target).min_monthly >= target:
            hi = mid
        else:
            lo = mid
    return hi, True


def _solve_re(a: WizardAnswers, target: float) -> tuple[int | None, bool]:
    """Earliest FIRE age whose projected payout meets target (binary search)."""
    retirement = _retirement_age(a, default_config())
    low = a.age_now + 1
    high = max(retirement, low)
    if _evaluate(_vary_re(a, high), target).min_monthly < target:
        return None, False
    while low < high:
        mid = (low + high) // 2
        if _evaluate(_vary_re(a, mid), target).min_monthly >= target:
            high = mid
        else:
            low = mid + 1
    return low, True


def plan(path: int, a: WizardAnswers, target: float | None = None) -> WizardPlanResult:
    if path == 1:
        data = build_stages(a)
        return WizardPlanResult(
            path=1,
            input=data,
            projection=_evaluate(data, None),
            solved=PlanSolved(feasible=True),
        )

    if target is None or target <= 0:
        raise ValueError("target_monthly jest wymagany dla tej ścieżki.")

    if a.gross_monthly <= 0 or a.employment == "niepracujacy":
        raise ValueError("Brak dochodów — nie da się wyznaczyć oszczędności.")

    if path == 2:
        amount, feasible = _solve_savings(a, target)
        data = _vary_savings(a, amount)
        proj = _evaluate(data, target)
        pct = None
        if a.savings_mode == "pct" and a.gross_monthly > 0:
            pct = round(amount / a.gross_monthly * 100.0, 1)
        note = ""
        if not feasible:
            note = (
                "Cel wypłaty nieosiągalny nawet przy bardzo wysokiej skali "
                "oszczędności — rozważ późniejsze FIRE, niższą wypłatę lub "
                "bardziej agresywną strategię."
            )
        return WizardPlanResult(
            path=2,
            input=data,
            projection=proj,
            solved=PlanSolved(
                savings_monthly=round(amount),
                savings_pct=pct,
                feasible=feasible,
                note=note,
            ),
        )

    re, feasible = _solve_re(a, target)
    if re is None:
        data = build_stages(a)
        note = (
            "Nie znaleziono wieku FIRE spełniającego cel wypłaty — także przy "
            "pracy do pełnego wieku emerytalnego. Rozważ niższą wypłatę, "
            "większe oszczędności lub agresywniejszą strategię."
        )
        return WizardPlanResult(
            path=3,
            input=data,
            projection=_evaluate(data, target),
            solved=PlanSolved(feasible=False, note=note),
        )
    data = _vary_re(a, re)
    return WizardPlanResult(
        path=3,
        input=data,
        projection=_evaluate(data, target),
        solved=PlanSolved(
            retire_early_age=re,
            feasible=feasible,
            note=(
                f"Najwcześniejszy wiek FIRE z gwarancją wypłaty {target:,.0f} zł/mies. to {re} lat."
                if re <= _retirement_age(a, default_config())
                else f"Wiek FIRE {re} lat (z pełnym wiekiem emerytalnym lub wcześniej)."
            ),
        ),
    )
