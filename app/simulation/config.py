from pydantic import BaseModel, Field

ACCOUNT_LABELS = {
    "broker": "Broker",
    "gotowka": "Gotówka",
    "ike": "IKE",
    "ikze": "IKZE",
    "krypto": "Krypto",
    "lokata": "Lokata",
    "oipe": "OIPE",
    "oki": "OKI",
    "ppe": "PPE",
    "ppk": "PPK",
    "zus": "ZUS (emerytura)",
}


class AccountRules(BaseModel):
    """Reguły podatkowe i dostępności konta (zależne od państwa/instytucji).

    Reżimy:
      - "none": brak podatku
      - "flat": podatek ryczałtowy (tax_rate) od podstawy tax_basis
      - "scale": dochód opodatkowany skalą PIT (od całości)
      - "assets": coroczny podatek od wartości aktywów (OKI) — asset_tax_rate
        od średniego stanu ponad asset_exemption; wypłaty bez Belki.

    Przed min_withdrawal_age konto wypłaca w reżimie "early_*"
    (np. IKZE przed 65 — skala; IKE przed 60 — Belka od zysku).
    """

    tax_model: str = "none"
    tax_rate: float = 0.0
    tax_basis: str = "gains"  # "gains" | "full" (tylko dla "flat")
    min_withdrawal_age: int = 0
    early_tax_model: str = "none"
    early_tax_rate: float = 0.0
    asset_tax_rate: float = 0.0
    asset_exemption: float = 0.0


class Limits(BaseModel):
    """Roczne limity wpłat (obwieszczenia MRPiPS 2026).

    oipe_annual (28 260 zł) = 3x przeciętne prognozowane wynagrodzenie (9 420 zł),
    niezależne od IKE/IKZE. ppe_additional_annual (42 390 zł) = 4,5x przeciętne
    (limit składki dodatkowej wnoszonej przez uczestnika PPE).
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
        "oki": AccountRules(
            tax_model="assets",
            asset_tax_rate=0.0085,
            asset_exemption=100_000,
        ),
        "zus": AccountRules(tax_model="scale"),
    }


class ZusConfig(BaseModel):
    """Parametry systemu emerytalnego (ZUS).

    Składka emerytalna: 19,52% podstawy (pracownik + pracodawca), dla członka
    OFE 2,92 pkt przekazywane do OFE, reszta (16,6 pkt) waloryzowana w ZUS.
    limit_base_annual = 30 x prognozowane przeciętne wynagrodzenie (0 = brak limitu).
    """

    skladka_rate: float = 0.1952
    ofe_rate: float = 0.0292
    limit_base_annual: float = 270_000
    waloryzacja_skladek: float = 0.01
    waloryzacja_swiadczenia: float = 0.01
    wiek_emerytalny: int = 65
    min_emerytura: float = 2_000


class PpkConfig(BaseModel):
    """Parametry PPK (ustawa o PPK, autozapis od 2019).

    Wpłaty podstawowe: pracownik 2%, pracodawca 1,5% podstawy (suma max 8%).
    Państwo: 250 zł powitalne (jednorazowo) + 240 zł dopłaty rocznej.
    """

    employee_pct: float = 0.02
    employer_pct: float = 0.015
    max_total_pct: float = 0.08
    state_welcoming: float = 250.0
    state_annual: float = 240.0


class PpeConfig(BaseModel):
    """Parametry PPE (ustawa o PPE).

    Składka podstawowa finansowana przez pracodawcę — max 7% wynagrodzenia.
    Składka dodatkowa uczestnika limitowana w Limits.ppe_additional_annual.
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
