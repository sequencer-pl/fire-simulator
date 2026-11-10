from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.simulation.config import TaxConfig, base_account_key, default_config

_ALLOWED_IKZE_TARGETS = {
    "",
    "auto",
    "none",
    "broker",
    "lokata",
    "obligacje",
    "oki_inw",
    "oki_osk",
    "krypto",
    "gotowka",
    "ike",
    "oipe",
}


class AccountConfig(BaseModel):
    custom_name: str = Field(default="", max_length=80)
    starting_balance: float = Field(default=0.0, ge=0.0, le=1e12)
    cost_basis_enabled: bool = False
    cost_basis: float | None = Field(default=None, ge=0.0, le=1e12)
    roi: float = Field(default=0.02, ge=-0.99, le=10.0)
    lokata_term_months: Literal[1, 2, 3, 4, 6, 12, 24, 36, 60] = 12
    annual_contribution: float = Field(default=0.0, ge=0.0, le=1e9)
    buffer: float = Field(default=0.0, ge=0.0, le=1e12)
    monthly_pension: float = Field(default=0.0, ge=0.0, le=1e7)
    ikze_limit: str = "etat"
    # Forma opodatkowania dochodu, od którego odliczana jest wpłata na IKZE:
    # "scale" = skala PIT (12%/32%), "flat_19" = liniowy 19% (B2B),
    # "lump_sum" = ryczałt ewidencjonowany wg stawki ikze_lump_sum_rate (B2B).
    ikze_tax_regime: Literal["scale", "flat_19", "lump_sum"] = "scale"
    ikze_lump_sum_rate: float = Field(default=0.12, ge=0.0, le=0.5)
    # Gdzie trafia zwrot podatku z ulgi IKZE: "auto", "none" albo konkretne konto
    # w etapie (w tym sub-konta np. "broker:2", "lokata:2").
    ikze_refund_target: str = "auto"
    base_override_enabled: bool = False
    monthly_base: float = Field(default=0.0, ge=0.0, le=1e9)
    ofe_member: bool = False
    starting_balance_ofe: float = Field(default=0.0, ge=0.0, le=1e12)
    waloryzacja_skladek: float | None = Field(default=None, ge=-0.99, le=2.0)
    waloryzacja_swiadczenia: float | None = Field(default=None, ge=-0.99, le=2.0)
    employee_pct: float = Field(default=0.02, ge=0.0, le=1.0)
    employer_pct: float = Field(default=0.015, ge=0.0, le=1.0)
    state_topups: bool = True
    asset_exemption: float | None = Field(default=None, ge=0.0, le=1e12)
    # Nieruchomość inwestycyjna: miesięczny przychód z najmu (przed ryczałtem 8,5%/12,5%)
    # oraz opcjonalny wiek sprzedaży nieruchomości (0 lub None = nie sprzedawaj).
    rental_income_monthly: float = Field(default=0.0, ge=0.0, le=1e7)
    liquidation_age: int | None = Field(default=None, ge=0, le=120)

    @field_validator("ikze_refund_target")
    @classmethod
    def _validate_ikze_refund_target(cls, v: str) -> str:
        if v in _ALLOWED_IKZE_TARGETS:
            return v
        base = base_account_key(v)
        if base in _ALLOWED_IKZE_TARGETS and base not in ("", "auto", "none"):
            return v
        raise ValueError(f"Nieprawidłowy cel zwrotu IKZE: {v}")


class StageInput(BaseModel):
    stage_type: Literal["akumulacja", "realizacja"]
    name: str = Field(default="", max_length=200)
    start_age: int = Field(ge=0, le=119)
    end_age: int = Field(ge=1, le=120)
    accounts: dict[str, AccountConfig] = Field(default_factory=dict)
    withdrawal_target_gross_monthly: float = Field(
        default=0.0,
        ge=0.0,
        le=1e9,
        description=(
            "Stały cel wypłaty brutto (zł/mies.) dla fazy realizacji bez ZUS. "
            ">0 = tryb stałego celu (wypłata z portfela, pomniejszona o rentę ZUS); "
            "0 = klasyczna annuitetyzacja PMT."
        ),
    )
    part_time_net_monthly: float = Field(
        default=0.0,
        ge=0.0,
        le=1e8,
        description=(
            "Miesięczny dochód netto z pracy na część etatu w okresie częściowego FIRE "
            "(Barista FIRE / Sabbatical), zmniejszający zapotrzebowanie na wypłatę z portfela."
        ),
    )
    part_time_zus_base: float = Field(
        default=0.0,
        ge=0.0,
        le=1e8,
        description=(
            "Podstawa miesięczna ZUS z pracy na część etatu w okresie częściowego FIRE "
            "(dopisuje składki do kapitału ZUS przed osiągnięciem wieku emerytalnego)."
        ),
    )

    @model_validator(mode="after")
    def _validate_age_range(self) -> "StageInput":
        if self.end_age <= self.start_age:
            raise ValueError("Wiek końca etapu musi być większy niż wiek start.")
        return self


class SimulationInput(BaseModel):
    stages: list[StageInput] = Field(default_factory=list, max_length=20)
    max_age: int = Field(
        default=100,
        ge=0,
        le=120,
        description=(
            "Pomocniczy horyzont; symulacja i tak kończy się na ostatnim etapie "
            "(end_age - 1), żeby nie ucinać planu ani nie dopisywać lat po jego końcu."
        ),
    )
    gender: Literal["k", "m"] = "m"
    monthly_gross: float = Field(default=0.0, ge=0.0, le=1e9)
    start_year: int | None = Field(
        default=None,
        ge=1900,
        le=2200,
        description=(
            "Calendar year corresponding to the first stage's start age. None = use config.year."
        ),
    )
    inflation: float | None = Field(
        default=None,
        ge=-0.99,
        le=2.0,
        description="Per-sim inflation override; None = use config.inflation",
    )
    # Polityka wypłat w etapach realizacji:
    # - defer_tier: najpierw konta dostępne/IKE, IKZE później (zachowanie legacy),
    # - early_tier: wymuś opodatkowanie całości IKZE na starcie realizacji przed 65
    #   (netto jest reinwestowane w konto docelowe),
    # - defer_roi / early_roi: jak wyżej, ale w ramach progu podatkowego najpierw
    #   konta o niższym ROI (chroni wysokostopowe konta dłużej).
    # "auto" rozwija Asystent; samo simulate() traktuje je jak defer_tier.
    withdrawal_policy: Literal[
        "auto", "defer_tier", "early_tier", "defer_roi", "early_roi"
    ] = "defer_tier"
    # Kredyt hipoteczny (mieszkanie własne): miesięczna rata i wiek końca spłaty.
    mortgage_monthly: float = Field(default=0.0, ge=0.0, le=1e7)
    mortgage_end_age: int | None = Field(default=None, ge=0, le=120)
    config: TaxConfig = Field(default_factory=default_config)


class YearResult(BaseModel):
    age: int
    stage_name: str
    balances: dict[str, float] = Field(default_factory=dict)
    total_wealth: float = 0.0
    annual_withdrawal: float = 0.0
    monthly_withdrawal: float = 0.0
    zus_monthly: float = 0.0
    tax_paid: float = 0.0
    # Składka zdrowotna (9%) od emerytury ZUS — nie jest podatkiem, ale
    # pomniejsza kwotę „na rękę”.
    health_paid: float = 0.0
    # Przepływy per konto — do prezentacji wypłat z kont (Gantt/tabela).
    withdrawals: dict[str, float] = Field(default_factory=dict)
    taxes: dict[str, float] = Field(default_factory=dict)
    health: dict[str, float] = Field(default_factory=dict)
    ending_balances: dict[str, float] = Field(default_factory=dict)
    early_return_tax_by_account: dict[str, float] = Field(default_factory=dict)


class SimulationResult(BaseModel):
    years: list[YearResult]
    accounts: list[str] = Field(default_factory=list)
    account_labels: dict[str, str] = Field(default_factory=dict)
    final_wealth: float
    peak_wealth: float
    total_withdrawn: float
    total_tax: float
    total_health: float = 0.0
    # Wcześniejszy zwrot IKZE: netto po podatku i jego reinwestycja.
    early_return_total: float = 0.0
    early_return_tax_total: float = 0.0
    early_return_allocations: dict[str, float] = Field(default_factory=dict)
    # Podatek, który zostałby zapłacony przy likwidacji wszystkich sald na
    # koniec planu (IKZE 10% po 65 r.ż., skala przed; IKE 0%; broker 19% od zysku).
    exit_tax: float = 0.0
    final_wealth_net: float = 0.0
    # Suma ulg IKZE (dodatnia), żeby nie mylić jej z ujemnym „total_tax".
    total_tax_refund: float = 0.0
    # Rozbicie zwrotu IKZE po kontach docelowych (np. {"ike": 11304, "broker": 7896}).
    ikze_refund_allocations: dict[str, float] = Field(default_factory=dict)
    has_pension: bool = False
    warnings: list[str] = Field(default_factory=list)
