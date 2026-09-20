from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.simulation.config import default_config
from app.simulation.engine import simulate
from app.simulation.schemas import (
    AccountConfig,
    SimulationInput,
    SimulationResult,
    StageInput,
)

SAVINGS_ACCOUNTS = ("broker", "lokata", "obligacje", "krypto")

# Curated preference order used to open NEW accounts the user lacks. Capacity
# logic (suggest_allocations) absorbs the annual pool account by account in this
# order and only opens the next one when the previous hits its annual limit.
STRATEGY_SUGGEST: dict[str, tuple[str, ...]] = {
    "konserwatywna": ("obligacje", "ikze", "ike", "oki_osk", "oki_inw"),
    "zbilansowana": ("ike", "ikze", "oki_inw", "obligacje", "broker"),
    "agresywna": ("ike", "ikze", "oipe", "broker", "krypto"),
}

# Accounts with statutory annual contribution caps (limits in config.limits).
TAX_SHELTER_ACCOUNTS = ("ike", "ikze", "oipe")

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

# Preferred funding order of tax-privileged vehicles. Funds NOT assigned by the
# user (or overflowing annual limits below) stay in "gotowka" — the visible,
# worst-case (real −inflation) sink.
TAX_SHELTER_ORDER = ("ikze", "ike", "oipe")
TAX_SHELTER_FLAG = {"ikze": "use_ikze", "ike": "use_ike", "oipe": "use_oipe"}

# Accounts a user can assign a monthly-savings share to. "gotowka" is never
# here — it is the implicit reservoir for leftovers. Payroll/employer vehicles
# (ZUS, PPK, PPE) cannot receive discretionary savings.
ALLOCATABLE_ACCOUNTS = (
    "broker",
    "ikze",
    "ike",
    "oipe",
    "oki_inw",
    "oki_osk",
    "krypto",
    "lokata",
    "obligacje",
)

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
    use_broker: bool = False

    retire_early_age: int | None = Field(default=None, ge=0, le=110)
    retirement_age: int | None = Field(default=None, ge=0, le=110)
    plan_end_age: int = Field(default=DEFAULT_PLAN_END, ge=1, le=120)

    savings_mode: Literal["amount", "pct"] = "pct"
    savings: float = Field(default=500.0, ge=0.0)

    strategy: Literal["konserwatywna", "zbilansowana", "agresywna"] = "zbilansowana"
    roi_overrides: dict[str, float] = Field(default_factory=dict)

    # Monthly-savings shares (%) per allocatable account. Money NOT assigned
    # here (or exceeding a shelter's annual limit) lands in "gotowka".
    allocations: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_allocations(self) -> "WizardAnswers":
        share_sum = 0.0
        for name, weight in self.allocations.items():
            if name not in ALLOCATABLE_ACCOUNTS:
                raise ValueError(f"Nieznane konto w podziale oszczędności: {name}")
            if weight < 0:
                raise ValueError(f"Udział {name} nie może być ujemny.")
            share_sum += weight
        if share_sum > 100 + 1e-6:
            raise ValueError("Suma udziałów przekracza 100%.")
        return self


class WizardPlanRequest(BaseModel):
    path: Literal[1, 2, 3]
    target_monthly: float | None = Field(default=None, ge=0.0)
    answers: WizardAnswers


class WizardSuggestRequest(BaseModel):
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


def _shelter_cap(a: WizardAnswers, config, name: str) -> float:
    limits = config.limits
    if name == "ikze":
        return limits.ikze_annual_self_employed if a.employment == "b2b" else limits.ikze_annual
    if name == "ike":
        return limits.ike_annual
    if name == "oipe":
        return limits.oipe_annual
    return 0.0


def _resolve_allocation(a: WizardAnswers, config, annual_pool: float) -> dict[str, float]:
    """Split the discretionary pool by user weights; shelters cap at annual
    limits; whatever is not assigned stays in "gotowka" (the visible sink).
    """
    alloc: dict[str, float] = {}
    used = 0.0
    for inst, weight in a.allocations.items():
        target = annual_pool * weight / 100.0
        cap = _shelter_cap(a, config, inst)
        contrib = min(target, cap) if cap else target
        if contrib > 1e-6:
            alloc[inst] = round(contrib, 2)
            used += contrib
    overflow = max(0.0, annual_pool - used)
    if overflow > 1e-6:
        alloc["gotowka"] = round(overflow, 2)
    return alloc


def _suggest_order(a: WizardAnswers, active: set[str]) -> list[str]:
    """Priority order for absorbing the annual pool: first the tax-sheltered
    accounts the user already holds (in the strategy preference order, then any
    remaining shelters), then curated "magic" accounts the user lacks, and only
    then the user's other active accounts. The pool walks this order up to the
    accounts' annual caps, so few accounts are opened when the pool is small."""
    pref = STRATEGY_SUGGEST[a.strategy]
    preferred = [n for n in pref if n in TAX_SHELTER_ACCOUNTS and n in active]
    preferred += [n for n in TAX_SHELTER_ACCOUNTS if n in active and n not in preferred]
    curated = [n for n in pref if n not in active]
    rest = [n for n in ALLOCATABLE_ACCOUNTS if n in active and n not in preferred]
    return preferred + curated + rest


def suggest_allocations(a: WizardAnswers, config, annual_pool: float) -> dict[str, float]:
    """Auto % split by annual capacity: accounts absorb the pool in priority
    order, each up to its annual contribution limit (unlimited accounts take the
    remainder). Opening the next account only happens when the previous one is
    full, so a small pool lands in a single account. Shares == pool absorption,
    hence 100% in total with no fall-through to "gotowka"."""
    if annual_pool <= 0:
        return {}
    # Active = participation flag OR existing capital — an account the user
    # already holds money in is a valid target for future savings even without
    # an explicit "use_*" checkbox (wizard auto-checks on any non-zero balance).
    active = {n for n in ALLOCATABLE_ACCOUNTS if _account_present(a, n, {})}
    remaining = annual_pool
    shares: dict[str, float] = {}
    for name in _suggest_order(a, active):
        if remaining <= 0:
            break
        cap = _shelter_cap(a, config, name)
        take = min(remaining, cap) if cap else remaining
        if take > 1e-6:
            shares[name] = take
            remaining -= take
    if not shares:
        return {}
    out = {n: round(share / annual_pool * 100.0, 2) for n, share in shares.items()}
    drift = 100.0 - sum(out.values())
    if abs(drift) > 1e-6 and out:
        biggest = max(out, key=out.__getitem__)
        out[biggest] = round(out[biggest] + drift, 2)
    return out


def _investment_used(a: WizardAnswers, name: str) -> bool:
    flag = {
        "broker": "use_broker",
        "lokata": "use_lokata",
        "obligacje": "use_obligacje",
        "krypto": "use_krypto",
        "oki_inw": "use_oki_inw",
        "oki_osk": "use_oki_osk",
    }.get(name)
    if flag is not None:
        return bool(getattr(a, flag))
    if name in TAX_SHELTER_FLAG:
        return bool(getattr(a, TAX_SHELTER_FLAG[name]))
    return False


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
    alloc = _resolve_allocation(a, config, annual_pool)
    cash_present = a.capital.get("gotowka", 0.0) > 0 or alloc.get("gotowka", 0.0) > 0

    stages: list[StageInput] = []
    accum_accounts: dict[str, AccountConfig] = {}

    inv_names = [
        n
        for n in SAVINGS_ACCOUNTS + ("ike", "ikze", "oipe", "oki_inw", "oki_osk")
        if _account_present(a, n, alloc)
    ]

    # --- Stage A: accumulation from today until FIRE ---
    # Workers save out of their salary, but the unemployed may still save from
    # other sources ("Odkładasz miesięcznie") — both accumulate until FIRE.
    # Salary-derived vehicles (PPK/PPE/ZUS) need a gross, so they require employment.
    if a.age_now < re and (employed or annual_pool > 0):
        for name in inv_names:
            starting = a.capital.get(name, 0.0)
            contrib = alloc.get(name, 0.0)
            cfg = _base_account(a, name, starting, _roi(a, name))
            cfg["annual_contribution"] = contrib
            if name == "ikze":
                cfg["ikze_limit"] = "self_employed" if a.employment == "b2b" else "etat"
                cfg["monthly_base"] = gross
            accum_accounts[name] = AccountConfig(**cfg)
        if cash_present:
            accum_accounts["gotowka"] = AccountConfig(
                starting_balance=a.capital.get("gotowka", 0.0),
                annual_contribution=alloc.get("gotowka", 0.0),
                roi=0.0,
            )
        if employed and a.use_ppk:
            accum_accounts["ppk"] = AccountConfig(
                starting_balance=a.capital.get("ppk", 0.0),
                monthly_base=gross,
                employee_pct=a.ppk_employee_pct,
                employer_pct=a.ppk_employer_pct,
                state_topups=a.ppk_state_topups,
                roi=_roi(a, "ppk"),
            )
        if employed and a.use_ppe:
            accum_accounts["ppe"] = AccountConfig(
                starting_balance=a.capital.get("ppe", 0.0),
                monthly_base=gross,
                employer_pct=a.ppe_employer_pct,
                annual_contribution=0.0,
                roi=_roi(a, "ppe"),
            )
        if employed and a.use_zus:
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

    # --- Stage B: FIRE bridge realization (FIRE age → plan horizon) ---
    # The whole non-ZUS portfolio pays out from the FIRE age (not from the
    # pension age): "Brydż do emerytury" is a realization stage.
    bridge_accounts: dict[str, AccountConfig] = {}
    for name in inv_names:
        bridge_accounts[name] = AccountConfig(
            starting_balance=a.capital.get(name, 0.0),
            roi=_roi(a, name),
            buffer=0.0,
        )
    if cash_present:
        bridge_accounts["gotowka"] = AccountConfig(
            starting_balance=a.capital.get("gotowka", 0.0),
            roi=0.0,
            buffer=0.0,
        )
    if a.use_ppk:
        bridge_accounts["ppk"] = AccountConfig(
            starting_balance=a.capital.get("ppk", 0.0),
            roi=_roi(a, "ppk"),
            buffer=0.0,
        )
    if a.use_ppe:
        bridge_accounts["ppe"] = AccountConfig(
            starting_balance=a.capital.get("ppe", 0.0),
            roi=_roi(a, "ppe"),
            buffer=0.0,
        )
    if bridge_accounts:
        stages.append(
            StageInput(
                stage_type="realizacja",
                name="Brydż do emerytury",
                start_age=re,
                end_age=plan_end,
                accounts=bridge_accounts,
            )
        )

    # --- Stage C: ZUS-only realization from pension age ---
    # Pension capital is converted to a lifetime annuity (ŚDTŻ) at retirement;
    # it never passes through the non-ZUS portfolio.
    if a.use_zus:
        stages.append(
            StageInput(
                stage_type="realizacja",
                name="Realizacja (emerytura)",
                start_age=retirement,
                end_age=plan_end,
                accounts={
                    "zus": AccountConfig(
                        starting_balance=a.capital.get("zus", 0.0),
                        starting_balance_ofe=a.capital.get("zus:ofe", 0.0),
                        ofe_member=a.ofe_member,
                        roi=0.0,
                        buffer=0.0,
                        waloryzacja_swiadczenia=None,
                    )
                },
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


def _tl(target: float) -> float:
    """Solver/gross-up accuracy band — a draw within this of the target counts
    as "met" (the constant-target gross-up converges to min ≈ target ± tol)."""
    return max(0.3, target * 1e-5)


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
    # A draw below the target is a miss: the gross-up scales so the year-min
    # nets to the target, so the guarantee "you always get at least target"
    # holds for every year — met fails only when the portfolio depletes.
    floor = (target - _tl(target)) if target and target > 0 else 0.5
    exhaust = None
    for age, m in months:
        if m < floor:
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


def _drawn_floor(data: SimulationInput, result: SimulationResult) -> float:
    """Lowest net monthly draw observed across the whole realization window.

    The constant-target engine pays a fixed gross, so the net take-home is
    lowest in the final years (taxes grow as principal is realized). Grossing
    this up to ``target`` is what makes "you can rely on at least target"
    literally true for every year of the horizon.
    """
    start, end = _realization_window(data)
    nets = [
        year.monthly_withdrawal for year in result.years if start <= year.age < end
    ]
    return min(nets) if nets else 0.0


def _net_to_gross(data: SimulationInput, target: float) -> float:
    """Monthly gross draw whose minimum net take-home equals ``target``.

    The engine pays out gross; taxes eat a growing share as principal is
    realized, so the worst (final) years pay least. Iteratively scale the
    gross by the drawn minimum so that no year — the guarantee — falls below
    the target. Infeasible targets diverge upward (min stays below target).
    """
    if target <= 0:
        return 0.0
    G = target
    tol = _tl(target)
    for _ in range(60):
        net = _drawn_floor(data, simulate(data, G))
        if net <= 0:
            break
        if abs(net - target) <= tol:
            break
        G = G * target / net
        if G > 1e12:
            break
    return G


def _evaluate(data: SimulationInput, target: float | None) -> PlanProjection:
    if target is None or target <= 0:
        return _project(data, simulate(data, target), target)
    G = _net_to_gross(data, target)
    return _project(data, simulate(data, G), target)


def _solve_payout(data: SimulationInput) -> tuple[float, bool]:
    """Highest constant monthly payout the portfolio sustains to the horizon.

    Returns (W, True) where W is the FIRE target for path 1: the maximum
    fixed monthly withdrawal (net) such that no year's draw falls below W —
    i.e. the portfolio never exhausts before ``plan_end``. Bisection over W:
    monotone, a higher target exhausts sooner, so ``met`` decreases with W.
    """
    start, end = _realization_window(data)
    if start >= end:
        return 0.0, True

    lo = 0.0
    hi = max(100.0, data.monthly_gross)
    while _evaluate(data, hi).met and hi < 1e9:
        hi *= 2.0
    for _ in range(50):
        mid = (lo + hi) / 2.0
        if _evaluate(data, mid).met:
            lo = mid
        else:
            hi = mid
    return lo, True


def _append_cash_warning(proj: PlanProjection, data: SimulationInput) -> PlanProjection:
    for etap in data.stages:
        if etap.stage_type == "akumulacja" and "gotowka" in etap.accounts:
            monthly = etap.accounts["gotowka"].annual_contribution / 12.0
            if monthly > 0.05:
                infl = data.config.inflation * 100.0
                proj.warnings.append(
                    f"Z oszczędności {round(monthly):,} zł/mies. pozostaje w gotówce "
                    f"— inflacja ({infl:.1f}%/rok) realnie je zjada. Rozważ broker, "
                    f"lokatę lub obligacje (zaznacz w kroku „Instrumenty”)."
                )
            break
    return proj


def _vary_savings(a: WizardAnswers, amount: float) -> SimulationInput:
    na = a.model_copy(deep=True)
    na.savings = amount
    na.savings_mode = "amount"
    return build_stages(na)


def _vary_re(a: WizardAnswers, re: int) -> SimulationInput:
    na = a.model_copy(deep=True)
    na.retire_early_age = re
    return build_stages(na)


def _savings_upper_bound(a: WizardAnswers, target: float) -> float:
    """Numeric cap for the savings bisection — derived from plan geometry,
    not income. Contributions alone (without returns) funding the whole
    realization horizon are provably enough with non-negative ROI, so a hit on
    this cap is a structural impossibility, never a salary artifact. The 2x
    factor absorbs taxes and drag on withdrawal."""
    config = default_config()
    retirement = _retirement_age(a, config)
    re = float(a.retire_early_age if a.retire_early_age is not None else retirement)
    horizon = max(1.0, float(a.plan_end_age) - re)
    window = max(0.1, re - float(a.age_now))
    return max(1.0, 2.0 * target * 12.0 * horizon / window)


def _solve_savings(a: WizardAnswers, target: float) -> tuple[float, bool]:
    """Minimum monthly savings whose projected payout meets target (bisection).

    There is no income cap: the answer is a pure number and stays informative
    even when it exceeds the salary (the UI surfaces it as a warning + % of pay).
    """
    lo = 0.0
    hi = _savings_upper_bound(a, target)
    tol = _tl(target)
    if _evaluate(_vary_savings(a, hi), target).min_monthly < target - tol:
        return hi, False
    if _evaluate(_vary_savings(a, lo), target).min_monthly >= target - tol:
        return 0.0, True
    for _ in range(40):
        mid = (lo + hi) / 2.0
        if _evaluate(_vary_savings(a, mid), target).min_monthly >= target - tol:
            hi = mid
        else:
            lo = mid
    return hi, True


def _solve_re(a: WizardAnswers, target: float) -> tuple[int | None, bool]:
    """Earliest FIRE age whose projected payout meets target (binary search)."""
    retirement = _retirement_age(a, default_config())
    low = a.age_now + 1
    high = max(retirement, low)
    tol = _tl(target)
    if _evaluate(_vary_re(a, high), target).min_monthly < target - tol:
        return None, False
    while low < high:
        mid = (low + high) // 2
        if _evaluate(_vary_re(a, mid), target).min_monthly >= target - tol:
            high = mid
        else:
            low = mid + 1
    return low, True


def plan(path: int, a: WizardAnswers, target: float | None = None) -> WizardPlanResult:
    if path == 1:
        data = build_stages(a)
        payout, _ = _solve_payout(data)
        for si in data.stages:
            if si.stage_type == "realizacja" and "zus" not in si.accounts:
                si.withdrawal_target_monthly = float(_net_to_gross(data, payout))
        return WizardPlanResult(
            path=1,
            input=data,
            projection=_append_cash_warning(_evaluate(data, payout), data),
            solved=PlanSolved(feasible=True),
        )

    if target is None or target <= 0:
        raise ValueError("target_monthly jest wymagany dla tej ścieżki.")

    if path == 2:
        amount, feasible = _solve_savings(a, target)
        data = _vary_savings(a, amount)
        proj = _append_cash_warning(_evaluate(data, target), data)
        pct = None
        if a.gross_monthly > 0:
            pct = round(amount / a.gross_monthly * 100.0, 1)
            if feasible and amount > 0 and amount > a.gross_monthly:
                proj.warnings.append(
                    f"Wymagane oszczędności ({amount:,.0f} zł/mies.) przekraczają "
                    f"Twoją pensję ({a.gross_monthly:,.0f} zł/mies.) — to "
                    f"{pct:,.0f}% pensji brutto. Symulacja zakłada wzrost dochodów, "
                    "cięcie kosztów lub dłuższy horyzont."
                )
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
            projection=_append_cash_warning(_evaluate(data, target), data),
            solved=PlanSolved(feasible=False, note=note),
        )
    data = _vary_re(a, re)
    return WizardPlanResult(
        path=3,
        input=data,
        projection=_append_cash_warning(_evaluate(data, target), data),
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
