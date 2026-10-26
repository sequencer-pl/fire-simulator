from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.simulation.config import TaxConfig, default_config, get_builtin_preset
from app.simulation.constants import MONTHS_PER_YEAR, PPE_ZUS_FRACTION
from app.simulation.engine import _init_state, _run_year, simulate
from app.simulation.salary import gross_from_net, net_from_gross
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
        "broker": 0.035,
        "lokata": 0.005,
        "obligacje": 0.015,
        "krypto": 0.03,
        "ike": 0.035,
        "ikze": 0.035,
        "oipe": 0.035,
        "ppk": 0.03,
        "ppe": 0.03,
        "oki_inw": 0.03,
        "oki_osk": 0.01,
    },
    "zbilansowana": {
        "broker": 0.05,
        "lokata": 0.01,
        "obligacje": 0.02,
        "krypto": 0.06,
        "ike": 0.05,
        "ikze": 0.05,
        "oipe": 0.05,
        "ppk": 0.04,
        "ppe": 0.04,
        "oki_inw": 0.045,
        "oki_osk": 0.02,
    },
    "agresywna": {
        "broker": 0.065,
        "lokata": 0.015,
        "obligacje": 0.025,
        "krypto": 0.08,
        "ike": 0.065,
        "ikze": 0.065,
        "oipe": 0.065,
        "ppk": 0.055,
        "ppe": 0.055,
        "oki_inw": 0.06,
        "oki_osk": 0.025,
    },
}

ASSUMPTIONS_PRESET_MAP: dict[str, str] = {
    "konserwatywne": "Konserwatywne",
    "realne": "Realne",
    "optymistyczne": "Optymistyczne",
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
    # "net" means gross_monthly carries a take-home amount (etat only); the
    # planner converts it to gross once, before any solver loop.
    salary_mode: Literal["gross", "net"] = "gross"

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

    savings: float = Field(default=1000.0, ge=0.0)

    strategy: Literal["konserwatywna", "zbilansowana", "agresywna", "manualna"] = "zbilansowana"
    assumptions: Literal["konserwatywne", "realne", "optymistyczne"] = "realne"
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
    path: Literal[1, 2, 3] = 1
    target_monthly: float | None = Field(default=None, ge=0.0)


class SalaryPreviewRequest(BaseModel):
    salary_mode: Literal["gross", "net"] = "gross"
    amount: float = Field(default=0.0, ge=0.0)
    employment: Literal["etat", "b2b", "niepracujacy"] = "etat"
    use_ppk: bool = False
    ppk_employee_pct: float = 0.02


class StageMetric(BaseModel):
    """Approximate monthly cash flow for one stage.

    ``monthly`` is a contribution during accumulation and a net payout
    during realization. For an overlapping supplement + ZUS period the
    supplement holds only the portfolio part and ZUS its pension part, so
    the two rows add up to the total net payout.
    """

    name: str
    stage_type: Literal["akumulacja", "realizacja"]
    start_age: int
    end_age: int
    monthly: float = 0.0


class PlanProjection(BaseModel):
    met: bool = False
    target_monthly: float | None = None
    min_monthly: float = 0.0
    mean_monthly: float = 0.0
    final_wealth: float = 0.0
    peak_wealth: float = 0.0
    exhaust_age: int | None = None
    warnings: list[str] = Field(default_factory=list)
    stage_metrics: list[StageMetric] = Field(default_factory=list)


class PlanSolved(BaseModel):
    savings_monthly: float | None = None
    savings_pct: float | None = None
    retire_early_age: int | None = None
    feasible: bool = True
    note: str = ""


class ScenarioSummary(BaseModel):
    assumptions: Literal["konserwatywne", "realne", "optymistyczne"]
    label: str
    feasible: bool = True
    payout_monthly: float | None = None
    savings_monthly: float | None = None
    savings_pct: float | None = None
    retire_early_age: int | None = None
    final_wealth: float = 0.0
    peak_wealth: float = 0.0


class WizardPlanResult(BaseModel):
    path: int
    input: SimulationInput
    net_monthly: float | None = None
    projection: PlanProjection
    solved: PlanSolved
    scenarios: dict[str, ScenarioSummary] = Field(default_factory=dict)
    scenario_inputs: dict[str, SimulationInput] = Field(default_factory=dict)
    scenario_projections: dict[str, PlanProjection] = Field(default_factory=dict)
    scenario_solved: dict[str, PlanSolved] = Field(default_factory=dict)


def _retirement_age(a: WizardAnswers, config) -> int:
    """Resolve pension age: explicit answer or ZUS default by gender."""
    if a.retirement_age is not None:
        return a.retirement_age
    return config.zus.wiek_emerytalny_k if a.gender == "k" else config.zus.wiek_emerytalny_m


def _savings_monthly(a: WizardAnswers) -> float:
    return a.savings


def _answers_net_monthly(a: WizardAnswers) -> float | None:
    """Net pay for an etat, including employee PPK when enabled."""
    if a.employment != "etat" or a.gross_monthly <= 0:
        return None
    ppk_pct = a.ppk_employee_pct if a.use_ppk else 0.0
    return net_from_gross(
        a.gross_monthly, _config_for_answers(a), ppk_pct=ppk_pct
    )


def _normalize_salary(a: WizardAnswers) -> WizardAnswers:
    """Convert a net declaration to gross once, before planning/solving."""
    if a.salary_mode != "net":
        return a
    if a.employment != "etat":
        return a.model_copy(update={"salary_mode": "gross"})
    ppk_pct = a.ppk_employee_pct if a.use_ppk else 0.0
    gross = gross_from_net(
        a.gross_monthly, _config_for_answers(a), ppk_pct=ppk_pct
    )
    return a.model_copy(update={"gross_monthly": gross, "salary_mode": "gross"})


def estimate_pool_monthly(
    a: WizardAnswers, path: int = 1, target_monthly: float | None = None
) -> float:
    """Monthly savings pool: direct for paths 1/3, solved from target for path 2."""
    a = _normalize_salary(a)
    if path == 2 and target_monthly is not None and target_monthly > 0:
        na = a.model_copy(deep=True)
        if not na.allocations:
            na.allocations = suggest_allocations(
                na, default_config(), max(12_000.0, target_monthly * 12.0)
            )
        amount, _ = _solve_savings(na, target_monthly)
        return round(amount, 2)
    return _savings_monthly(a)


def _config_for_answers(a: WizardAnswers) -> TaxConfig:
    preset_name = ASSUMPTIONS_PRESET_MAP.get(a.assumptions, "Realne")
    preset_dict = get_builtin_preset(preset_name)
    if preset_dict is not None:
        return TaxConfig.model_validate(preset_dict)
    return default_config()


def _roi(a: WizardAnswers, name: str, config: TaxConfig | None = None) -> float:
    if name in a.roi_overrides:
        return a.roi_overrides[name]
    if config is not None and name in config.accounts:
        return config.accounts[name].default_roi
    strat_key = "zbilansowana" if a.strategy == "manualna" else a.strategy
    return STRATEGY_ROI[strat_key].get(name, 0.04)


def _with_basis(name: str) -> bool:
    return name in ("broker", "obligacje", "krypto", "ike", "oipe")


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
    strat_key = "zbilansowana" if a.strategy == "manualna" else a.strategy
    pref = STRATEGY_SUGGEST[strat_key]
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
    a = _normalize_salary(a)
    config = _config_for_answers(a)
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
            cfg = _base_account(a, name, starting, _roi(a, name, config))
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
                roi=_roi(a, "ppk", config),
            )
        if employed and a.use_ppe:
            accum_accounts["ppe"] = AccountConfig(
                starting_balance=a.capital.get("ppe", 0.0),
                monthly_base=gross,
                employer_pct=a.ppe_employer_pct,
                annual_contribution=0.0,
                roi=_roi(a, "ppe", config),
            )
        if employed and a.use_zus:
            zus_base = (
                min(gross, config.zus.b2b_base_monthly)
                if a.employment == "b2b"
                else gross
            )
            accum_accounts["zus"] = AccountConfig(
                starting_balance=a.capital.get("zus", 0.0),
                starting_balance_ofe=a.capital.get("zus:ofe", 0.0),
                ofe_member=a.ofe_member,
                monthly_base=zus_base,
                roi=_roi(a, "zus", config),
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

    # --- Stage B: FIRE bridge & supplement realization ---
    bridge_accounts: dict[str, AccountConfig] = {}
    for name in inv_names:
        bridge_accounts[name] = AccountConfig(
            starting_balance=a.capital.get(name, 0.0),
            roi=_roi(a, name, config),
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
            roi=_roi(a, "ppk", config),
            buffer=0.0,
        )
    if a.use_ppe:
        bridge_accounts["ppe"] = AccountConfig(
            starting_balance=a.capital.get("ppe", 0.0),
            roi=_roi(a, "ppe", config),
            buffer=0.0,
        )
    if bridge_accounts:
        if re < retirement:
            stages.append(
                StageInput(
                    stage_type="realizacja",
                    name="Brydż do emerytury",
                    start_age=re,
                    end_age=retirement,
                    accounts={
                        k: v.model_copy(deep=True) for k, v in bridge_accounts.items()
                    },
                )
            )
        if retirement < plan_end:
            stages.append(
                StageInput(
                    stage_type="realizacja",
                    name="Dopłata do emerytury" if re < retirement else "Brydż do emerytury",
                    start_age=retirement,
                    end_age=plan_end,
                    accounts={
                        k: v.model_copy(deep=True) for k, v in bridge_accounts.items()
                    },
                )
            )

    # --- Stage C: ZUS-only realization from pension age ---
    # Pension capital is converted to a lifetime annuity (ŚDTŻ) at retirement;
    # it continues until the end of the simulation (lifetime).
    zus_end = max(plan_end, 100)
    if a.use_zus:
        stages.append(
            StageInput(
                stage_type="realizacja",
                name="Emerytura ZUS",
                start_age=retirement,
                end_age=zus_end,
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
    starts = [
        s.start_age
        for s in data.stages
        if s.stage_type == "realizacja" and "zus" not in s.accounts
    ]
    ends = [
        s.end_age
        for s in data.stages
        if s.stage_type == "realizacja" and "zus" not in s.accounts
    ]
    if starts and ends:
        return min(starts), max(ends)
    for s in data.stages:
        if s.stage_type == "realizacja":
            return s.start_age, s.end_age
    return 0, 0


def _tl(target: float) -> float:
    """Solver/gross-up accuracy band — a draw within this of the target counts
    as "met" (the constant-target gross-up converges to min ≈ target ± tol)."""
    return max(0.3, target * 1e-5)


def _monthly_contribution(
    name: str, cfg: AccountConfig, monthly_gross: float, config: TaxConfig
) -> float:
    """Average monthly inflow for one accumulation account.

    Mirrors the engine: regular accounts contribute their annual amount,
    PPK adds employee + employer percentages plus the annual state top-up,
    PPE adds the employer part (70 % after the ZUS transfer) and any extra
    contribution. ZUS contributions are excluded — they fund the pension,
    not the investable portfolio.
    """
    if name == "zus":
        return 0.0
    base = cfg.monthly_base if cfg.monthly_base > 0 else monthly_gross
    if name == "ppk":
        total = base * (cfg.employee_pct + cfg.employer_pct)
        if cfg.state_topups:
            total += config.ppk.state_annual / MONTHS_PER_YEAR
        return total
    if name == "ppe":
        total = base * cfg.employer_pct * (1.0 - PPE_ZUS_FRACTION)
        total += cfg.annual_contribution / MONTHS_PER_YEAR
        return total
    return cfg.annual_contribution / MONTHS_PER_YEAR


def _stage_metrics(
    data: SimulationInput, result: SimulationResult
) -> list[StageMetric]:
    """Per-stage monthly amounts aligned with ``data.stages``.

    Accumulation shows average contributions; realization shows the average
    positive net payout. A ZUS-only stage reports its pension, while other
    realization stages report the portfolio component (total net minus ZUS)
    so overlapping supplement + ZUS rows sum to the actual payout.
    """
    metrics: list[StageMetric] = []
    for stage in data.stages:
        if stage.stage_type == "akumulacja":
            monthly = sum(
                _monthly_contribution(name, cfg, data.monthly_gross, data.config)
                for name, cfg in stage.accounts.items()
            )
        else:
            zus_only = set(stage.accounts) == {"zus"}
            values: list[float] = []
            for year in result.years:
                if not (stage.start_age <= year.age < stage.end_age):
                    continue
                value = (
                    year.zus_monthly
                    if zus_only
                    else max(0.0, year.monthly_withdrawal - year.zus_monthly)
                )
                if value > 0:
                    values.append(value)
            monthly = sum(values) / len(values) if values else 0.0
        fallback = "Akumulacja" if stage.stage_type == "akumulacja" else "Realizacja"
        metrics.append(
            StageMetric(
                name=stage.name or fallback,
                stage_type=stage.stage_type,  # type: ignore[arg-type]
                start_age=stage.start_age,
                end_age=stage.end_age,
                monthly=round(monthly, 2),
            )
        )
    return metrics


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
        stage_metrics=_stage_metrics(data, result),
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


def _net_to_gross(
    data: SimulationInput, target: float
) -> tuple[float, SimulationResult]:
    """Monthly gross draw whose minimum net take-home equals ``target``.

    The engine pays out gross; taxes eat a growing share as principal is
    realized, so the worst (final) years pay least. Iteratively scale the
    gross by the drawn minimum so that no year — the guarantee — falls below
    the target. Infeasible targets diverge upward (min stays below target).
    """
    if target <= 0:
        return 0.0, simulate(data, 0.0)
    G = target
    tol = _tl(target)
    res = simulate(data, G)
    for _ in range(25):
        net = _drawn_floor(data, res)
        if net <= 0:
            break
        if abs(net - target) <= tol:
            break
        G = G * target / net
        if G > 1e12:
            res = simulate(data, G)
            break
        res = simulate(data, G)
    return G, res


def _evaluate(data: SimulationInput, target: float | None) -> PlanProjection:
    if target is None or target <= 0:
        return _project(data, simulate(data, target), target)
    _G, res = _net_to_gross(data, target)
    return _project(data, res, target)


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
    for _ in range(32):
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
    return build_stages(na)


def _vary_re(a: WizardAnswers, re: int) -> SimulationInput:
    na = a.model_copy(deep=True)
    na.retire_early_age = re
    return build_stages(na)


def _savings_upper_bound(a: WizardAnswers, target: float) -> float:
    """Numeric cap for the savings bisection — derived from plan geometry,
    not income. Contributions alone (without returns) funding the whole
    realization horizon are enough with non-negative ROI and withdrawal-only
    taxes, so a hit on this cap is never a salary artifact. Balance-proportional
    taxes (OKI) can still make the cap unreachable — ``_solve_savings`` walks
    down from it in that case. The 2x factor absorbs taxes and drag on withdrawal."""
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
    tol = _tl(target)

    def meets(amount: float) -> bool:
        projected = _evaluate(_vary_savings(a, amount), target).min_monthly
        return projected >= target - tol

    if meets(0.0):
        return 0.0, True

    hi = _savings_upper_bound(a, target)
    if not meets(hi):
        # The upper bound assumes withdrawals are the only tax drag. The OKI
        # asset tax grows with the balance, so a very high savings rate can
        # leave less net than the target even though moderate savings work.
        # Walk down to a feasible ceiling, then bisect from zero (the payout
        # is monotone below the asset-tax peak).
        lo = hi
        for _ in range(24):
            lo /= 2.0
            if lo < tol:
                return hi, False
            if meets(lo):
                hi = lo
                break
        else:
            return hi, False

    lo = 0.0
    for _ in range(30):
        mid = (lo + hi) / 2.0
        if meets(mid):
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


def _bake_realization_targets(data: SimulationInput, target_net: float | None) -> None:
    """Persist the solved gross target and ending buffers into realization stages
    so that replaying ``data`` in /sim (even via PMT or constant-target) matches
    the wizard projection."""
    if target_net is None or target_net <= 0:
        return
    gross_target, _ = _net_to_gross(data, target_net)
    for si in data.stages:
        if si.stage_type == "realizacja" and "zus" not in si.accounts:
            si.withdrawal_target_monthly = round(float(gross_target), 2)

    state = _init_state(data)
    min_age = min((si.start_age for si in data.stages), default=0)
    for age in range(min_age, data.max_age + 1):
        _run_year(state, age, data.monthly_gross, data.stages, gross_target)

    for si in data.stages:
        if si.stage_type == "realizacja" and "zus" not in si.accounts:
            end_state = state.computed.get(si.end_age - 1)
            if end_state:
                end_bal = end_state.get("ending_balances", {})
                for acc_name, acc_cfg in si.accounts.items():
                    if acc_name in end_bal:
                        acc_cfg.buffer = round(max(0.0, end_bal[acc_name]), 2)


def _plan_single(
    path: int, a: WizardAnswers, target: float | None = None
) -> tuple[SimulationInput, PlanProjection, PlanSolved]:
    if path == 1:
        data = build_stages(a)
        payout, _ = _solve_payout(data)
        _bake_realization_targets(data, payout)
        proj = _append_cash_warning(_evaluate(data, payout), data)
        return data, proj, PlanSolved(feasible=True)

    if target is None or target <= 0:
        raise ValueError("target_monthly jest wymagany dla tej ścieżki.")

    if path == 2:
        amount, feasible = _solve_savings(a, target)
        data = _vary_savings(a, amount)
        _bake_realization_targets(data, target)
        proj = _append_cash_warning(_evaluate(data, target), data)
        net = _answers_net_monthly(a)
        pct = None
        if net is not None and net > 0:
            pct = round(amount / net * 100.0, 1)
            if feasible and amount > 0 and amount > net:
                proj.warnings.append(
                    f"Wymagane oszczędności ({amount:,.0f} zł/mies.) przekraczają "
                    f"Twoją pensję netto ({net:,.0f} zł/mies.) — to "
                    f"{pct:,.0f}% pensji netto. Symulacja zakłada wzrost dochodów, "
                    "cięcie kosztów lub dłuższy horyzont."
                )
        note = ""
        if not feasible:
            note = (
                "Cel wypłaty nieosiągalny nawet przy bardzo wysokiej skali "
                "oszczędności — rozważ późniejsze FIRE, niższą wypłatę lub "
                "bardziej agresywną strategię."
            )
        return (
            data,
            proj,
            PlanSolved(
                savings_monthly=round(amount),
                savings_pct=pct,
                feasible=feasible,
                note=note,
            ),
        )

    re, feasible = _solve_re(a, target)
    if re is None:
        data = build_stages(a)
        _bake_realization_targets(data, target)
        note = (
            "Nie znaleziono wieku FIRE spełniającego cel wypłaty — także przy "
            "pracy do pełnego wieku emerytalnego. Rozważ niższą wypłatę, "
            "większe oszczędności lub agresywniejszą strategię."
        )
        return (
            data,
            _append_cash_warning(_evaluate(data, target), data),
            PlanSolved(feasible=False, note=note),
        )
    data = _vary_re(a, re)
    _bake_realization_targets(data, target)
    return (
        data,
        _append_cash_warning(_evaluate(data, target), data),
        PlanSolved(
            retire_early_age=re,
            feasible=feasible,
            note=(
                f"Najwcześniejszy wiek FIRE z gwarancją wypłaty {target:,.0f} zł/mies. to {re} lat."
                if re <= _retirement_age(a, _config_for_answers(a))
                else f"Wiek FIRE {re} lat (z pełnym wiekiem emerytalnym lub wcześniej)."
            ),
        ),
    )


SCENARIO_LABELS: dict[str, str] = {
    "konserwatywne": "Kryzys / ostrożne",
    "realne": "Realne (bazowe)",
    "optymistyczne": "Hossa / optymistyczne",
}


def plan(path: int, a: WizardAnswers, target: float | None = None) -> WizardPlanResult:
    a = _normalize_salary(a)
    main_input, main_proj, main_solved = _plan_single(path, a, target)

    scenarios: dict[str, ScenarioSummary] = {}
    scenario_inputs: dict[str, SimulationInput] = {}
    scenario_projections: dict[str, PlanProjection] = {}
    scenario_solved: dict[str, PlanSolved] = {}

    for key in ("konserwatywne", "realne", "optymistyczne"):
        if key == a.assumptions:
            s_in, s_proj, s_solved = main_input, main_proj, main_solved
        else:
            sa = a.model_copy(deep=True)
            sa.assumptions = key  # type: ignore[assignment]
            s_in, s_proj, s_solved = _plan_single(path, sa, target)
        scenario_inputs[key] = s_in
        scenario_projections[key] = s_proj
        scenario_solved[key] = s_solved
        scenarios[key] = ScenarioSummary(
            assumptions=key,  # type: ignore[arg-type]
            label=SCENARIO_LABELS[key],
            feasible=s_solved.feasible and s_proj.met,
            payout_monthly=round(s_proj.min_monthly) if path == 1 else target,
            savings_monthly=s_solved.savings_monthly,
            savings_pct=s_solved.savings_pct,
            retire_early_age=s_solved.retire_early_age,
            final_wealth=s_proj.final_wealth,
            peak_wealth=s_proj.peak_wealth,
        )

    return WizardPlanResult(
        path=path,
        input=main_input,
        net_monthly=_answers_net_monthly(a),
        projection=main_proj,
        solved=main_solved,
        scenarios=scenarios,
        scenario_inputs=scenario_inputs,
        scenario_projections=scenario_projections,
        scenario_solved=scenario_solved,
    )
