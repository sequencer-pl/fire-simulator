from pydantic import BaseModel, Field


class AccountConfig(BaseModel):
    starting_balance: float = 0.0
    roi: float = 0.02
    annual_contribution: float = 0.0
    buffer: float = 0.0
    tax_rate: float = 0.0
    monthly_pension: float = 0.0


class StageInput(BaseModel):
    stage_type: str
    name: str = ""
    start_age: int
    end_age: int
    accounts: dict[str, AccountConfig] = Field(default_factory=dict)


class SimulationInput(BaseModel):
    stages: list[StageInput]
    max_age: int = 100


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
