from typing import Literal

from pydantic import BaseModel, Field

from app.simulation.config import TaxConfig, default_config


class AccountConfig(BaseModel):
    starting_balance: float = 0.0
    cost_basis_enabled: bool = False
    cost_basis: float | None = None
    roi: float = 0.02
    annual_contribution: float = 0.0
    buffer: float = 0.0
    monthly_pension: float = 0.0
    ikze_limit: str = "etat"
    monthly_base: float = 0.0
    ofe_member: bool = False
    starting_balance_ofe: float = 0.0
    waloryzacja_skladek: float | None = None
    waloryzacja_swiadczenia: float | None = None
    employee_pct: float = 0.02
    employer_pct: float = 0.015
    state_topups: bool = True
    asset_exemption: float | None = None


class StageInput(BaseModel):
    stage_type: str
    name: str = ""
    start_age: int
    end_age: int
    accounts: dict[str, AccountConfig] = Field(default_factory=dict)


class SimulationInput(BaseModel):
    stages: list[StageInput]
    max_age: int = 100
    gender: Literal["k", "m"] = "m"
    annual_income: float = 0.0
    config: TaxConfig = Field(default_factory=default_config)


class YearResult(BaseModel):
    age: int
    stage_name: str
    balances: dict[str, float] = Field(default_factory=dict)
    total_wealth: float = 0.0
    annual_withdrawal: float = 0.0
    monthly_withdrawal: float = 0.0
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
