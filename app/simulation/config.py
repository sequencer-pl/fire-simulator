from pydantic import BaseModel, Field

ACCOUNT_LABELS = {
    "broker": "Broker",
    "gotowka": "Gotówka",
    "ike": "IKE",
    "ikze": "IKZE",
    "krypto": "Krypto",
    "lokata": "Lokata",
    "obligacje": "Obligacje",
    "oipe": "OIPE",
    "oki_inw": "OKI inwestycyjne",
    "oki_osk": "OKI oszczędnościowe",
    "ppe": "PPE",
    "ppk": "PPK",
    "zus": "ZUS (emerytura)",
}


class AccountRules(BaseModel):
    """Tax and availability rules for an account (varies by country/institution).

    Regimes:
      - "none": no tax
      - "flat": flat-rate tax (tax_rate) on the tax_basis base
      - "scale": income taxed on PIT scale (on the full amount)
      - "assets": annual asset value tax (OKI) — asset_tax_rate
        on average balance above asset_exemption; withdrawals exempt from Belka.

    Before min_withdrawal_age the account withdraws under the "early_*"
    regime (e.g. IKZE before 65 — scale; IKE before 60 — Belka on gains).
    """

    tax_model: str = "none"
    tax_rate: float = 0.0
    tax_basis: str = "gains"  # "gains" | "full" (tylko dla "flat")
    min_withdrawal_age: int = 0
    early_tax_model: str = "none"
    early_tax_rate: float = 0.0
    asset_tax_rate: float = 0.0
    asset_exemption: float = 0.0
    asset_group: str | None = None  # accounts with the same asset_group share a common limit
    asset_class: str | None = None  # "inwestycyjne" | "oszczednosciowe" w ramach grupy


class Limits(BaseModel):
    """Annual contribution limits (MRPiPS announcement 2026).

    oipe_annual (28,260 PLN) = 3× projected average salary (9,420 PLN),
    independent of IKE/IKZE. ppe_additional_annual (42,390 PLN) = 4.5× average
    (limit for additional contributions by PPE participants).
    """

    ike_annual: float = 28_260
    ikze_annual: float = 11_304
    ikze_annual_self_employed: float = 16_956
    oipe_annual: float = 28_260
    ppe_additional_annual: float = 42_390


def default_account_rules() -> dict[str, AccountRules]:
    return {
        "broker": AccountRules(tax_model="flat", tax_rate=0.19),
        "krypto": AccountRules(tax_model="flat", tax_rate=0.19),
        "lokata": AccountRules(tax_model="flat", tax_rate=0.19),
        "obligacje": AccountRules(tax_model="flat", tax_rate=0.19),
        "gotowka": AccountRules(tax_model="none"),
        "ike": AccountRules(
            tax_model="flat",
            tax_rate=0.0,
            tax_basis="gains",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
        ),
        "ikze": AccountRules(
            tax_model="flat",
            tax_rate=0.10,
            tax_basis="full",
            min_withdrawal_age=65,
            early_tax_model="scale",
        ),
        "ppk": AccountRules(
            tax_model="none",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
        ),
        "ppe": AccountRules(
            tax_model="none",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
        ),
        "oipe": AccountRules(
            tax_model="flat",
            tax_rate=0.0,
            tax_basis="gains",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
        ),
        "oki_inw": AccountRules(
            tax_model="assets",
            asset_tax_rate=0.0085,
            asset_exemption=100_000,
            asset_group="oki",
            asset_class="inwestycyjne",
        ),
        "oki_osk": AccountRules(
            tax_model="assets",
            asset_tax_rate=0.0085,
            asset_exemption=25_000,
            asset_group="oki",
            asset_class="oszczednosciowe",
        ),
        "zus": AccountRules(tax_model="scale"),
    }


class ZusConfig(BaseModel):
    """Pension system parameters (ZUS).

    Pension contribution: 19.52% of base (employee + employer); for OFE
    members, 2.92 pp goes to OFE, the remainder (16.6 pp) is indexed in ZUS.
    limit_base_annual = 30 × projected average salary (0 = no limit).
    """

    skladka_rate: float = 0.1952
    ofe_rate: float = 0.0292
    limit_base_annual: float = 270_000
    waloryzacja_skladek: float = 0.01
    waloryzacja_swiadczenia: float = 0.01
    wiek_emerytalny_k: int = 60
    wiek_emerytalny_m: int = 65
    min_emerytura: float = 2_000


class PpkConfig(BaseModel):
    """PPK parameters (PPK Act, auto-enrolment since 2019).

    Base contributions: employee 2%, employer 1.5% of base (total max 8%).
    State: 250 PLN welcoming payment (one-time) + 240 PLN annual top-up.
    """

    employee_pct: float = 0.02
    employer_pct: float = 0.015
    max_total_pct: float = 0.08
    state_welcoming: float = 250.0
    state_annual: float = 240.0


class PpeConfig(BaseModel):
    """PPE parameters (PPE Act).

    Base contribution funded by the employer — max 7% of salary.
    Participant's additional contribution capped at Limits.ppe_additional_annual.
    """

    max_employer_pct: float = 0.07


class TaxConfig(BaseModel):
    year: int = 2026
    kwota_wolna: float = 30_000
    prog: float = 120_000
    rate_lower: float = 0.12
    rate_upper: float = 0.32
    limits: Limits = Field(default_factory=Limits)
    accounts: dict[str, AccountRules] = Field(default_factory=default_account_rules)
    zus: ZusConfig = Field(default_factory=ZusConfig)
    ppk: PpkConfig = Field(default_factory=PpkConfig)
    ppe: PpeConfig = Field(default_factory=PpeConfig)


def default_config() -> TaxConfig:
    return TaxConfig()
