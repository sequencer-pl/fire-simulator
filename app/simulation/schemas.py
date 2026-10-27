from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.simulation.config import TaxConfig, default_config


class AccountConfig(BaseModel):
    starting_balance: float = Field(default=0.0, ge=0.0, le=1e12)
    cost_basis_enabled: bool = False
    cost_basis: float | None = Field(default=None, ge=0.0, le=1e12)
    roi: float = Field(default=0.02, ge=-0.99, le=10.0)
    lokata_term_months: Literal[1, 2, 3, 4, 6, 12, 24, 36, 60] = 12
    annual_contribution: float = Field(default=0.0, ge=0.0, le=1e9)
    buffer: float = Field(default=0.0, ge=0.0, le=1e12)
    monthly_pension: float = Field(default=0.0, ge=0.0, le=1e7)
    ikze_limit: str = "etat"
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
    inflation: float | None = Field(
        default=None,
        ge=-0.99,
        le=2.0,
        description="Per-sim inflation override; None = use config.inflation",
    )
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


class SimulationResult(BaseModel):
    years: list[YearResult]
    accounts: list[str] = Field(default_factory=list)
    final_wealth: float
    peak_wealth: float
    total_withdrawn: float
    total_tax: float
    has_pension: bool = False
    warnings: list[str] = Field(default_factory=list)
