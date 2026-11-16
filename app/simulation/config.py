from typing import Literal

from pydantic import BaseModel, Field, model_validator

ACCOUNT_LABELS = {
    "broker": "Broker",
    "gotowka": "Gotówka",
    "ike": "IKE",
    "ikze": "IKZE",
    "krypto": "Krypto",
    "lokata": "Lokata",
    "nieruchomosc": "Nieruchomość",
    "obligacje": "Obligacje",
    "oipe": "OIPE",
    "oki_inw": "OKI inwestycyjne",
    "oki_osk": "OKI oszczędnościowe",
    "ppe": "PPE",
    "ppk": "PPK",
    "zus": "ZUS (emerytura)",
}

# Konta, których można mieć wiele niezależnych instancji (np. lokata:2, broker:2).
MULTI_INSTANCE_ACCOUNTS = (
    "broker",
    "lokata",
    "obligacje",
    "krypto",
    "gotowka",
    "nieruchomosc",
)


def base_account_key(name: str) -> str:
    """Zwraca bazowy typ konta (np. 'lokata' dla 'lokata:2', 'zus:ofe' bez zmian)."""
    if name == "zus:ofe":
        return "zus:ofe"
    return name.split(":", 1)[0]


def account_display_label(name: str, custom_name: str = "") -> str:
    """Czytelna etykieta konta uwzględniająca nazwę własną oraz numer instancji."""
    if custom_name and custom_name.strip():
        return custom_name.strip()
    if name in ACCOUNT_LABELS:
        return ACCOUNT_LABELS[name]
    base = base_account_key(name)
    if base in ACCOUNT_LABELS and ":" in name:
        suffix = name.split(":", 1)[1]
        return f"{ACCOUNT_LABELS[base]} #{suffix}"
    return ACCOUNT_LABELS.get(base, name)


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
    tax_periodic: bool = False  # tax deducted during accumulation on each interval
    min_withdrawal_age: int = 0
    early_tax_model: str = "none"
    early_tax_rate: float = 0.0
    early_tax_basis: str = "full"  # "gains" | "full" (tylko dla "flat")
    asset_tax_rate: float = 0.0
    asset_exemption: float = 0.0
    asset_group: str | None = None  # accounts with the same asset_group share a common limit
    asset_class: str | None = None  # "inwestycyjne" | "oszczednosciowe" w ramach grupy
    risk_class: str = "market"  # safe | market | high | wrapper | illiquid
    default_roi: float = 0.04  # domyślna realna stopa zwrotu (ponad inflacją)


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
        "broker": AccountRules(
            tax_model="flat", tax_rate=0.19, risk_class="market", default_roi=0.035
        ),
        "krypto": AccountRules(
            tax_model="flat", tax_rate=0.19, risk_class="high", default_roi=0.0
        ),
        "lokata": AccountRules(
            tax_model="flat", tax_rate=0.19, tax_periodic=True,
            risk_class="safe", default_roi=0.01
        ),
        "obligacje": AccountRules(
            tax_model="flat", tax_rate=0.19, risk_class="safe", default_roi=0.015
        ),
        "gotowka": AccountRules(tax_model="none", risk_class="safe", default_roi=0.0),
        "ike": AccountRules(
            tax_model="flat",
            tax_rate=0.0,
            tax_basis="gains",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
            early_tax_basis="gains",
            risk_class="wrapper",
            default_roi=0.035,
        ),
        "ikze": AccountRules(
            tax_model="flat",
            tax_rate=0.10,
            tax_basis="full",
            min_withdrawal_age=65,
            early_tax_model="scale",
            risk_class="wrapper",
            default_roi=0.035,
        ),
        "ppk": AccountRules(
            tax_model="none",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
            early_tax_basis="gains",
            risk_class="wrapper",
            default_roi=0.03,
        ),
        "ppe": AccountRules(
            tax_model="none",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
            early_tax_basis="gains",
            risk_class="wrapper",
            default_roi=0.03,
        ),
        "oipe": AccountRules(
            tax_model="flat",
            tax_rate=0.0,
            tax_basis="gains",
            min_withdrawal_age=60,
            early_tax_model="flat",
            early_tax_rate=0.19,
            early_tax_basis="gains",
            risk_class="wrapper",
            default_roi=0.035,
        ),
        "oki_inw": AccountRules(
            tax_model="assets",
            asset_tax_rate=0.0085,
            asset_exemption=100_000,
            asset_group="oki",
            asset_class="inwestycyjne",
            risk_class="market",
            default_roi=0.03,
        ),
        "oki_osk": AccountRules(
            tax_model="assets",
            asset_tax_rate=0.0085,
            asset_exemption=25_000,
            asset_group="oki",
            asset_class="oszczednosciowe",
            risk_class="safe",
            default_roi=0.01,
        ),
        "zus": AccountRules(tax_model="scale", risk_class="wrapper", default_roi=0.03),
        "nieruchomosc": AccountRules(
            tax_model="none", risk_class="illiquid", default_roi=0.01
        ),
    }


class ZusConfig(BaseModel):
    """Pension system parameters (ZUS).

    Pension contribution: 19.52% of base (employee + employer); for OFE
    members, 2.92 pp goes to OFE, the remainder (16.6 pp) is indexed in ZUS.
    limit_base_annual = 30 × projected average salary (0 = no limit).
    """

    skladka_rate: float = 0.1952
    employee_rate: float = 0.1371
    ofe_rate: float = 0.0292
    limit_base_annual: float = 270_000
    waloryzacja_skladek: float = 0.02
    waloryzacja_swiadczenia: float = 0.01
    wiek_emerytalny_k: int = 60
    wiek_emerytalny_m: int = 65
    min_emerytura: float = 2_000
    b2b_base_monthly: float = 5_652.0


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

    employer_pct: float = Field(default=0.035, ge=0.0, le=0.07)
    max_employer_pct: float = 0.07


class LongevityConfig(BaseModel):
    """Assumed annual improvement in remaining life expectancy.

    ``growth_months_per_year`` is the number of months added to the 2026 GUS
    life-expectancy table for each calendar year after 2026. It is used both
    for the ZUS capital-to-pension conversion (future SDTZ table) and for the
    default FIRE horizon in the wizard (cohort approximation).
    """

    growth_months_per_year: float = Field(default=1.5, ge=0.0, le=5.0)


class RiskProfile(BaseModel):
    """Limity koncentracji nowych wpłat dla profilu ryzyka.

    Procenty odnoszą się do miesięcznej puli wpłat (nie do istniejącego
    portfela). ``max_market`` i ``max_crypto`` dotyczą całej puli — także
    rynkowych wariantów IKE/IKZE/OIPE — a ``max_single_taxable`` tylko kont
    taxable. ``min_safe`` liczy bezpieczne aktywa w całej puli, w tym
    bezpieczne warianty wrapperów.
    """

    label: str
    max_crypto: float = Field(default=0.05, ge=0.0, le=1.0)
    max_market: float = Field(default=0.55, ge=0.0, le=1.0)
    max_single_taxable: float = Field(default=0.35, ge=0.0, le=1.0)
    min_safe: float = Field(default=0.20, ge=0.0, le=1.0)

    @model_validator(mode="before")
    @classmethod
    def _alias_old_market_key(cls, data):
        # Stare configi miały max_taxable_market; po zmianie semantyki to
        # pole oznacza łączny udział rynkowy (w tym wrapperów).
        if isinstance(data, dict) and "max_market" not in data and "max_taxable_market" in data:
            data = dict(data)
            data["max_market"] = data.pop("max_taxable_market")
        return data


def default_risk_profiles() -> dict[str, RiskProfile]:
    return {
        # Trzy punkty skali: 100% safe -> 100% market -> 70/30 market/krypto.
        "spokojny": RiskProfile(
            label="Spokojny",
            max_crypto=0.0,
            max_market=0.0,
            max_single_taxable=0.0,
            min_safe=1.0,
        ),
        "zrownowazony": RiskProfile(
            label="Rynkowy",
            max_crypto=0.0,
            max_market=1.0,
            max_single_taxable=0.50,
            min_safe=0.0,
        ),
        "dynamiczny": RiskProfile(
            label="Dynamiczny",
            max_crypto=0.30,
            max_market=0.70,
            max_single_taxable=0.50,
            min_safe=0.0,
        ),
    }


class WrapperVehicle(BaseModel):
    """Rodzaj inwestycji wewnątrz opakowania IKE/IKZE/OIPE."""

    label: str
    risk_class: Literal["safe", "market"] = "market"
    default_roi: float = Field(default=0.045, ge=-0.99, le=10.0)


WRAPPER_ACCOUNTS = ("ike", "ikze", "oipe")
WRAPPER_VEHICLE_KEYS = ("broker", "fund", "savings")


def default_wrapper_vehicles() -> dict[str, WrapperVehicle]:
    return {
        "broker": WrapperVehicle(
            label="Maklerskie", risk_class="market", default_roi=0.035
        ),
        "fund": WrapperVehicle(
            label="Funduszowe", risk_class="market", default_roi=0.03
        ),
        "savings": WrapperVehicle(
            label="Oszczędnościowe", risk_class="safe", default_roi=0.01
        ),
    }


def default_wrapper_vehicle_options() -> dict[str, list[str]]:
    return {
        "ike": ["broker", "fund", "savings"],
        "ikze": ["broker", "fund", "savings"],
        "oipe": ["fund"],
    }


class ScenarioModifier(BaseModel):
    """Delty rynkowe nakładane na globalny config dla bessy/hossy."""

    label: str = ""
    inflation_delta: float = 0.0
    prog_indexation_delta: float | None = None
    prog_indexation_full: bool = False
    zus_skladki_delta: float = 0.0
    zus_swiadczenie_delta: float = 0.0
    account_roi_deltas: dict[str, float] = Field(default_factory=dict)
    wrapper_roi_deltas: dict[str, float] = Field(default_factory=dict)


class ScenarioConfig(BaseModel):
    bear: ScenarioModifier
    bull: ScenarioModifier


def default_scenarios() -> ScenarioConfig:
    return ScenarioConfig(
        bear=ScenarioModifier(
            label="Kryzys / bessa",
            inflation_delta=0.010,
            prog_indexation_delta=-0.005,
            zus_skladki_delta=-0.010,
            zus_swiadczenie_delta=-0.010,
            account_roi_deltas={
                "broker": -0.035, "ike": -0.035, "ikze": -0.035, "oipe": -0.035,
                "ppk": -0.025, "ppe": -0.025, "oki_inw": -0.025, "oki_osk": -0.010,
                "obligacje": -0.010, "lokata": -0.010, "krypto": -0.080,
                "zus": -0.020, "nieruchomosc": -0.010,
            },
            wrapper_roi_deltas={"broker": -0.035, "fund": -0.025, "savings": -0.010},
        ),
        bull=ScenarioModifier(
            label="Hossa / optymistyczne",
            inflation_delta=-0.010,
            prog_indexation_full=True,
            zus_skladki_delta=0.005,
            zus_swiadczenie_delta=0.010,
            account_roi_deltas={
                "broker": 0.030, "ike": 0.030, "ikze": 0.030, "oipe": 0.030,
                "ppk": 0.025, "ppe": 0.025, "oki_inw": 0.030, "oki_osk": 0.015,
                "obligacje": 0.010, "lokata": 0.012, "krypto": 0.080,
                "zus": 0.020, "nieruchomosc": 0.015,
            },
            wrapper_roi_deltas={"broker": 0.030, "fund": 0.025, "savings": 0.012},
        ),
    )


class TaxConfig(BaseModel):
    year: int = 2026
    kwota_wolna: float = 30_000
    prog: float = 120_000
    rate_lower: float = 0.12
    rate_upper: float = 0.32
    # Trzy progi PIT (projekt UD458 na 2027 r.): None = stara skala 2-progowa.
    prog2: float | None = None
    rate_middle: float | None = None
    # Danina solidarnościowa od nadwyżki ponad próg (4% do 2026, projekt 5% od 2027).
    danina_prog: float = 1_000_000
    danina_rate: float = 0.04
    # Składka zdrowotna pracownika (9% podstawy po odjęciu ZUS pracownika).
    health_rate: float = 0.09
    # Limit przychodów dla 50% KUP (projekt: powiązany z progiem 130k).
    kup_50_limit: float = 120_000
    kup: float = 3600.0
    inflation: float = 0.025
    # Nominalna indeksacja progów PIT (kwota wolna, progi, KUP, próg daniny).
    # None = indeksacja równa inflacji (progi stałe realnie); 0.0 = progi
    # zamrożone nominalnie, więc realnie maleją co roku o inflację.
    prog_indexation: float | None = 0.015
    limits: Limits = Field(default_factory=Limits)
    accounts: dict[str, AccountRules] = Field(default_factory=default_account_rules)
    zus: ZusConfig = Field(default_factory=ZusConfig)
    longevity: LongevityConfig = Field(default_factory=LongevityConfig)
    ppk: PpkConfig = Field(default_factory=PpkConfig)
    ppe: PpeConfig = Field(default_factory=PpeConfig)
    risk_profiles: dict[str, RiskProfile] = Field(default_factory=default_risk_profiles)
    scenarios: ScenarioConfig = Field(default_factory=default_scenarios)
    wrapper_vehicles: dict[str, WrapperVehicle] = Field(
        default_factory=default_wrapper_vehicles
    )
    wrapper_vehicle_options: dict[str, list[str]] = Field(
        default_factory=default_wrapper_vehicle_options
    )

    @model_validator(mode="after")
    def _backfill_risk_metadata(self) -> "TaxConfig":
        if not self.risk_profiles:
            self.risk_profiles = default_risk_profiles()
        for key, profile in default_risk_profiles().items():
            self.risk_profiles.setdefault(key, profile)
        defaults = default_account_rules()
        for key, rules in self.accounts.items():
            base = defaults.get(base_account_key(key))
            if base is not None:
                rules.risk_class = base.risk_class
        defaults_vehicles = default_wrapper_vehicles()
        for key, vehicle in defaults_vehicles.items():
            if key not in self.wrapper_vehicles:
                self.wrapper_vehicles[key] = vehicle
        options = default_wrapper_vehicle_options()
        for key in WRAPPER_ACCOUNTS:
            allowed = [
                v for v in self.wrapper_vehicle_options.get(key, [])
                if v in self.wrapper_vehicles
            ]
            if not allowed:
                allowed = options[key]
            self.wrapper_vehicle_options[key] = allowed
        return self

    def threshold_factor(self, years: int = 0) -> float:
        """Realny mnożnik progów nominalnych po ``years`` latach od startu.

        Progi indeksowane stopą ``prog_indexation`` w świecie o inflacji
        ``inflation`` zmieniają się realnie o ((1+idx)/(1+infl))^lata.
        None = indeksacja równa inflacji, czyli progi stałe realnie (mnożnik 1).
        """
        if self.prog_indexation is None or years <= 0:
            return 1.0
        return ((1 + self.prog_indexation) / (1 + self.inflation)) ** years

    def scale_kwargs(self, years: int = 0) -> dict:
        """Parametry skali PIT do przekazania wprost do scale_tax().

        ``years`` — lata od startu symulacji; progi i kwota wolna są
        przeliczane na wartości realne przez ``threshold_factor``.
        """
        factor = self.threshold_factor(years)
        return {
            "kwota_wolna": self.kwota_wolna * factor,
            "prog": self.prog * factor,
            "rate_lower": self.rate_lower,
            "rate_upper": self.rate_upper,
            "prog2": None if self.prog2 is None else self.prog2 * factor,
            "rate_middle": self.rate_middle,
        }

    def danina_prog_at(self, years: int = 0) -> float:
        """Realny próg daniny solidarnościowej po ``years`` latach."""
        return self.danina_prog * self.threshold_factor(years)

    def kup_at(self, years: int = 0) -> float:
        """Realne roczne koszty uzyskania przychodu po ``years`` latach."""
        return self.kup * self.threshold_factor(years)

    def get_account_rules(self, name: str) -> AccountRules | None:
        """Zwraca reguły konta, wspierając wielokrotne instancje (np. 'lokata:2')."""
        if name in self.accounts:
            return self.accounts[name]
        return self.accounts.get(base_account_key(name))


def default_config(year: int = 2026) -> TaxConfig:
    cfg = TaxConfig(year=year)
    if year == 2027:
        cfg.prog = 130_000
        cfg.prog2 = 150_000
        cfg.rate_middle = 0.24
        cfg.danina_rate = 0.05
        cfg.kup_50_limit = 130_000
        # Oficjalne limity MRPiPS na 2027 (Monitor Polski, październik 2026).
        cfg.limits = Limits(
            ike_annual=30_099.0,
            ikze_annual=12_039.60,
            ikze_annual_self_employed=18_059.40,
            oipe_annual=30_099.0,
            ppe_additional_annual=45_148.50,
        )
        cfg.zus.limit_base_annual = 300_990.0
    return cfg


def backfill_tax_config(data: dict) -> dict:
    """Uzupełnia stare zapisane configi o pola 2027 (bez migracji SQL)."""
    defaults = TaxConfig().model_dump()
    for key, val in defaults.items():
        data.setdefault(key, val)
    return data


# Dwie bazy: 2026 i 2027. Reszta to scenariusze (delty w TaxConfig.scenarios).
BUILTIN_PRESET_YEARS: dict[str, int] = {
    "Domyślny 2026": 2026,
    "Domyślny 2027": 2027,
}


def get_builtin_preset(name: str) -> dict | None:
    year = BUILTIN_PRESET_YEARS.get(name)
    if year is None:
        return None
    return default_config(year).model_dump()
