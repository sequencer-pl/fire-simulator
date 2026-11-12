from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.tax import scale_tax
from app.simulation.config import (
    TaxConfig,
    base_account_key,
    default_config,
    get_builtin_preset,
)
from app.simulation.constants import MONTHS_PER_YEAR, PPE_ZUS_FRACTION
from app.simulation.engine import (
    _compute_monthly_gross_dochod,
    _init_state,
    _run_year,
    simulate,
)
from app.simulation.salary import (
    b2b_gross_from_net,
    b2b_net_from_gross,
    b2b_zus_base_and_social,
    gross_from_net,
    net_from_gross,
)
from app.simulation.schemas import (
    AccountConfig,
    SimulationInput,
    SimulationResult,
    StageInput,
    YearResult,
)

SAVINGS_ACCOUNTS = ("broker", "lokata", "obligacje", "krypto")

# Curated preference order used to open NEW accounts the user lacks. Capacity
# logic (suggest_allocations) absorbs the annual pool account by account in this
# order and only opens the next one when the previous hits its annual limit.
# Kolejność zapełniania kont z ulgami. Strategia decyduje, które ulgi bierzemy
# pod uwagę (OIPE tylko w agresywnej, chyba że użytkownik już je ma), a podział
# kwoty ponad limity określa wyłącznie STRATEGY_MIX.
STRATEGY_SHELTER_ORDER: dict[str, tuple[str, ...]] = {
    "konserwatywna": ("ikze", "ike"),
    "zbilansowana": ("ikze", "ike"),
    "agresywna": ("ikze", "ike", "oipe"),
}

# Miks nadwyżki PO wypełnieniu ulg (procenty nadwyżki, nie całej puli).
STRATEGY_MIX: dict[str, dict[str, float]] = {
    "konserwatywna": {"obligacje": 50, "lokata": 30, "oki_osk": 20},
    "zbilansowana": {
        "broker": 45,
        "obligacje": 25,
        "oki_inw": 15,
        "lokata": 10,
        "krypto": 5,
    },
    "agresywna": {
        "broker": 50,
        "oki_inw": 15,
        "krypto": 15,
        "obligacje": 10,
        "lokata": 10,
    },
}

# Poniżej tej nadwyżki nie dzielimy na kilka kont — szkoda mnogości wpłat.
MIX_MIN_ANNUAL = 20_000.0
# Próg opłacalności IKZE vs IKE przy reinwestycji zwrotu w IKE/OIPE (10%
# ryczałtu + ok. 0,5 p.p. opóźnienia zwrotu).
IKZE_BREAKEVEN_RATE = 0.105

# Accounts with statutory annual contribution caps (limits in config.limits).
TAX_SHELTER_ACCOUNTS = ("ike", "ikze", "oipe")

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
    # Saldo PPK/PPE może istnieć bez bieżących wpłat (np. PPE byłego
    # pracodawcy). ``use_*`` oznacza samo konto, a ``*_contributions`` —
    # czy w obecnej pracy nadal trafiają do niego składki.
    ppk_contributions: bool = True
    ppk_employee_pct: float = 0.02
    ppk_employer_pct: float = 0.015
    ppk_state_topups: bool = True
    use_ikze: bool = False
    use_ike: bool = False
    use_oipe: bool = False
    use_ppe: bool = False
    ppe_contributions: bool = True
    ppe_employer_pct: float = 0.035
    use_oki_inw: bool = False
    use_oki_osk: bool = False
    use_krypto: bool = False
    use_lokata: bool = False
    use_obligacje: bool = False
    use_broker: bool = False
    use_nieruchomosc: bool = False

    # Parametry B2B (Asystent v2):
    b2b_tax_form: Literal["ryczalt", "liniowy", "skala"] | None = None
    b2b_lump_rate: float = Field(default=0.12, ge=0.0, le=0.5)
    b2b_zus_mode: Literal["duzy", "maly", "ulga", "custom"] = "duzy"
    b2b_custom_zus_base: float = Field(default=5652.0, ge=0.0, le=1e8)
    b2b_switch_to_full_zus: bool = True

    # Sabbatical / Coast FIRE / Barista FIRE (część etatu przed pełnym FIRE):
    semi_fire_enabled: bool = False
    semi_fire_mode: Literal["coast", "barista"] = "coast"
    semi_fire_age: int | None = Field(default=None, ge=0, le=110)
    semi_fire_net_monthly: float = Field(default=0.0, ge=0.0, le=1e8)
    semi_fire_savings_monthly: float = Field(default=0.0, ge=0.0, le=1e8)

    # Kredyt hipoteczny (mieszkanie własne) i Nieruchomość inwestycyjna:
    mortgage_monthly: float = Field(default=0.0, ge=0.0, le=1e7)
    mortgage_end_age: int | None = Field(default=None, ge=0, le=120)
    redirect_mortgage_to_savings: bool = True
    real_estate_rental_monthly: float = Field(default=0.0, ge=0.0, le=1e7)
    real_estate_liquidation_age: int | None = Field(default=None, ge=0, le=120)

    # Własne nazwy kont (np. {"lokata": "Lokata mBank", "lokata:2": "Lokata PKO"}):
    custom_names: dict[str, str] = Field(default_factory=dict)

    retire_early_age: int | None = Field(default=None, ge=0, le=110)
    retirement_age: int | None = Field(default=None, ge=0, le=110)
    plan_end_age: int = Field(default=DEFAULT_PLAN_END, ge=1, le=120)

    savings: float = Field(default=1000.0, ge=0.0)

    strategy: Literal["konserwatywna", "zbilansowana", "agresywna", "manualna"] = "zbilansowana"
    assumptions: Literal["konserwatywne", "realne", "optymistyczne"] = "realne"
    life_expectancy_growth_months_per_year: float | None = Field(default=None, ge=0.0, le=5.0)
    # Server-injected saved config. Wizard endpoints overwrite it from the
    # user's saved configuration; None keeps the legacy built-in preset path.
    base_config: TaxConfig | None = None
    roi_overrides: dict[str, float] = Field(default_factory=dict)

    # Monthly-savings shares (%) per allocatable account. Money NOT assigned
    # here (or exceeding a shelter's annual limit) lands in "gotowka".
    allocations: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_allocations(self) -> "WizardAnswers":
        share_sum = 0.0
        for name, weight in self.allocations.items():
            if base_account_key(name) not in ALLOCATABLE_ACCOUNTS:
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
    b2b_tax_form: Literal["ryczalt", "liniowy", "skala"] | None = None
    b2b_lump_rate: float = Field(default=0.12, ge=0.0, le=0.5)
    b2b_zus_mode: Literal["duzy", "maly", "ulga", "custom"] = "duzy"
    b2b_custom_zus_base: float = Field(default=5652.0, ge=0.0, le=1e8)
    # Anonymous wizard sessions send their locally saved config here.
    base_config: TaxConfig | None = None


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


class PhaseMetric(BaseModel):
    """Non-overlapping display phase for the wizard timeline.

    ``monthly`` is an average contribution during accumulation and an average
    net payout during realization. ``portfolio_monthly`` and ``zus_monthly``
    split the payout into its two sources so the retirement phase can show a
    combined total while the stage metrics still expose the overlapping stages.
    """

    key: Literal["accumulation", "bridge", "retirement_topup", "zus_only"]
    name: str
    cashflow: Literal["contribution", "payout"]
    start_age: int
    end_age: int
    monthly: float = 0.0
    portfolio_monthly: float = 0.0
    zus_monthly: float = 0.0


class AccountPhase(BaseModel):
    """Zwarty okres wypłat z jednego konta (do tabeli i Gantta)."""

    account: str
    accumulation_start_age: int | None = None
    accumulation_end_age: int | None = None
    accumulation_start_balance: float = 0.0
    accumulation_annual_contribution: float = 0.0
    accumulation_total_contributions: float = 0.0
    accumulation_end_balance: float = 0.0
    accumulation_growth: float = 0.0
    start_age: int
    last_age: int
    years: int
    months: int
    starting_balance: float = 0.0
    ending_balance: float = 0.0
    total_gross: float = 0.0
    total_tax: float = 0.0
    total_health: float = 0.0
    lump_tax: float = 0.0
    total_net: float = 0.0
    avg_monthly_net: float = 0.0
    min_monthly_net: float = 0.0
    max_monthly_net: float = 0.0


class PlanProjection(BaseModel):
    met: bool = False
    target_monthly: float | None = None
    min_monthly: float = 0.0
    mean_monthly: float = 0.0
    final_wealth: float = 0.0
    final_wealth_net: float = 0.0
    total_withdrawn: float = 0.0
    withdrawal_policy: str = "defer_tier"
    ikze_refund_account: str | None = None
    ikze_refund_total: float = 0.0
    ikze_refund_allocations: dict[str, float] = Field(default_factory=dict)
    early_return_total: float = 0.0
    early_return_tax_total: float = 0.0
    early_return_allocations: dict[str, float] = Field(default_factory=dict)
    peak_wealth: float = 0.0
    exhaust_age: int | None = None
    warnings: list[str] = Field(default_factory=list)
    stage_metrics: list[StageMetric] = Field(default_factory=list)
    phase_metrics: list[PhaseMetric] = Field(default_factory=list)
    account_phases: list[AccountPhase] = Field(default_factory=list)


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
    final_wealth_net: float = 0.0
    peak_wealth: float = 0.0
    withdrawal_policy: str = "defer_tier"


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
    """Net pay for an etat or B2B (when b2b_tax_form is specified)."""
    if a.gross_monthly <= 0:
        return None
    if a.employment == "etat":
        ppk_pct = a.ppk_employee_pct if (a.use_ppk and a.ppk_contributions) else 0.0
        return net_from_gross(
            a.gross_monthly, _config_for_answers(a), ppk_pct=ppk_pct
        )
    if a.employment == "b2b" and a.b2b_tax_form in ("ryczalt", "liniowy", "skala"):
        return b2b_net_from_gross(
            a.gross_monthly,
            _config_for_answers(a),
            tax_form=a.b2b_tax_form,
            lump_rate=a.b2b_lump_rate,
            zus_mode=a.b2b_zus_mode,
            custom_zus_base=a.b2b_custom_zus_base,
        )
    return None


def _normalize_salary(a: WizardAnswers) -> WizardAnswers:
    """Convert a net declaration to gross once, before planning/solving."""
    if a.salary_mode != "net":
        return a
    if a.employment == "etat":
        ppk_pct = a.ppk_employee_pct if (a.use_ppk and a.ppk_contributions) else 0.0
        gross = gross_from_net(
            a.gross_monthly, _config_for_answers(a), ppk_pct=ppk_pct
        )
        return a.model_copy(update={"gross_monthly": gross, "salary_mode": "gross"})
    if a.employment == "b2b" and a.b2b_tax_form in ("ryczalt", "liniowy", "skala"):
        gross = b2b_gross_from_net(
            a.gross_monthly,
            _config_for_answers(a),
            tax_form=a.b2b_tax_form,
            lump_rate=a.b2b_lump_rate,
            zus_mode=a.b2b_zus_mode,
            custom_zus_base=a.b2b_custom_zus_base,
        )
        return a.model_copy(update={"gross_monthly": gross, "salary_mode": "gross"})
    return a.model_copy(update={"salary_mode": "gross"})


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


def _with_market_overlay(config: TaxConfig, preset_name: str) -> TaxConfig:
    """Apply only market assumptions from a built-in preset.

    Structural data (taxes, limits, account rules, PPK/PPE, longevity) stays
    from the user's saved config; the preset changes inflation, default ROI
    and ZUS indexation.
    """
    preset = get_builtin_preset(preset_name)
    if preset is None:
        return config
    data = config.model_dump()
    data["inflation"] = preset["inflation"]
    data["zus"]["waloryzacja_skladek"] = preset["zus"]["waloryzacja_skladek"]
    data["zus"]["waloryzacja_swiadczenia"] = preset["zus"]["waloryzacja_swiadczenia"]
    for name, rules in preset["accounts"].items():
        if name in data["accounts"]:
            data["accounts"][name]["default_roi"] = rules["default_roi"]
    return TaxConfig.model_validate(data)


def _config_for_answers(a: WizardAnswers) -> TaxConfig:
    if a.base_config is not None:
        config = a.base_config.model_copy(deep=True)
        if a.assumptions != "realne":
            config = _with_market_overlay(
                config, ASSUMPTIONS_PRESET_MAP.get(a.assumptions, "Realne")
            )
    else:
        preset_name = ASSUMPTIONS_PRESET_MAP.get(a.assumptions, "Realne")
        preset_dict = get_builtin_preset(preset_name)
        config = (
            TaxConfig.model_validate(preset_dict)
            if preset_dict is not None
            else default_config()
        )
    if a.life_expectancy_growth_months_per_year is not None:
        config.longevity.growth_months_per_year = a.life_expectancy_growth_months_per_year
    return config


def resolve_config(a: WizardAnswers) -> TaxConfig:
    """Effective config for one assistant run (saved base + market overlay)."""
    return _config_for_answers(a)


def _roi(a: WizardAnswers, name: str, config: TaxConfig | None = None) -> float:
    base = base_account_key(name)
    if name in a.roi_overrides:
        return a.roi_overrides[name]
    if base in a.roi_overrides:
        return a.roi_overrides[base]
    if config is not None:
        rules = config.get_account_rules(name)
        if rules is not None:
            return rules.default_roi
    return 0.04


def _with_basis(name: str) -> bool:
    return base_account_key(name) in ("broker", "obligacje", "krypto", "ike", "oipe")


def _shelter_cap(a: WizardAnswers, config, name: str) -> float:
    limits = config.limits
    if name == "ikze":
        return limits.ikze_annual_self_employed if a.employment == "b2b" else limits.ikze_annual
    if name == "ike":
        return limits.ike_annual
    if name == "oipe":
        return limits.oipe_annual
    return 0.0


TINY_CASH_ANNUAL = 12.0


def _resolve_allocation(a: WizardAnswers, config, annual_pool: float) -> dict[str, float]:
    """Split the discretionary pool by user weights; shelters cap at annual
    limits; whatever is not assigned stays in "gotowka" (the visible sink).

    Resztki zaokrągleń poniżej 1 zł/mies. nie tworzą konta gotówki — dokładamy
    je do największego konta bez limitu, żeby nie straszyć użytkownika
    „2 zł/rok w gotówce”.
    """
    alloc: dict[str, float] = {}
    for inst, weight in a.allocations.items():
        target = annual_pool * weight / 100.0
        cap = _shelter_cap(a, config, inst)
        contrib = min(target, cap) if cap else target
        if contrib > 1e-6:
            alloc[inst] = round(contrib, 2)
    used = sum(alloc.values())
    overflow = max(0.0, annual_pool - used)
    if overflow > TINY_CASH_ANNUAL:
        alloc["gotowka"] = round(overflow, 2)
    elif overflow > 1e-6 and alloc:
        uncapped = [name for name in alloc if _shelter_cap(a, config, name) <= 0]
        if uncapped:
            biggest = max(uncapped, key=lambda name: alloc[name])
            alloc[biggest] = round(alloc[biggest] + overflow, 2)
    return alloc


def _ikze_deduction_rate(a: WizardAnswers, config: TaxConfig) -> float:
    """Średnia ulga PIT od wpłaty IKZE (0–1) — do progu IKZE vs IKE."""
    gross = max(0.0, a.gross_monthly)
    if gross <= 0:
        return 0.0
    if a.employment == "b2b" and a.b2b_tax_form == "liniowy":
        return 0.19
    if a.employment == "b2b" and a.b2b_tax_form == "ryczalt":
        return max(0.0, a.b2b_lump_rate)
    if a.employment == "b2b" and a.b2b_tax_form == "skala":
        base, social_m = b2b_zus_base_and_social(
            a.b2b_zus_mode, config, a.b2b_custom_zus_base
        )
        income = max(0.0, (gross - social_m) * MONTHS_PER_YEAR)
        limit = (
            config.limits.ikze_annual_self_employed
            if a.employment == "b2b"
            else config.limits.ikze_annual
        )
        if income <= 0 or limit <= 0:
            return 0.0
        before = scale_tax(income, **config.scale_kwargs())
        after = scale_tax(max(0.0, income - limit), **config.scale_kwargs())
        return max(0.0, before - after) / limit
    income = _compute_monthly_gross_dochod(gross, config)
    limit = (
        config.limits.ikze_annual_self_employed
        if a.employment == "b2b"
        else config.limits.ikze_annual
    )
    if income <= 0 or limit <= 0:
        return 0.0
    before = scale_tax(income, **config.scale_kwargs())
    after = scale_tax(max(0.0, income - limit), **config.scale_kwargs())
    return max(0.0, before - after) / limit


def _prefer_ikze(a: WizardAnswers, config: TaxConfig) -> bool:
    """IKZE przed IKE, gdy ulga bije 10% ryczałtu (z reinwestycją w IKE/OIPE)."""
    return _ikze_deduction_rate(a, config) > IKZE_BREAKEVEN_RATE


def _shelter_order(
    a: WizardAnswers, active: set[str], config: TaxConfig
) -> list[str]:
    """Priority order for filling the annual pool into tax-sheltered accounts.

    Shelters are opened even when the user does not hold them yet — that is the
    point of the suggestion. The strategy decides which shelters are considered
    (OIPE only in the aggressive one unless already held); the IKZE/IKE order
    depends on whether the IKZE deduction beats the 10% exit lump sum. The
    amount above the limits is split by STRATEGY_MIX."""
    strat_key = "zbilansowana" if a.strategy == "manualna" else a.strategy
    order = list(STRATEGY_SHELTER_ORDER[strat_key])
    if not _prefer_ikze(a, config) and "ike" in order and "ikze" in order:
        order.remove("ike")
        order.insert(order.index("ikze"), "ike")
    order += [n for n in TAX_SHELTER_ACCOUNTS if n in active and n not in order]
    return order


def suggest_priority(a: WizardAnswers, config) -> list[str]:
    """Ordered list of accounts the strategy funds — without amounts or shares.

    Used by the wizard to show the priority path on strategy cards, so the card
    does not repeat the proposed split. The list includes shelters even when the
    user does not hold them yet (the suggestion opens them) and the strategy's
    overflow accounts in STRATEGY_MIX order."""
    a = _normalize_salary(a)
    strat_key = "zbilansowana" if a.strategy == "manualna" else a.strategy
    active = {n for n in ALLOCATABLE_ACCOUNTS if _account_present(a, n, {})}
    order = _shelter_order(a, active, config)
    for name in STRATEGY_MIX.get(strat_key, {}):
        if name not in order:
            order.append(name)
    return order


def suggest_allocations(a: WizardAnswers, config, annual_pool: float) -> dict[str, float]:
    """Auto % split: najpierw ulgi (IKZE/IKE/OIPE) do limitów, potem miks
    nadwyżki wg strategii (broker/obligacje/OKI/lokata/krypto). Mała nadwyżka
    (< MIX_MIN_ANNUAL) trafia do pierwszego konta miksu, żeby nie mnożyć wpłat."""
    if annual_pool <= 0:
        return {}
    a = _normalize_salary(a)
    strat_key = "zbilansowana" if a.strategy == "manualna" else a.strategy
    # Active = participation flag OR existing capital — an account the user
    # already holds money in is a valid target for future savings even without
    # an explicit "use_*" checkbox (wizard auto-checks on any non-zero balance).
    active = {n for n in ALLOCATABLE_ACCOUNTS if _account_present(a, n, {})}
    remaining = annual_pool
    amounts: dict[str, float] = {}
    for name in _shelter_order(a, active, config):
        if remaining <= 0:
            break
        cap = _shelter_cap(a, config, name)
        take = min(remaining, cap) if cap else remaining
        if take > 1e-6:
            amounts[name] = amounts.get(name, 0.0) + take
            remaining -= take

    if remaining > 1e-6:
        mix = STRATEGY_MIX.get(strat_key, {})
        if mix and remaining >= MIX_MIN_ANNUAL:
            for name, pct in mix.items():
                share = remaining * pct / 100.0
                if share > 1e-6:
                    amounts[name] = amounts.get(name, 0.0) + share
        else:
            first = next(iter(mix), "broker")
            amounts[first] = amounts.get(first, 0.0) + remaining

    if not amounts:
        return {}
    out = {n: round(share / annual_pool * 100.0, 2) for n, share in amounts.items()}
    drift = 100.0 - sum(out.values())
    if abs(drift) > 1e-6 and out:
        biggest = max(out, key=out.__getitem__)
        out[biggest] = round(out[biggest] + drift, 2)
    return out


def _investment_used(a: WizardAnswers, name: str) -> bool:
    base = base_account_key(name)
    flag = {
        "broker": "use_broker",
        "lokata": "use_lokata",
        "obligacje": "use_obligacje",
        "krypto": "use_krypto",
        "oki_inw": "use_oki_inw",
        "oki_osk": "use_oki_osk",
        "nieruchomosc": "use_nieruchomosc",
    }.get(name if name == base else "")
    if flag is not None:
        return bool(getattr(a, flag, False))
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
    cfg: dict = {
        "starting_balance": starting,
        "roi": roi,
    }
    if name in a.custom_names and a.custom_names[name].strip():
        cfg["custom_name"] = a.custom_names[name].strip()
    if _with_basis(name):
        cfg["cost_basis_enabled"] = True
        cfg["cost_basis"] = starting
    return cfg


def _b2b_zus_base(a: WizardAnswers, config: TaxConfig) -> float:
    base, _social = b2b_zus_base_and_social(
        a.b2b_zus_mode, config, a.b2b_custom_zus_base
    )
    return base


def _ikze_regime_for_answers(a: WizardAnswers) -> tuple[str, float]:
    if a.employment == "b2b":
        if a.b2b_tax_form == "liniowy":
            return "flat_19", 0.19
        if a.b2b_tax_form == "ryczalt":
            return "lump_sum", a.b2b_lump_rate
    return "scale", 0.12


def _build_accum_stage_accounts(
    a: WizardAnswers,
    config: TaxConfig,
    inv_names: list[str],
    alloc: dict[str, float],
    cash_present: bool,
    employed: bool,
    gross: float,
    zus_base_override: float | None = None,
    include_starting: bool = True,
) -> dict[str, AccountConfig]:
    accum_accounts: dict[str, AccountConfig] = {}
    regime, lump_rate = _ikze_regime_for_answers(a)
    for name in inv_names:
        starting = a.capital.get(name, 0.0) if include_starting else 0.0
        contrib = alloc.get(name, 0.0)
        cfg = _base_account(a, name, starting, _roi(a, name, config))
        cfg["annual_contribution"] = contrib
        if name == "ikze":
            cfg["ikze_limit"] = "self_employed" if a.employment == "b2b" else "etat"
            cfg["monthly_base"] = gross
            cfg["ikze_tax_regime"] = regime
            cfg["ikze_lump_sum_rate"] = lump_rate
        accum_accounts[name] = AccountConfig(**cfg)
    if a.use_nieruchomosc or a.capital.get("nieruchomosc", 0.0) > 0:
        re_start = a.capital.get("nieruchomosc", 0.0) if include_starting else 0.0
        re_cfg = _base_account(a, "nieruchomosc", re_start, _roi(a, "nieruchomosc", config))
        re_cfg["rental_income_monthly"] = a.real_estate_rental_monthly
        re_cfg["liquidation_age"] = a.real_estate_liquidation_age
        accum_accounts["nieruchomosc"] = AccountConfig(**re_cfg)
    if cash_present or alloc.get("gotowka", 0.0) >= TINY_CASH_ANNUAL:
        accum_accounts["gotowka"] = AccountConfig(
            starting_balance=a.capital.get("gotowka", 0.0) if include_starting else 0.0,
            annual_contribution=alloc.get("gotowka", 0.0),
            roi=0.0,
        )
    ppk_active = employed and a.use_ppk and a.ppk_contributions
    ppk_present = a.use_ppk or a.capital.get("ppk", 0.0) > 0
    if ppk_present and (
        ppk_active or (include_starting and a.capital.get("ppk", 0.0) > 0)
    ):
        accum_accounts["ppk"] = AccountConfig(
            starting_balance=a.capital.get("ppk", 0.0) if include_starting else 0.0,
            monthly_base=gross if ppk_active else 0.0,
            employee_pct=a.ppk_employee_pct if ppk_active else 0.0,
            employer_pct=a.ppk_employer_pct if ppk_active else 0.0,
            state_topups=a.ppk_state_topups if ppk_active else False,
            roi=_roi(a, "ppk", config),
        )
    ppe_active = employed and a.use_ppe and a.ppe_contributions
    ppe_present = a.use_ppe or a.capital.get("ppe", 0.0) > 0
    if ppe_present and (
        ppe_active or (include_starting and a.capital.get("ppe", 0.0) > 0)
    ):
        accum_accounts["ppe"] = AccountConfig(
            starting_balance=a.capital.get("ppe", 0.0) if include_starting else 0.0,
            monthly_base=gross if ppe_active else 0.0,
            employer_pct=a.ppe_employer_pct if ppe_active else 0.0,
            annual_contribution=0.0,
            roi=_roi(a, "ppe", config),
        )
    has_zus_capital = (
        a.capital.get("zus", 0.0) > 0 or a.capital.get("zus:ofe", 0.0) > 0
    )
    if a.use_zus and (employed or has_zus_capital):
        if zus_base_override is not None:
            zus_base = zus_base_override
        elif a.employment == "b2b" and employed:
            zus_base = (
                _b2b_zus_base(a, config)
                if a.b2b_tax_form is not None or a.b2b_zus_mode != "duzy"
                else min(gross, config.zus.b2b_base_monthly)
            )
        else:
            zus_base = gross if employed else 0.0
        accum_accounts["zus"] = AccountConfig(
            starting_balance=a.capital.get("zus", 0.0) if include_starting else 0.0,
            starting_balance_ofe=a.capital.get("zus:ofe", 0.0) if include_starting else 0.0,
            ofe_member=a.ofe_member,
            monthly_base=zus_base,
            roi=_roi(a, "zus", config),
        )
    return accum_accounts


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
    cash_present = (
        a.capital.get("gotowka", 0.0) > 0
        or alloc.get("gotowka", 0.0) >= TINY_CASH_ANNUAL
    )

    stages: list[StageInput] = []

    base_inv = list(SAVINGS_ACCOUNTS + ("ike", "ikze", "oipe", "oki_inw", "oki_osk"))
    extra_instances = [
        k
        for k in list(a.capital.keys()) + list(a.allocations.keys())
        if ":" in k
        and k != "zus:ofe"
        and base_account_key(k) in base_inv
    ]
    all_candidates = list(dict.fromkeys(base_inv + extra_instances))
    inv_names = [n for n in all_candidates if _account_present(a, n, alloc)]

    semi_active = (
        a.semi_fire_enabled
        and a.semi_fire_age is not None
        and a.age_now < a.semi_fire_age < re
    )
    barista_active = semi_active and a.semi_fire_mode == "barista"
    coast_active = semi_active and a.semi_fire_mode == "coast"
    accum_end = int(a.semi_fire_age) if barista_active and a.semi_fire_age is not None else re

    has_zus_capital = (
        a.use_zus
        and (a.capital.get("zus", 0.0) > 0 or a.capital.get("zus:ofe", 0.0) > 0)
    )
    has_payroll_capital = (
        a.capital.get("ppk", 0.0) > 0 or a.capital.get("ppe", 0.0) > 0
    )
    # --- Stage A: accumulation from today until FIRE (or Barista FIRE start) ---
    if a.age_now < accum_end and (
        employed
        or annual_pool > 0
        or coast_active
        or bool(inv_names)
        or cash_present
        or has_zus_capital
        or has_payroll_capital
    ):
        if coast_active and a.semi_fire_age is not None:
            semi_age = int(a.semi_fire_age)
            redirect = (
                a.redirect_mortgage_to_savings
                and a.mortgage_monthly > 0
                and a.mortgage_end_age is not None
            )
            m_end = int(a.mortgage_end_age) if a.mortgage_end_age is not None else None

            # Faza 1: pełna praca do semi_age, z ewentualnym podziałem
            # akumulacji przy spłacie kredytu hipotecznego.
            phase1_boosted = redirect and m_end is not None and m_end <= a.age_now
            phase1_pool_monthly = _savings_monthly(a) + (
                a.mortgage_monthly if phase1_boosted else 0.0
            )
            phase1_alloc = _resolve_allocation(a, config, phase1_pool_monthly * 12.0)
            if redirect and m_end is not None and a.age_now < m_end < semi_age:
                acc1 = _build_accum_stage_accounts(
                    a,
                    config,
                    inv_names,
                    alloc,
                    cash_present,
                    employed,
                    gross,
                    include_starting=True,
                )
                if acc1:
                    stages.append(
                        StageInput(
                            stage_type="akumulacja",
                            name="Akumulacja (z kredytem)",
                            start_age=a.age_now,
                            end_age=m_end,
                            accounts=acc1,
                        )
                    )
                boosted_pool = (_savings_monthly(a) + a.mortgage_monthly) * 12.0
                boosted_alloc = _resolve_allocation(a, config, boosted_pool)
                acc1b = _build_accum_stage_accounts(
                    a,
                    config,
                    inv_names,
                    boosted_alloc,
                    cash_present,
                    employed,
                    gross,
                    include_starting=False,
                )
                if acc1b:
                    stages.append(
                        StageInput(
                            stage_type="akumulacja",
                            name="Akumulacja (po spłacie kredytu)",
                            start_age=m_end,
                            end_age=semi_age,
                            accounts=acc1b,
                        )
                    )
            else:
                acc1 = _build_accum_stage_accounts(
                    a,
                    config,
                    inv_names,
                    phase1_alloc,
                    cash_present,
                    employed,
                    gross,
                    include_starting=True,
                )
                if acc1:
                    stages.append(
                        StageInput(
                            stage_type="akumulacja",
                            name="Akumulacja do emerytury",
                            start_age=a.age_now,
                            end_age=semi_age,
                            accounts=acc1,
                        )
                    )

            # Faza 2: Coast FIRE / część etatu od semi_age do re, z ewentualnym
            # podziałem przy spłacie kredytu hipotecznego.
            coast_base_monthly = a.semi_fire_savings_monthly
            coast_pool_boosted_from_start = redirect and m_end is not None and m_end <= semi_age
            if coast_pool_boosted_from_start:
                coast_base_monthly = coast_base_monthly + a.mortgage_monthly
            coast_pool = max(0.0, coast_base_monthly) * 12.0
            coast_alloc = _resolve_allocation(a, config, coast_pool) if coast_pool > 0 else {}
            coast_gross = (
                gross_from_net(a.semi_fire_net_monthly, config)
                if a.employment == "etat" and a.semi_fire_net_monthly > 0
                else a.semi_fire_net_monthly
            )
            coast_zus = (
                _b2b_zus_base(a, config)
                if a.employment == "b2b"
                else coast_gross
            )
            if redirect and m_end is not None and semi_age < m_end < re:
                acc2 = _build_accum_stage_accounts(
                    a, config, inv_names, coast_alloc, cash_present,
                    employed and coast_gross > 0, coast_gross,
                    zus_base_override=coast_zus, include_starting=False,
                )
                if acc2:
                    stages.append(
                        StageInput(
                            stage_type="akumulacja",
                            name="Coast FIRE (z kredytem)",
                            start_age=semi_age,
                            end_age=m_end,
                            accounts=acc2,
                        )
                    )
                boosted_coast_pool = (
                    max(0.0, a.semi_fire_savings_monthly) + a.mortgage_monthly
                ) * 12.0
                boosted_coast_alloc = (
                    _resolve_allocation(a, config, boosted_coast_pool)
                    if boosted_coast_pool > 0
                    else {}
                )
                acc2b = _build_accum_stage_accounts(
                    a, config, inv_names, boosted_coast_alloc, cash_present,
                    employed and coast_gross > 0, coast_gross,
                    zus_base_override=coast_zus, include_starting=False,
                )
                if acc2b:
                    stages.append(
                        StageInput(
                            stage_type="akumulacja",
                            name="Coast FIRE (po spłacie kredytu)",
                            start_age=m_end,
                            end_age=re,
                            accounts=acc2b,
                        )
                    )
            else:
                acc2 = _build_accum_stage_accounts(
                    a, config, inv_names, coast_alloc, cash_present,
                    employed and coast_gross > 0, coast_gross,
                    zus_base_override=coast_zus, include_starting=False,
                )
                if acc2:
                    stages.append(
                        StageInput(
                            stage_type="akumulacja",
                            name="Coast FIRE (część etatu)",
                            start_age=semi_age,
                            end_age=re,
                            accounts=acc2,
                        )
                    )
        elif (
            a.mortgage_monthly > 0
            and a.mortgage_end_age is not None
            and a.redirect_mortgage_to_savings
            and a.age_now < a.mortgage_end_age < accum_end
        ):
            # Podział akumulacji w momencie spłaty kredytu hipotecznego:
            # po spłacie kredytu rata powiększa miesięczne oszczędności.
            m_end = int(a.mortgage_end_age)
            acc1 = _build_accum_stage_accounts(
                a, config, inv_names, alloc, cash_present, employed, gross, include_starting=True
            )
            if acc1:
                stages.append(
                    StageInput(
                        stage_type="akumulacja",
                        name="Akumulacja (z kredytem)",
                        start_age=a.age_now,
                        end_age=m_end,
                        accounts=acc1,
                    )
                )
            boosted_pool = (_savings_monthly(a) + a.mortgage_monthly) * 12.0
            boosted_alloc = _resolve_allocation(a, config, boosted_pool)
            acc2 = _build_accum_stage_accounts(
                a,
                config,
                inv_names,
                boosted_alloc,
                cash_present,
                employed,
                gross,
                include_starting=False,
            )
            if acc2:
                stages.append(
                    StageInput(
                        stage_type="akumulacja",
                        name="Akumulacja (po spłacie kredytu)",
                        start_age=m_end,
                        end_age=accum_end,
                        accounts=acc2,
                    )
                )
        else:
            accum_accounts = _build_accum_stage_accounts(
                a, config, inv_names, alloc, cash_present, employed, gross, include_starting=True
            )
            if accum_accounts:
                stages.append(
                    StageInput(
                        stage_type="akumulacja",
                        name="Akumulacja do emerytury",
                        start_age=a.age_now,
                        end_age=accum_end,
                        accounts=accum_accounts,
                    )
                )

    # --- Stage B: FIRE bridge & supplement realization ---
    bridge_accounts: dict[str, AccountConfig] = {}
    for name in inv_names:
        b_cfg = _base_account(a, name, a.capital.get(name, 0.0), _roi(a, name, config))
        b_cfg.pop("cost_basis_enabled", None)
        b_cfg.pop("cost_basis", None)
        b_cfg["buffer"] = 0.0
        bridge_accounts[name] = AccountConfig(**b_cfg)
    if a.use_nieruchomosc or a.capital.get("nieruchomosc", 0.0) > 0:
        re_b = _base_account(
            a, "nieruchomosc", a.capital.get("nieruchomosc", 0.0), _roi(a, "nieruchomosc", config)
        )
        re_b["rental_income_monthly"] = a.real_estate_rental_monthly
        re_b["liquidation_age"] = a.real_estate_liquidation_age
        re_b["buffer"] = 0.0
        bridge_accounts["nieruchomosc"] = AccountConfig(**re_b)
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
        if barista_active and a.semi_fire_age is not None:
            semi_age = int(a.semi_fire_age)
            pt_zus = (
                gross_from_net(a.semi_fire_net_monthly, config)
                if a.employment == "etat" and a.semi_fire_net_monthly > 0
                else (
                    _b2b_zus_base(a, config)
                    if a.employment == "b2b" and a.semi_fire_net_monthly > 0
                    else 0.0
                )
            )
            stages.append(
                StageInput(
                    stage_type="realizacja",
                    name="Częściowe FIRE (praca + portfel)",
                    start_age=semi_age,
                    end_age=re,
                    part_time_net_monthly=a.semi_fire_net_monthly,
                    part_time_zus_base=pt_zus if a.use_zus else 0.0,
                    accounts={
                        k: v.model_copy(deep=True) for k, v in bridge_accounts.items()
                    },
                )
            )
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
                    name=(
                        "Dopłata do emerytury"
                        if (re < retirement or barista_active)
                        else "Brydż do emerytury"
                    ),
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
        mortgage_monthly=a.mortgage_monthly,
        mortgage_end_age=a.mortgage_end_age,
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
    if name == "ppk":
        total = cfg.monthly_base * (cfg.employee_pct + cfg.employer_pct)
        if cfg.state_topups:
            total += config.ppk.state_annual / MONTHS_PER_YEAR
        return total
    if name == "ppe":
        total = cfg.monthly_base * cfg.employer_pct * (1.0 - PPE_ZUS_FRACTION)
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


def _average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _payout_averages(
    result: SimulationResult, start_age: int, end_age: int
) -> tuple[float, float, float]:
    """Average monthly total, portfolio and ZUS payout in an age window."""
    years = [year for year in result.years if start_age <= year.age < end_age]
    if not years:
        return 0.0, 0.0, 0.0
    monthly = _average([year.monthly_withdrawal for year in years])
    zus = _average([year.zus_monthly for year in years])
    portfolio = _average(
        [max(0.0, year.monthly_withdrawal - year.zus_monthly) for year in years]
    )
    return monthly, portfolio, zus


def _zus_indexation(data: SimulationInput, zus_stage: StageInput | None) -> float:
    if zus_stage is not None:
        override = zus_stage.accounts["zus"].waloryzacja_swiadczenia
        if override is not None:
            return override
    return data.config.zus.waloryzacja_swiadczenia


def _projected_zus_values(
    result: SimulationResult, start_age: int, end_age: int, rate: float
) -> list[float]:
    """ZUS payouts in a window, extending beyond the simulated plan horizon.

    The engine stops at ``plan_end - 1``; the lifetime ZUS benefit continues
    afterwards. Use the last known benefit and index it with the same annual
    rate as the engine so the "Sama emerytura ZUS" phase has a real estimate.
    """
    if start_age >= end_age:
        return []
    actual = [
        year.zus_monthly
        for year in result.years
        if start_age <= year.age < end_age and year.zus_monthly > 0
    ]
    last = max(
        (year for year in result.years if year.zus_monthly > 0),
        key=lambda year: year.age,
        default=None,
    )
    if last is None:
        return actual
    value = last.zus_monthly
    projected: list[float] = []
    for age in range(last.age + 1, end_age):
        value *= 1.0 + rate
        if age >= start_age:
            projected.append(value)
    return actual + projected


def _phase_metrics(
    data: SimulationInput, result: SimulationResult
) -> list[PhaseMetric]:
    """Build non-overlapping display phases for the wizard timeline."""
    if not data.stages:
        return []

    accumulation_stages = sorted(
        (stage for stage in data.stages if stage.stage_type == "akumulacja"),
        key=lambda stage: (stage.start_age, stage.end_age),
    )
    realizations = [
        stage for stage in data.stages if stage.stage_type == "realizacja"
    ]
    zus_stage = next(
        (stage for stage in realizations if set(stage.accounts) == {"zus"}),
        None,
    )
    portfolio_stages = [
        stage for stage in realizations if "zus" not in stage.accounts
    ]
    plan_end = data.max_age + 1
    phases: list[PhaseMetric] = []

    if accumulation_stages:
        for index, stage in enumerate(accumulation_stages):
            contribution = sum(
                _monthly_contribution(name, cfg, data.monthly_gross, data.config)
                for name, cfg in stage.accounts.items()
            )
            name = stage.name or (
                "Akumulacja do emerytury"
                if len(accumulation_stages) == 1
                else f"Akumulacja {index + 1}"
            )
            phases.append(
                PhaseMetric(
                    key="accumulation",
                    name=name,
                    cashflow="contribution",
                    start_age=stage.start_age,
                    end_age=stage.end_age,
                    monthly=round(contribution, 2),
                )
            )
        re = accumulation_stages[-1].end_age
    else:
        re = min(stage.start_age for stage in data.stages)

    if zus_stage is not None:
        retirement = zus_stage.start_age
    elif len(portfolio_stages) >= 2:
        retirement = portfolio_stages[-1].start_age
    elif portfolio_stages:
        retirement = portfolio_stages[0].start_age
    else:
        retirement = re
    retirement = max(re, retirement)

    if re < retirement:
        monthly, portfolio, zus = _payout_averages(result, re, retirement)
        phases.append(
            PhaseMetric(
                key="bridge",
                name="Brydż do emerytury",
                cashflow="payout",
                start_age=re,
                end_age=retirement,
                monthly=round(monthly, 2),
                portfolio_monthly=round(portfolio, 2),
                zus_monthly=round(zus, 2),
            )
        )

    has_portfolio_retirement = any(
        stage.start_age < plan_end and stage.end_age > retirement
        for stage in portfolio_stages
    )
    if retirement < plan_end and has_portfolio_retirement:
        monthly, portfolio, zus = _payout_averages(result, retirement, plan_end)
        if portfolio <= 0 and zus_stage is not None:
            values = _projected_zus_values(
                result,
                retirement,
                zus_stage.end_age,
                _zus_indexation(data, zus_stage),
            )
            zus_monthly = _average(values)
            phases.append(
                PhaseMetric(
                    key="zus_only",
                    name="Emerytura ZUS",
                    cashflow="payout",
                    start_age=retirement,
                    end_age=zus_stage.end_age,
                    monthly=round(zus_monthly, 2),
                    zus_monthly=round(zus_monthly, 2),
                )
            )
            return phases
        phases.append(
            PhaseMetric(
                key="retirement_topup",
                name=(
                    "Emerytura + dopłata"
                    if zus > 0 and portfolio > 0
                    else "Emerytura z portfela"
                ),
                cashflow="payout",
                start_age=retirement,
                end_age=plan_end,
                monthly=round(monthly, 2),
                portfolio_monthly=round(portfolio, 2),
                zus_monthly=round(zus, 2),
            )
        )
    elif retirement < plan_end and zus_stage is not None:
        zus_end = zus_stage.end_age
        values = _projected_zus_values(
            result,
            retirement,
            zus_end,
            _zus_indexation(data, zus_stage),
        )
        monthly = _average(values)
        phases.append(
            PhaseMetric(
                key="zus_only",
                name="Emerytura ZUS",
                cashflow="payout",
                start_age=retirement,
                end_age=zus_end,
                monthly=round(monthly, 2),
                zus_monthly=round(monthly, 2),
            )
        )
        return phases

    if (
        zus_stage is not None
        and has_portfolio_retirement
        and plan_end < zus_stage.end_age
    ):
        values = _projected_zus_values(
            result,
            plan_end,
            zus_stage.end_age,
            _zus_indexation(data, zus_stage),
        )
        monthly = _average(values)
        phases.append(
            PhaseMetric(
                key="zus_only",
                name="Sama emerytura ZUS",
                cashflow="payout",
                start_age=plan_end,
                end_age=zus_stage.end_age,
                monthly=round(monthly, 2),
                zus_monthly=round(monthly, 2),
            )
        )

    return phases


def _account_phases(
    data: SimulationInput, result: SimulationResult
) -> list[AccountPhase]:
    """Grupuje lata z wypłatami danego konta w zwarte fazy.

    Podatek jednorazowy IKZE (zwrot przed 65) jest pokazywany osobno: wypłata
    w tym roku pochodzi już z kapitału netto, więc nie odejmujemy go drugi raz
    od miesięcznej kwoty.
    """
    accum_start: dict[str, int] = {}
    accum_stage: dict[str, StageInput] = {}
    for si in data.stages:
        if si.stage_type != "akumulacja":
            continue
        for acc, cfg in si.accounts.items():
            # Konta dodane w locie po wcześniejszym zwrocie (broker/lokata)
            # mają zerowe saldo i wpłaty w akumulacji — nie rysuj tam paska.
            funded = cfg.starting_balance > 0 or cfg.annual_contribution > 0
            if acc == "zus":
                funded = funded or cfg.monthly_base > 0
            if acc in ("ppk", "ppe"):
                funded = funded or (
                    cfg.monthly_base > 0
                    or cfg.employee_pct > 0
                    or cfg.employer_pct > 0
                )
            if funded:
                accum_start.setdefault(acc, si.start_age)
                accum_stage.setdefault(acc, si)

    accounts: set[str] = set()
    for year in result.years:
        accounts.update(year.withdrawals.keys())
        accounts.update(year.early_return_tax_by_account.keys())

    phases: list[AccountPhase] = []
    for account in sorted(accounts):
        if account == "zus:ofe":
            continue
        rules = data.config.get_account_rules(account)
        boundary_ages: set[int] = set()
        if rules and rules.min_withdrawal_age > 0:
            boundary_ages.add(rules.min_withdrawal_age)
        current: dict | None = None

        def flush(acc: str) -> None:
            nonlocal current
            if current is None:
                return
            years = current["last_age"] - current["start_age"] + 1
            months = years * MONTHS_PER_YEAR
            monthlies = current["monthlies"] or [0.0]
            stage = accum_stage.get(acc)
            accum_end_age: int | None = None
            accum_start_balance = 0.0
            accum_annual = 0.0
            accum_total = 0.0
            accum_end_balance = 0.0
            accum_growth = 0.0
            if stage is not None and acc in stage.accounts:
                cfg = stage.accounts[acc]
                accum_end_age = stage.end_age
                accum_start_balance = cfg.starting_balance
                accum_annual = (
                    _monthly_contribution(acc, cfg, data.monthly_gross, data.config)
                    * MONTHS_PER_YEAR
                )
                accum_years = max(0, stage.end_age - stage.start_age)
                accum_total = accum_annual * accum_years
                if acc == "ppk" and cfg.state_topups:
                    accum_total += data.config.ppk.state_welcoming
                accum_end_balance = next(
                    (
                        year.ending_balances.get(acc, 0.0)
                        for year in result.years
                        if year.age == accum_end_age - 1
                    ),
                    0.0,
                )
                if accum_end_age <= stage.start_age:
                    accum_end_balance = accum_start_balance
                accum_growth = accum_end_balance - accum_start_balance - accum_total
            phases.append(
                AccountPhase(
                    account=acc,
                    accumulation_start_age=accum_start.get(acc),
                    accumulation_end_age=accum_end_age,
                    accumulation_start_balance=round(accum_start_balance, 2),
                    accumulation_annual_contribution=round(accum_annual, 2),
                    accumulation_total_contributions=round(accum_total, 2),
                    accumulation_end_balance=round(accum_end_balance, 2),
                    accumulation_growth=round(accum_growth, 2),
                    start_age=current["start_age"],
                    last_age=current["last_age"],
                    years=years,
                    months=months,
                    starting_balance=round(current["starting_balance"], 2),
                    ending_balance=round(current["ending_balance"], 2),
                    total_gross=round(current["gross"], 2),
                    total_tax=round(current["tax"], 2),
                    total_health=round(current["health"], 2),
                    lump_tax=round(current["lump"], 2),
                    total_net=round(current["net"], 2),
                    avg_monthly_net=round(current["net"] / months, 2),
                    min_monthly_net=round(min(monthlies), 2),
                    max_monthly_net=round(max(monthlies), 2),
                )
            )
            current = None

        for year in result.years:
            gross = year.withdrawals.get(account, 0.0)
            tax = year.taxes.get(account, 0.0)
            health = year.health.get(account, 0.0)
            lump = year.early_return_tax_by_account.get(account, 0.0)
            active = gross > 0.005 or lump > 0.005
            if not active:
                flush(account)
                continue
            # Wcześniejszy zwrot IKZE: to jednorazowy podatek, a netto jest
            # reinwestowane w innym koncie — nie pokazujemy wiersza „0 zł”.
            if gross <= 0.005 and lump > 0.005:
                flush(account)
                continue
            net = gross if lump > 0 else max(0.0, gross - tax - health)
            monthly = net / MONTHS_PER_YEAR
            if current is not None:
                prev_monthly = current["last_monthly"]
                crossed_boundary = year.age in boundary_ages and year.age > current["start_age"]
                changed = abs(monthly - prev_monthly) > max(100.0, prev_monthly * 0.2)
                if crossed_boundary or changed:
                    flush(account)
            if current is None:
                current = {
                    "start_age": year.age,
                    "last_age": year.age,
                    "starting_balance": year.balances.get(account, 0.0),
                    "ending_balance": year.ending_balances.get(account, 0.0),
                    "gross": 0.0,
                    "tax": 0.0,
                    "health": 0.0,
                    "lump": 0.0,
                    "net": 0.0,
                    "monthlies": [],
                    "last_monthly": 0.0,
                }
            current["last_age"] = year.age
            current["last_monthly"] = monthly
            current["ending_balance"] = year.ending_balances.get(account, 0.0)
            current["gross"] += gross
            current["tax"] += tax
            current["health"] += health
            current["lump"] += lump
            current["net"] += net
            current["monthlies"].append(net / MONTHS_PER_YEAR)
        flush(account)

    first_start: dict[str, int] = {}
    for phase in phases:
        first_start[phase.account] = min(
            first_start.get(phase.account, phase.start_age), phase.start_age
        )
    phases.sort(key=lambda p: (first_start[p.account], p.start_age))
    return phases


def _year_lifestyle_net_monthly(data: SimulationInput, year: YearResult) -> float:
    """Miesięczny budżet na życie w roku realizacji (uwzględnia Barista FIRE i kredyt)."""
    extra_income = 0.0
    for si in data.stages:
        if (
            si.stage_type == "realizacja"
            and "zus" not in si.accounts
            and si.start_age <= year.age < si.end_age
            and si.part_time_net_monthly > 0
        ):
            extra_income = max(extra_income, si.part_time_net_monthly)
    mortgage_cost = (
        data.mortgage_monthly
        if (
            data.mortgage_monthly > 0
            and data.mortgage_end_age is not None
            and year.age < data.mortgage_end_age
        )
        else 0.0
    )
    return max(0.0, year.monthly_withdrawal + extra_income - mortgage_cost)


def _project(
    data: SimulationInput, result: SimulationResult, target: float | None
) -> PlanProjection:
    start, end = _realization_window(data)
    months = [
        (year.age, _year_lifestyle_net_monthly(data, year))
        for year in result.years
        if start <= year.age < end
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
        final_wealth_net=round(result.final_wealth_net, 2),
        total_withdrawn=round(result.total_withdrawn, 2),
        withdrawal_policy=data.withdrawal_policy,
        ikze_refund_account=next(iter(result.ikze_refund_allocations), None),
        ikze_refund_total=round(result.total_tax_refund, 2),
        ikze_refund_allocations=result.ikze_refund_allocations,
        early_return_total=round(result.early_return_total, 2),
        early_return_tax_total=round(result.early_return_tax_total, 2),
        early_return_allocations=result.early_return_allocations,
        peak_wealth=round(result.peak_wealth, 2),
        exhaust_age=exhaust,
        warnings=result.warnings,
        stage_metrics=_stage_metrics(data, result),
        phase_metrics=_phase_metrics(data, result),
        account_phases=_account_phases(data, result),
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
        _year_lifestyle_net_monthly(data, year)
        for year in result.years
        if start <= year.age < end
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
    for _ in range(24):
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
            if monthly >= 1.0:
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
    for _ in range(24):
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
            si.withdrawal_target_gross_monthly = round(float(gross_target), 2)

    state = _init_state(data)
    min_age = min((si.start_age for si in data.stages), default=0)
    for age in range(min_age, data.max_age + 1):
        _run_year(
            state,
            age,
            data.monthly_gross,
            data.stages,
            gross_target,
            mortgage_monthly=data.mortgage_monthly,
            mortgage_end_age=data.mortgage_end_age,
        )

    for si in data.stages:
        if si.stage_type == "realizacja" and "zus" not in si.accounts:
            end_state = state.computed.get(si.end_age - 1)
            if end_state:
                end_bal = end_state.get("ending_balances", {})
                for acc_name, acc_cfg in si.accounts.items():
                    if acc_name in end_bal:
                        acc_cfg.buffer = round(max(0.0, end_bal[acc_name]), 2)


WIZARD_POLICIES = ("defer_tier", "early_tier", "defer_roi", "early_roi")


def _policy_score(proj: PlanProjection) -> tuple[bool, float, float]:
    """Najpierw spełnienie celu, potem wartość netto (wypłaty + majątek netto)."""
    return (
        bool(proj.met),
        proj.total_withdrawn + proj.final_wealth_net,
        proj.mean_monthly,
    )


def _best_policy(
    data: SimulationInput, target: float | None
) -> tuple[SimulationInput, PlanProjection]:
    """Porównuje warianty wypłat (kiedy zwrócić IKZE i wg jakiego ROI)."""
    best: tuple[tuple[bool, float, float], SimulationInput, PlanProjection] | None = None
    for policy in WIZARD_POLICIES:
        candidate = data.model_copy(
            update={"withdrawal_policy": policy}, deep=True
        )
        proj = _append_cash_warning(_evaluate(candidate, target), candidate)
        score = _policy_score(proj)
        if best is None or score > best[0]:
            best = (score, candidate, proj)
    assert best is not None
    return best[1], best[2]


def _plan_single(
    path: int, a: WizardAnswers, target: float | None = None
) -> tuple[SimulationInput, PlanProjection, PlanSolved]:
    if path == 1:
        data = build_stages(a)
        payout, _ = _solve_payout(data)
        _bake_realization_targets(data, payout)
        data, proj = _best_policy(data, payout)
        if data.withdrawal_policy != "defer_tier":
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
        data, proj = _best_policy(data, target)
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
    data, proj = _best_policy(data, target)
    return (
        data,
        proj,
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


def plan(
    path: int,
    a: WizardAnswers,
    target: float | None = None,
    *,
    scenarios: bool = True,
) -> WizardPlanResult:
    """Plan dla jednej ścieżki; ``scenarios=False`` pomija 3 scenariusze rynkowe.

    Asystent zawsze potrzebuje scenariuszy (karty w kroku 6), ale testy i
    wewnętrzne wywołania, które patrzą tylko na wynik główny, mogą je pominąć —
    to oszczędza dwa pełne przeliczenia solvera.
    """
    a = _normalize_salary(a)
    main_input, main_proj, main_solved = _plan_single(path, a, target)

    scenarios_out: dict[str, ScenarioSummary] = {}
    scenario_inputs: dict[str, SimulationInput] = {}
    scenario_projections: dict[str, PlanProjection] = {}
    scenario_solved: dict[str, PlanSolved] = {}

    if scenarios:
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
            scenarios_out[key] = ScenarioSummary(
                assumptions=key,  # type: ignore[arg-type]
                label=SCENARIO_LABELS[key],
                feasible=s_solved.feasible and s_proj.met,
                payout_monthly=round(s_proj.min_monthly) if path == 1 else target,
                savings_monthly=s_solved.savings_monthly,
                savings_pct=s_solved.savings_pct,
                retire_early_age=s_solved.retire_early_age,
                final_wealth=s_proj.final_wealth,
                final_wealth_net=s_proj.final_wealth_net,
                peak_wealth=s_proj.peak_wealth,
                withdrawal_policy=s_proj.withdrawal_policy,
            )

    return WizardPlanResult(
        path=path,
        input=main_input,
        net_monthly=_answers_net_monthly(a),
        projection=main_proj,
        solved=main_solved,
        scenarios=scenarios_out,
        scenario_inputs=scenario_inputs,
        scenario_projections=scenario_projections,
        scenario_solved=scenario_solved,
    )
