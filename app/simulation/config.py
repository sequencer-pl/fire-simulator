from pydantic import BaseModel, Field

ACCOUNT_LABELS = {
    "broker": "Broker",
    "ike": "IKE",
    "ikze": "IKZE",
    "lokata": "Lokata",
    "zus": "ZUS (emerytura)",
}


class AccountRules(BaseModel):
    """Reguły podatkowe i dostępności konta (zależne od państwa/instytucji).

    Reżimy:
      - "none": brak podatku
      - "flat": podatek ryczałtowy (tax_rate) od podstawy tax_basis
      - "scale": dochód opodatkowany skalą PIT (od całości)

    Przed min_withdrawal_age konto wypłaca w reżimie "early_*"
    (np. IKZE przed 65 — skala; IKE przed 60 — Belka od zysku).
    """

    tax_model: str = "none"
    tax_rate: float = 0.0
    tax_basis: str = "gains"  # "gains" | "full" (tylko dla "flat")
    min_withdrawal_age: int = 0
    early_tax_model: str = "none"
    early_tax_rate: float = 0.0


class Limits(BaseModel):
    """Roczne limity wpłat (obwieszczenia MRPiPS)."""

    ike_annual: float = 28_260
    ikze_annual: float = 11_304
    ikze_annual_self_employed: float = 16_956


def default_account_rules() -> dict[str, AccountRules]:
    return {
        "broker": AccountRules(tax_model="flat", tax_rate=0.19),
        "lokata": AccountRules(tax_model="flat", tax_rate=0.19),
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
        "zus": AccountRules(tax_model="scale"),
    }


class TaxConfig(BaseModel):
    year: int = 2026
    kwota_wolna: float = 30_000
    prog: float = 120_000
    rate_lower: float = 0.12
    rate_upper: float = 0.32
    limits: Limits = Field(default_factory=Limits)
    accounts: dict[str, AccountRules] = Field(default_factory=default_account_rules)


def default_config() -> TaxConfig:
    return TaxConfig()
