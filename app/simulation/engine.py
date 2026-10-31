from copy import deepcopy
from dataclasses import dataclass, field

from app.core.base import resolve_base
from app.core.inflation import cumulative_factor, deflate, fisher_nominal
from app.core.roi import effective_roi, periodic_net_roi
from app.core.tax import danina_solidarnosciowa, scale_tax
from app.simulation.config import ACCOUNT_LABELS, AccountRules, TaxConfig
from app.simulation.constants import DEFAULT_ROI, MONTHS_PER_YEAR, PPE_ZUS_FRACTION
from app.simulation.schemas import (
    SimulationInput,
    SimulationResult,
    StageInput,
    YearResult,
)
from app.simulation.zus import (
    _accumulate_zus,
    _convert_zus,
    _estimate_zus_pension,
    _pension_age,
)
from app.stages.registry import create_stage


@dataclass
class SimulationState:
    config: TaxConfig
    balances: dict[str, float] = field(default_factory=dict)
    basis: dict[str, float] = field(default_factory=dict)
    basis_employee: dict[str, float] = field(default_factory=dict)
    account_rois: dict[str, float] = field(default_factory=dict)
    asset_exemptions: dict[str, float] = field(default_factory=dict)
    all_accounts: set[str] = field(default_factory=set)
    computed: dict[int, dict] = field(default_factory=dict)
    early_returned: set[str] = field(default_factory=set)
    forfeited: set[str] = field(default_factory=set)
    zus_pensions: dict[str, float] = field(default_factory=dict)
    welcomed_ppk: set[str] = field(default_factory=set)
    start_age: int = 0
    basis_vintages: dict[str, list[tuple[int, float]]] = field(default_factory=dict)
    lokata_interest_nom: dict[str, float] = field(default_factory=dict)
    ikze_refund_total: float = 0.0
    ikze_refund_unallocated: float = 0.0
    ikze_refund_allocations: dict[str, float] = field(default_factory=dict)

    def __iter__(self):
        yield self.config
        yield self.balances
        yield self.basis
        yield self.basis_employee
        yield self.account_rois
        yield self.asset_exemptions
        yield self.all_accounts
        yield self.computed
        yield self.early_returned
        yield self.forfeited
        yield self.zus_pensions
        yield self.welcomed_ppk
        yield self.start_age
        yield self.basis_vintages
        yield self.lokata_interest_nom


def _compute_ikze_tax_saving(
    ikze_contribution: float,
    annual_income: float,
    config: TaxConfig,
) -> float:
    """Tax saving from IKZE contribution (odliczenie od dochodu).

    Compares PIT on full income vs income reduced by the IKZE contribution.
    """
    if ikze_contribution <= 0 or annual_income <= 0:
        return 0.0
    tax_without = scale_tax(annual_income, **config.scale_kwargs())
    tax_with = scale_tax(max(0.0, annual_income - ikze_contribution), **config.scale_kwargs())
    return max(0.0, tax_without - tax_with)


_resolve_base = resolve_base


def _compute_monthly_gross_dochod(monthly_gross: float, config: TaxConfig) -> float:
    """Annual dochód (after ZUS contributions and KUP) from monthly gross."""
    annual = monthly_gross * MONTHS_PER_YEAR
    skladki = annual * config.zus.skladka_rate
    kup = config.kup
    return max(0.0, annual - skladki - kup)


def _validate_stage_order(stages: list[StageInput]) -> None:
    """The realization stage cannot start before the end of the last accumulation stage."""
    akum_end = max(
        (s.end_age for s in stages if s.stage_type == "akumulacja"),
        default=None,
    )
    real_start = min(
        (s.start_age for s in stages if s.stage_type == "realizacja"),
        default=None,
    )
    if akum_end is not None and real_start is not None and real_start < akum_end:
        raise ValueError(
            f"Etap realizacji (od {real_start} r.ż.) nie może zaczynać się "
            f"przed końcem etapu akumulacji ({akum_end} r.ż.)."
        )


def _validate_roi(data: SimulationInput) -> None:
    """ROI must be greater than -100% (lower values break growth and PMT calculations)."""
    eff_infl = data.inflation if data.inflation is not None else data.config.inflation
    for si in data.stages:
        for name, cfg in si.accounts.items():
            roi = -eff_infl if name == "gotowka" else cfg.roi
            if roi <= -1:
                raise ValueError(
                    f"ROI konta {ACCOUNT_LABELS.get(name, name)} nie może być mniejsze "
                    f"lub równe -100% (otrzymano {roi * 100:.0f}%)."
                )


def _init_state(data: SimulationInput) -> SimulationState:
    eff_inflation = data.inflation if data.inflation is not None else data.config.inflation
    config = data.config.model_copy(update={"inflation": eff_inflation})
    balances: dict[str, float] = {}
    basis: dict[str, float] = {}
    basis_employee: dict[str, float] = {}
    account_rois: dict[str, float] = {}
    asset_exemptions: dict[str, float] = {}
    all_accounts: set[str] = set()

    # Initialize balances and ROI independent of stage order
    # (earliest chronological stage defines starting balance)
    for stage_input in sorted(data.stages, key=lambda s: s.start_age):
        all_accounts.update(stage_input.accounts.keys())
        for name, cfg in stage_input.accounts.items():
            if name == "gotowka":
                account_rois[name] = -config.inflation
            elif name != "zus" or stage_input.stage_type == "akumulacja":
                account_rois[name] = cfg.roi
            if cfg.asset_exemption is not None:
                asset_exemptions[name] = cfg.asset_exemption
            if cfg.starting_balance > 0:
                balances.setdefault(name, cfg.starting_balance)
                initial_basis = cfg.starting_balance
                if cfg.cost_basis_enabled and cfg.cost_basis is not None:
                    initial_basis = cfg.cost_basis
                basis.setdefault(name, initial_basis)
                if name == "ppk":
                    basis_employee.setdefault(name, cfg.starting_balance)
            if name == "zus" and cfg.starting_balance_ofe > 0 and cfg.ofe_member:
                balances.setdefault("zus:ofe", cfg.starting_balance_ofe)

    computed: dict[int, dict] = {}
    early_returned: set[str] = set()
    forfeited: set[str] = set()
    zus_pensions: dict[str, float] = {}
    welcomed_ppk: set[str] = set()
    start_age = min((s.start_age for s in data.stages), default=0)
    basis_vintages: dict[str, list[tuple[int, float]]] = {}
    for stage_input in sorted(data.stages, key=lambda s: s.start_age):
        for name, cfg in stage_input.accounts.items():
            if cfg.starting_balance > 0 and name not in basis_vintages:
                initial_basis = cfg.starting_balance
                if cfg.cost_basis_enabled and cfg.cost_basis is not None:
                    initial_basis = cfg.cost_basis
                basis_vintages.setdefault(name, []).append((stage_input.start_age, initial_basis))
            if (
                name == "zus"
                and cfg.starting_balance_ofe > 0
                and cfg.ofe_member
                and "zus:ofe" not in basis_vintages
            ):
                basis_vintages.setdefault("zus:ofe", []).append(
                    (stage_input.start_age, cfg.starting_balance_ofe)
                )

    return SimulationState(
        config=config,
        balances=balances,
        basis=basis,
        basis_employee=basis_employee,
        account_rois=account_rois,
        asset_exemptions=asset_exemptions,
        all_accounts=all_accounts,
        computed=computed,
        early_returned=early_returned,
        forfeited=forfeited,
        zus_pensions=zus_pensions,
        welcomed_ppk=welcomed_ppk,
        start_age=start_age,
        basis_vintages=basis_vintages,
    )


def _process_ikze_returns(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float] | None = None,
    config: TaxConfig | None = None,
    early_returned: set[str] | None = None,
    zus_pension: float = 0.0,
    state: SimulationState | None = None,
    target: float | None = None,
) -> tuple[dict[str, float], set[str]]:
    if state is not None:
        balances = state.balances
        config = state.config
        early_returned = state.early_returned
    assert balances is not None and config is not None and early_returned is not None
    # One-time IKZE early return before qualifying age (e.g. 65):
    # Combined scale tax on IKZE balance + ZUS pension for the year,
    # prorated proportionally. IKZE share is deducted from capital
    # before PMT, so installments are based on net capital.
    ikze_accounts: list[tuple[str, float]] = []
    for si in active_stages:
        if si.stage_type != "realizacja":
            continue
        stage_target = target if target is not None else si.withdrawal_target_gross_monthly
        is_const_target = (
            "zus" not in si.accounts and stage_target is not None and stage_target > 0
        )
        if not is_const_target and age != si.start_age:
            continue
        if is_const_target:
            assert stage_target is not None
            desired = max(0.0, stage_target * MONTHS_PER_YEAR - zus_pension)
            prior_bal = 0.0
            for a in si.accounts:
                if a == "zus":
                    continue
                r = config.accounts.get(a)
                if (
                    not r
                    or r.min_withdrawal_age <= 0
                    or age >= r.min_withdrawal_age
                    or a in early_returned
                    or r.early_tax_model != "scale"
                ):
                    prior_bal += max(0.0, balances.get(a, 0.0))
            if prior_bal >= desired - 1e-6:
                continue
        for acc in si.accounts:
            rules = config.accounts.get(acc)
            if (
                acc in early_returned
                or not rules
                or rules.min_withdrawal_age <= 0
                or age >= rules.min_withdrawal_age
                or rules.early_tax_model != "scale"
            ):
                continue
            ikze_accounts.append((acc, balances.get(acc, 0.0)))

    if not ikze_accounts:
        return {}, set()

    total_ikze = sum(bal for _, bal in ikze_accounts)
    combined = total_ikze + zus_pension
    combined_tax = scale_tax(combined, **config.scale_kwargs())
    combined_tax += danina_solidarnosciowa(
        combined,
        danina_prog=config.danina_prog,
        danina_rate=config.danina_rate,
    )

    early_return_tax: dict[str, float] = {}
    handled_scale: set[str] = set()

    for acc, bal in ikze_accounts:
        share = combined_tax * (bal / combined) if combined > 0 else 0.0
        early_return_tax[acc] = share
        balances[acc] = max(0.0, bal - share)
        early_returned.add(acc)

    if zus_pension > 0:
        zus_share = combined_tax * (zus_pension / combined) if combined > 0 else 0.0
        early_return_tax["zus"] = zus_share
        handled_scale.add("zus")

    return early_return_tax, handled_scale


def _process_ppk_forfeits(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float] | None = None,
    basis: dict[str, float] | None = None,
    basis_employee: dict[str, float] | None = None,
    config: TaxConfig | None = None,
    forfeited: set[str] | None = None,
    year_start_balances: dict[str, float] | None = None,
    state: SimulationState | None = None,
    target: float | None = None,
    zus_pension: float = 0.0,
) -> None:
    if state is not None:
        balances = state.balances
        basis = state.basis
        basis_employee = state.basis_employee
        config = state.config
        forfeited = state.forfeited
    assert (
        balances is not None
        and basis is not None
        and basis_employee is not None
        and config is not None
        and forfeited is not None
        and year_start_balances is not None
    )
    # PPK: employer and state contribution forfeit on early withdrawal before age 60.
    for si in active_stages:
        if si.stage_type != "realizacja":
            continue
        stage_target = target if target is not None else si.withdrawal_target_gross_monthly
        is_const_target = (
            "zus" not in si.accounts and stage_target is not None and stage_target > 0
        )
        if not is_const_target and age != si.start_age:
            continue
        if is_const_target:
            assert stage_target is not None
            desired = max(0.0, stage_target * MONTHS_PER_YEAR - zus_pension)
            early_ret = state.early_returned if state is not None else set()
            unlocked_bal = 0.0
            for a in si.accounts:
                if a == "zus":
                    continue
                r = config.accounts.get(a)
                if (
                    not r
                    or r.min_withdrawal_age <= 0
                    or age >= r.min_withdrawal_age
                    or a in early_ret
                ):
                    unlocked_bal += max(0.0, balances.get(a, 0.0))
            if unlocked_bal >= desired - 1e-6:
                continue
        for acc in si.accounts:
            rules = config.accounts.get(acc)
            if (
                acc != "ppk"
                or acc in forfeited
                or not rules
                or rules.min_withdrawal_age <= 0
                or age >= rules.min_withdrawal_age
            ):
                continue
            total_basis = basis.get(acc, 0.0)
            emp_basis = basis_employee.get(acc, 0.0)
            if total_basis > 0 and emp_basis < total_basis:
                bal = balances.get(acc, 0.0)
                fraction = emp_basis / total_basis
                forfeited_amount = bal * (1.0 - fraction)
                balances[acc] = max(0.0, bal - forfeited_amount)
                basis[acc] = total_basis * fraction
                if state is not None and acc in state.basis_vintages:
                    state.basis_vintages[acc] = [
                        (v_age, v_amt * fraction)
                        for v_age, v_amt in state.basis_vintages[acc]
                    ]
                year_start_balances[acc] = balances[acc]
                forfeited.add(acc)


def _process_stages(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float] | None = None,
    basis: dict[str, float] | None = None,
    basis_employee: dict[str, float] | None = None,
    config: TaxConfig | None = None,
    account_rois: dict[str, float] | None = None,
    processed_accounts: set[str] | None = None,
    zus_pensions: dict[str, float] | None = None,
    welcomed_ppk: set[str] | None = None,
    monthly_gross: float = 0.0,
    state: SimulationState | None = None,
    target: float | None = None,
    zus_pension: float = 0.0,
) -> tuple[dict[str, float], list[str], dict[str, float]]:
    if state is not None:
        balances = state.balances
        basis = state.basis
        basis_employee = state.basis_employee
        config = state.config
        account_rois = state.account_rois
        zus_pensions = state.zus_pensions
        welcomed_ppk = state.welcomed_ppk
    assert (
        balances is not None
        and basis is not None
        and basis_employee is not None
        and config is not None
        and account_rois is not None
        and processed_accounts is not None
        and zus_pensions is not None
        and welcomed_ppk is not None
    )
    merged_withdrawal: dict[str, float] = {}
    periodic_tax: dict[str, float] = {}
    stage_label_parts: list[str] = []
    seen_labels: set[str] = set()
    zus_handled = False

    for stage_input in active_stages:
        stage_obj = create_stage(stage_input.stage_type)
        accounts_config = {name: cfg.model_dump() for name, cfg in stage_input.accounts.items()}
        for n, c in accounts_config.items():
            if n == "gotowka":
                c["roi"] = -config.inflation
            acc_rules = config.accounts.get(n)
            if acc_rules:
                c["min_withdrawal_age"] = acc_rules.min_withdrawal_age
                c["early_tax_model"] = acc_rules.early_tax_model
                c["early_returned"] = n in (
                    state.early_returned if state is not None else set()
                )

        # Constant-target withdrawal for non-ZUS realization stages (wizard FIRE
        # model): the portfolio pays out a fixed monthly amount, reduced by the
        # ZUS pension once it kicks in, instead of annuitizing to zero via PMT.
        stage_target = target if target is not None else stage_input.withdrawal_target_gross_monthly
        desired_withdrawal: float | None = None
        if (
            stage_input.stage_type == "realizacja"
            and "zus" not in accounts_config
            and stage_target is not None
            and stage_target > 0
        ):
            desired_withdrawal = max(0.0, stage_target * MONTHS_PER_YEAR - zus_pension)

        # ZUS — contributions and capital indexation (accumulation) plus capital
        # conversion to pension (realization) are handled by the engine because
        # they differ from regular accounts (indexation instead of ROI, ŚDTŻ instead of PMT).
        if "zus" in accounts_config and not zus_handled:
            if stage_input.stage_type == "akumulacja":
                _accumulate_zus(accounts_config["zus"], balances, config, monthly_gross)
                processed_accounts.add("zus")
                if accounts_config["zus"].get("ofe_member"):
                    processed_accounts.add("zus:ofe")
            else:
                _convert_zus(
                    zus_pensions=zus_pensions,
                    age=age,
                    start_age=stage_input.start_age,
                    accounts_config=accounts_config,
                    balances=balances,
                    config=config,
                )
            zus_handled = True

        # PPK / PPE — percentage contributions from base (accumulation).
        # Withdrawals go through generic RealizacjaStage (like IKE).
        if stage_input.stage_type == "akumulacja":
            if "ppk" in accounts_config:
                _accumulate_ppk(
                    accounts_config["ppk"],
                    balances,
                    basis,
                    basis_employee,
                    config,
                    welcomed_ppk,
                    monthly_gross,
                    age=age,
                    state=state,
                )
                processed_accounts.add("ppk")
            if "ppe" in accounts_config:
                _accumulate_ppe(
                    accounts_config["ppe"],
                    balances,
                    basis,
                    config,
                    monthly_gross,
                    age=age,
                    state=state,
                )
                processed_accounts.add("ppe")

        # Periodic-tax accounts (lokata) — Belka deducted on each term.
        # During accumulation growth is net-of-tax, computed here (like ZUS).
        # During realization the ROI is replaced by the net rate so the money
        # keeps growing after tax; _apply_tax skips such accounts entirely.
        for name in list(accounts_config.keys()):
            rules = config.accounts.get(name)
            if not rules or not rules.tax_periodic:
                continue
            if stage_input.stage_type == "akumulacja":
                periodic_tax[name] = _accumulate_periodic(
                    name,
                    accounts_config[name],
                    balances,
                    config,
                    age,
                    state.start_age if state is not None else None,
                    state,
                )
                processed_accounts.add(name)
                accounts_config.pop(name)
            else:
                accounts_config[name]["roi"] = _periodic_net_roi(
                    name, rules, accounts_config[name], config.inflation
                )

        accounts_to_process = {
            name: cfg for name, cfg in accounts_config.items() if name not in processed_accounts
        }

        if not accounts_to_process:
            continue

        kwargs: dict = {}
        if desired_withdrawal is not None:
            kwargs["desired_withdrawal"] = desired_withdrawal
        result = stage_obj.calculate_year(
            age=age,
            end_age=stage_input.end_age,
            balances=balances,
            config=accounts_to_process,
            **kwargs,
        )

        for k, v in result["withdrawal"].items():
            merged_withdrawal[k] = merged_withdrawal.get(k, 0) + v

        balances.update(result["balances"])
        processed_accounts.update(accounts_to_process.keys())

        if stage_input.stage_type == "akumulacja":
            for name, cfg in accounts_to_process.items():
                contrib = cfg.get("annual_contribution", 0.0)
                if contrib:
                    basis[name] = basis.get(name, 0.0) + contrib
                    if state is not None:
                        state.basis_vintages.setdefault(name, []).append((age, contrib))

        label = stage_input.name or stage_obj.name
        if label not in seen_labels:
            stage_label_parts.append(label)
            seen_labels.add(label)

    return merged_withdrawal, stage_label_parts, periodic_tax


def _accumulate_periodic(
    name: str,
    cfg: dict,
    balances: dict[str, float],
    config: TaxConfig,
    age: int | None = None,
    start_age: int | None = None,
    state: SimulationState | None = None,
) -> float:
    """Accumulate an account whose gains are taxed every term (lokata).

    ROI is REAL brutto (przed Belką) w dzisiejszych zł. Silnik przelicza je
    Fisherem na nominalne brutto, pobiera Belkę co okres i wraca do realnych
    złotych. Dzięki temu ROI znaczy to samo co na pozostałych kontach.

    Dla terminów dłuższych niż 12 mies. odsetki kapitalizują się rocznie na
    brutto, a Belka pobierana jest dopiero na koniec okresu (co term_months
    mies.). Odroczenie Belki daje realną przewagę (efekt kapitalizacji na
    brutto), dlatego dłuższe lokaty dają wyższy saldo przy tym samym ROI.
    """
    rules = config.accounts.get(name)
    tax_rate = rules.tax_rate if rules else 0.0
    balance = balances.get(name, 0.0)
    roi_real = effective_roi(name, cfg.get("roi", DEFAULT_ROI))
    contribution = cfg.get("annual_contribution", 0.0)
    inflation = getattr(config, "inflation", 0.0) or 0.0
    term_months = max(1, int(cfg.get("lokata_term_months", 12)))

    if roi_real <= 0:
        balances[name] = balance * (1 + roi_real) + contribution
        return 0.0

    if term_months > 12:
        return _accumulate_periodic_multi_year(
            name, cfg, balances, config, roi_real, tax_rate, term_months, age, start_age, state
        )

    intervals = MONTHS_PER_YEAR / term_months
    nominal_gross_annual = fisher_nominal(roi_real, inflation)
    if nominal_gross_annual <= -1:
        balances[name] = balance * (1 + roi_real) + contribution
        return 0.0
    gross_per_interval = (1 + nominal_gross_annual) ** (1 / intervals) - 1
    if gross_per_interval > 1:
        balances[name] = balance * (1 + roi_real) + contribution
        return 0.0

    if age is not None and start_age is not None:
        factor_start = cumulative_factor(inflation, age - start_age)
        factor_end = cumulative_factor(inflation, age - start_age + 1)
    else:
        factor_start = 1.0
        factor_end = 1 + inflation
    b_nom = balance * factor_start
    tax_nom = 0.0
    for _ in range(int(intervals)):
        interest_nom = b_nom * gross_per_interval
        if interest_nom > 0:
            tax_nom += interest_nom * tax_rate
            b_nom += interest_nom * (1 - tax_rate)
        else:
            b_nom += interest_nom
    b_nom += contribution * factor_end
    balances[name] = b_nom / factor_end
    return tax_nom / factor_end if factor_end else tax_nom


def _periodic_net_roi(
    name: str, rules: AccountRules, cfg: dict, inflation: float = 0.0
) -> float:
    return periodic_net_roi(
        name,
        rules.tax_rate,
        cfg.get("roi", DEFAULT_ROI),
        cfg.get("lokata_term_months", 12),
        inflation,
    )


def _accumulate_periodic_multi_year(
    name: str,
    cfg: dict,
    balances: dict[str, float],
    config: TaxConfig,
    roi_real: float,
    tax_rate: float,
    term_months: int,
    age: int | None,
    start_age: int | None,
    state: SimulationState | None,
) -> float:
    """Multi-year lokata (term > 12 mies.): Belka only at term end.

    Lokata wieloletnia to jeden stały depozyt. Odsetki kapitalizują się
    corocznie na STAWCE BRUTTO (bez odejmowania Belki), a Belka pobierana
    jest dopiero na koniec okresu (co term_months mies.). Dzięki temu
    dłuższy termin = rzadsza Belka = realnie wyższe saldo przy tym samym
    realnym ROI (efekt odroczenia podatku / kapitalizacji na brutto).

    ROI jest realny brutto (przed Belką); silnik przelicza go Fisherem na
    nominalne brutto, kapitalizuje odsetki i pobiera Belkę na koniec okresu.
    """
    term_years = max(2, term_months // 12)
    contribution = cfg.get("annual_contribution", 0.0)
    inflation = getattr(config, "inflation", 0.0) or 0.0

    gross_annual = fisher_nominal(roi_real, inflation)
    if gross_annual <= -1 or gross_annual > 1:
        balances[name] = balances.get(name, 0.0) * (1 + roi_real) + contribution
        return 0.0

    factor_start = 1.0
    factor_end = 1 + inflation
    is_maturity = True
    if state is not None and age is not None and start_age is not None:
        factor_start = cumulative_factor(inflation, age - start_age)
        factor_end = cumulative_factor(inflation, age - start_age + 1)
        position = (age - start_age) % term_years
        is_maturity = position == term_years - 1

    b_nom = balances.get(name, 0.0) * factor_start
    interest_nom = state.lokata_interest_nom.get(name, 0.0) if state is not None else 0.0

    interest_this_year = b_nom * gross_annual
    interest_nom += interest_this_year
    b_nom = b_nom * (1 + gross_annual)

    tax_nom = 0.0
    if is_maturity and interest_nom > 0:
        tax_nom = interest_nom * tax_rate
        b_nom -= tax_nom
        interest_nom = 0.0

    if state is not None:
        state.lokata_interest_nom[name] = interest_nom

    contrib_nom = contribution * factor_end
    b_nom += contrib_nom
    balances[name] = b_nom / factor_end
    return tax_nom / factor_end if factor_end else tax_nom


def _account_rois_for_age(
    all_stages: list[StageInput], age: int, config: TaxConfig
) -> dict[str, float]:
    """ROI per account using the latest stage that has already started.

    Accounts with no started stage fall back to the first future stage, so a
    starting balance is not grown with a default when the user explicitly
    declared the account later. Future ROI never overrides an earlier one.
    """
    rois: dict[str, float] = {}
    future: dict[str, float] = {}
    for si in sorted(all_stages, key=lambda s: s.start_age):
        for name, cfg in si.accounts.items():
            roi = -config.inflation if name == "gotowka" else cfg.roi
            if si.start_age <= age:
                rois[name] = roi
            else:
                future.setdefault(name, roi)
    for name, roi in future.items():
        rois.setdefault(name, roi)
    return rois


def _passive_growth(
    balances: dict[str, float] | None = None,
    processed_accounts: set[str] | None = None,
    account_rois: dict[str, float] | None = None,
    config: TaxConfig | None = None,
    state: SimulationState | None = None,
) -> None:
    if state is not None:
        balances = state.balances
        if account_rois is None:
            account_rois = state.account_rois
        config = state.config
    assert (
        balances is not None
        and processed_accounts is not None
        and account_rois is not None
        and config is not None
    )
    for acc_name in list(balances.keys()):
        if acc_name in processed_accounts:
            continue
        if acc_name == "zus":
            balances[acc_name] = balances[acc_name] * (1 + config.zus.waloryzacja_skladek)
        elif acc_name == "zus:ofe":
            balances[acc_name] = balances[acc_name] * (1 + account_rois.get("zus", DEFAULT_ROI))
        else:
            rules = config.accounts.get(acc_name)
            if rules and rules.tax_periodic:
                roi = account_rois.get(acc_name, DEFAULT_ROI)
                net = _periodic_net_roi(acc_name, rules, {"roi": roi}, config.inflation)
                balances[acc_name] = balances[acc_name] * (1 + net)
            else:
                roi = account_rois.get(acc_name, DEFAULT_ROI)
                balances[acc_name] = balances[acc_name] * (1 + effective_roi(acc_name, roi))


def _assemble_years(
    computed: dict[int, dict],
) -> tuple[list[YearResult], float, float]:
    sorted_ages = sorted(computed.keys())
    years: list[YearResult] = []
    total_withdrawn_net = 0.0
    total_tax = 0.0

    for age in sorted_ages:
        c = computed[age]
        sb = c["starting_balances"]
        stage_withdrawal = sum(c["withdrawal"].values())
        stage_tax = sum(c["tax"].values())
        # IKZE early return tax is already deducted from capital
        # ("payout + deposit" model) — it doesn't further reduce the annual withdrawal.
        # A negative tax (IKZE contribution relief) must not inflate the withdrawal:
        # it is a tax saving, not money paid out.
        annual_net_deduction = max(0.0, stage_tax - c.get("early_return_tax", 0.0))
        stage_withdrawal_net = max(0.0, stage_withdrawal - annual_net_deduction)
        total_withdrawn_net += stage_withdrawal_net
        total_tax += stage_tax
        zus_monthly = max(
            0.0,
            c["withdrawal"].get("zus", 0.0) - c["tax"].get("zus", 0.0),
        ) / MONTHS_PER_YEAR

        years.append(
            YearResult(
                age=age,
                stage_name=c["stage_name"],
                balances={k: round(v, 2) for k, v in sb.items()},
                total_wealth=round(sum(sb.values()), 2),
                annual_withdrawal=round(stage_withdrawal_net, 2),
                monthly_withdrawal=round(stage_withdrawal_net / MONTHS_PER_YEAR, 2),
                zus_monthly=round(zus_monthly, 2),
                tax_paid=round(stage_tax, 2),
            )
        )

    return years, total_withdrawn_net, total_tax


_IKZE_REINVEST_ORDER = (
    "ike",
    "oipe",
    "broker",
    "oki_inw",
    "obligacje",
    "lokata",
    "oki_osk",
    "krypto",
    "gotowka",
)


def _ikze_refund_targets(cfg, si: StageInput) -> list[str]:
    """Lista kont, na które może trafić zwrot ulgi IKZE (w kolejności)."""
    setting = cfg.ikze_refund_target
    if setting in ("", "none"):
        return []
    if setting == "auto":
        return [acc for acc in _IKZE_REINVEST_ORDER if acc in si.accounts]
    if setting in si.accounts:
        return [setting]
    return []


def _ikze_refund_room(target: str, si: StageInput, state: SimulationState) -> float:
    """Wolne miejsce w rocznym limicie wpłat (IKE/OIPE); reszta bez limitu."""
    if target not in si.accounts:
        return 0.0
    cfg = si.accounts[target]
    limits = state.config.limits
    if target == "ike":
        limit = limits.ike_annual
    elif target == "oipe":
        limit = limits.oipe_annual
    else:
        return float("inf")
    return max(0.0, limit - cfg.annual_contribution)


def _apply_ikze_savings(
    state: SimulationState,
    active_stages: list[StageInput],
    monthly_gross: float,
    merged_tax: dict[str, float],
    age: int | None = None,
) -> None:
    for si in active_stages:
        if si.stage_type != "akumulacja":
            continue
        for name, cfg in si.accounts.items():
            if name != "ikze":
                continue
            contribution = cfg.annual_contribution
            if contribution <= 0:
                continue
            base = cfg.monthly_base if cfg.monthly_base > 0 else monthly_gross
            if base <= 0:
                continue
            dochód = _compute_monthly_gross_dochod(base, state.config)
            saving = _compute_ikze_tax_saving(contribution, dochód, state.config)
            if saving <= 0:
                continue
            merged_tax[name] = merged_tax.get(name, 0.0) - saving
            state.ikze_refund_total += saving

            remaining = saving
            for target in _ikze_refund_targets(cfg, si):
                room = _ikze_refund_room(target, si, state)
                amount = min(remaining, room)
                if amount <= 1e-9:
                    continue
                state.balances[target] = state.balances.get(target, 0.0) + amount
                state.ikze_refund_allocations[target] = (
                    state.ikze_refund_allocations.get(target, 0.0) + amount
                )
                rules = state.config.accounts.get(target)
                if target != "gotowka" and not (rules and rules.tax_periodic):
                    state.basis[target] = state.basis.get(target, 0.0) + amount
                    v_age = age if age is not None else state.start_age
                    state.basis_vintages.setdefault(target, []).append((v_age, amount))
                remaining -= amount
                if remaining <= 1e-9:
                    break
            if remaining > 1e-9:
                state.ikze_refund_unallocated += remaining


def _run_year(
    state: SimulationState,
    age: int,
    monthly_gross: float,
    all_stages: list[StageInput],
    target: float | None = None,
) -> None:
    active_stages = [si for si in all_stages if si.start_age <= age < si.end_age]
    year_start_balances = dict(state.balances)
    if not active_stages:
        # A gap between stages is still a real year: balances keep growing
        # passively (and OKI asset tax still applies), even though no stage
        # is active.
        merged_tax: dict[str, float] = {}
        _passive_growth(
            state=state,
            processed_accounts=set(),
            account_rois=_account_rois_for_age(all_stages, age, state.config),
        )
        _apply_asset_tax(
            state=state,
            year_start_balances=year_start_balances,
            merged_tax=merged_tax,
        )
        state.computed[age] = {
            "starting_balances": year_start_balances,
            "ending_balances": dict(state.balances),
            "withdrawal": {},
            "tax": merged_tax,
            "early_return_tax": 0.0,
            "stage_name": "Bez etapu",
        }
        return

    processed_accounts: set[str] = set()

    zus_pension = _estimate_zus_pension(state=state, active_stages=active_stages, age=age)

    _process_ppk_forfeits(
        state=state,
        active_stages=active_stages,
        age=age,
        year_start_balances=year_start_balances,
        target=target,
        zus_pension=zus_pension,
    )

    early_return_tax, yearly_scale_handled = _process_ikze_returns(
        state=state,
        active_stages=active_stages,
        age=age,
        zus_pension=zus_pension,
        target=target,
    )

    merged_withdrawal, stage_label_parts, periodic_tax = _process_stages(
        state=state,
        active_stages=active_stages,
        age=age,
        processed_accounts=processed_accounts,
        monthly_gross=monthly_gross,
        target=target,
        zus_pension=zus_pension,
    )

    merged_tax = _apply_tax(
        state=state,
        withdrawals=merged_withdrawal,
        year_start_balances=year_start_balances,
        age=age,
        yearly_scale_handled=yearly_scale_handled,
    )
    for acc, t in periodic_tax.items():
        merged_tax[acc] = merged_tax.get(acc, 0.0) + t
    for acc, t in early_return_tax.items():
        merged_tax[acc] = merged_tax.get(acc, 0.0) + t

    _passive_growth(
        state=state,
        processed_accounts=processed_accounts,
        account_rois=_account_rois_for_age(all_stages, age, state.config),
    )

    # Zwrot ulgi IKZE trafia na wybrane konto po zakończeniu roku — w
    # rzeczywistości przychodzi po rozliczeniu PIT, więc nie pracuje przez
    # cały rok wpłaty.
    _apply_ikze_savings(state, active_stages, monthly_gross, merged_tax, age)

    _apply_asset_tax(state=state, year_start_balances=year_start_balances, merged_tax=merged_tax)

    state.computed[age] = {
        "starting_balances": year_start_balances,
        "ending_balances": dict(state.balances),
        "withdrawal": merged_withdrawal,
        "tax": merged_tax,
        "early_return_tax": sum(v for k, v in early_return_tax.items() if k != "zus"),
        "stage_name": "+".join(stage_label_parts),
    }


def _exit_tax(state: SimulationState, age: int) -> float:
    """Podatek od likwidacji wszystkich sald na koniec planu.

    Liczony na kopii stanu tym samym `_apply_tax`, więc respektuje reżim konta
    na danym wieku: IKZE po 65 r.ż. = 10% od całości, przed 65 r.ż. = skala PIT,
    IKE po 60 r.ż. = 0%, broker = 19% od zysku (z basis i wintage'ami inflacji).
    """
    if not state.balances:
        return 0.0
    snapshot = deepcopy(state)
    withdrawals = {
        acc: bal for acc, bal in snapshot.balances.items() if bal > 0
    }
    if not withdrawals:
        return 0.0
    tax = _apply_tax(
        state=snapshot,
        withdrawals=withdrawals,
        year_start_balances=dict(snapshot.balances),
        age=age,
    )
    return sum(tax.values())


def _finalize_result(
    data: SimulationInput, state: SimulationState, target: float | None = None
) -> SimulationResult:
    years, total_withdrawn_net, total_tax = _assemble_years(state.computed)
    sorted_ages = sorted(state.computed.keys())
    final_balances = state.computed[sorted_ages[-1]]["ending_balances"] if sorted_ages else {}
    final_wealth = round(sum(final_balances.values()), 2)
    # Salda z ostatniego roku są dostępne na początku kolejnego roku (wiek + 1),
    # więc podatek wyjścia liczymy już wg reżimu właściwego dla tego wieku.
    exit_age = sorted_ages[-1] + 1 if sorted_ages else 0
    exit_tax = round(_exit_tax(state, exit_age), 2) if sorted_ages else 0.0
    # Szczyt to maksimum z sald na początku i na końcu każdego roku — inaczej
    # ostatni rok (wpłaty + wzrost) wypadał z pomiaru i „szczyt” bywał niższy
    # od „majątku na koniec”.
    peak_wealth = max(
        max((y.total_wealth for y in years), default=0.0),
        max(
            (sum(c["ending_balances"].values()) for c in state.computed.values()),
            default=0.0,
        ),
    )
    display_accounts = sorted(a for a in state.all_accounts if a != "zus")
    has_pension = any("zus" in si.accounts for si in data.stages)
    warnings = _collect_warnings(data, state, target)
    for name, pension in state.zus_pensions.items():
        if pension <= 0:
            warnings.append(
                f"{ACCOUNT_LABELS.get(name, name)}: brak zgromadzonego "
                f"kapitału — wyliczona emerytura wynosi 0 zł/mies. "
                f"Uzupełnij kapitał i podstawę w etapie akumulacji "
                f"albo wpisz emeryturę ręcznie."
            )
        elif state.config.zus.min_emerytura > 0 and pension < state.config.zus.min_emerytura:
            warnings.append(
                f"{ACCOUNT_LABELS.get(name, name)}: wyliczona emerytura "
                f"{pension:,.0f} zł/mies. jest niższa od emerytury "
                f"minimalnej ({state.config.zus.min_emerytura:,.0f} zł). "
                f"ZUS podnosi świadczenie do minimum przy spełnieniu "
                f"warunków stażowych."
            )
    return SimulationResult(
        years=years,
        accounts=display_accounts,
        final_wealth=final_wealth,
        peak_wealth=round(peak_wealth, 2),
        total_withdrawn=round(total_withdrawn_net, 2),
        total_tax=round(total_tax, 2),
        exit_tax=exit_tax,
        final_wealth_net=round(final_wealth - exit_tax, 2),
        total_tax_refund=round(state.ikze_refund_total, 2),
        ikze_refund_allocations={
            acc: round(amount, 2) for acc, amount in state.ikze_refund_allocations.items()
        },
        has_pension=has_pension,
        warnings=warnings,
    )


def simulate(data: SimulationInput, target: float | None = None) -> SimulationResult:
    """
    Simulation engine — pipeline over ages.

    For each year:
    1. Find active stages (start_age <= age < end_age)
    2. For each active stage: calculate_year with account deduplication
    3. Merge withdrawal (gross)
    4. Apply taxes per account rules (basis tracking, scale/flat) — net
    5. Passive growth once for accounts not handled by any stage
    6. Store computed[age]

    end_age is exclusive.

    ``target`` is an optional override of the constant monthly withdrawal
    target for realization stages without a ZUS account (wizard solver).
    When None the stage-level ``withdrawal_target_gross_monthly`` is used.
    """
    if not data.stages:
        return SimulationResult(
            years=[],
            accounts=[],
            final_wealth=0,
            peak_wealth=0,
            total_withdrawn=0,
            total_tax=0,
        )

    _validate_stage_order(data.stages)
    _validate_roi(data)

    state = _init_state(data)

    min_age = min(si.start_age for si in data.stages)
    # Horyzont wynika z ostatniego etapu — data.max_age nie może po cichu
    # uciąć planu ani dopisać lat po zakończeniu wszystkich etapów.
    max_age = max(si.end_age - 1 for si in data.stages)

    for age in range(min_age, max_age + 1):
        _run_year(state, age, data.monthly_gross, data.stages, target)

    return _finalize_result(data, state, target)


def _accumulate_ppk(
    cfg: dict,
    balances: dict,
    basis: dict,
    basis_employee: dict,
    config: TaxConfig,
    welcomed: set[str],
    monthly_gross: float = 0.0,
    age: int | None = None,
    state: SimulationState | None = None,
) -> None:
    """Annual % contribution from base + state top-ups (PPK accumulation).

    Employee (employee_pct) and employer (employer_pct) contributions are
    calculated on the annual base. Annual state top-up (240 PLN) is granted
    every year, welcoming payment (250 PLN) only in the first year of
    accumulation. Everything is included in the cost basis (basis) — for
    Belka tax on withdrawals before age 60.

    Before age 60 the employee only gets back their own contributions;
    employer and state funds are forfeited. That's why we track
    basis_employee separately to calculate the forfeitable share.
    """
    ppk_cfg = config.ppk
    base_annual = _resolve_base(cfg, monthly_gross) * MONTHS_PER_YEAR
    emp_pct = cfg.get("employee_pct", ppk_cfg.employee_pct)
    employer_pct = cfg.get("employer_pct", ppk_cfg.employer_pct)
    emp_contrib = base_annual * emp_pct
    employer_contrib = base_annual * employer_pct
    state_topup = 0.0
    if cfg.get("state_topups", True):
        state_topup += ppk_cfg.state_annual
        if "ppk" not in welcomed:
            state_topup += ppk_cfg.state_welcoming
            welcomed.add("ppk")
    total = emp_contrib + employer_contrib + state_topup
    balances["ppk"] = balances.get("ppk", 0.0) * (1 + cfg.get("roi", DEFAULT_ROI)) + total
    basis["ppk"] = basis.get("ppk", 0.0) + total
    basis_employee["ppk"] = basis_employee.get("ppk", 0.0) + emp_contrib
    if state is not None and total > 0:
        v_age = age if age is not None else state.start_age
        state.basis_vintages.setdefault("ppk", []).append((v_age, total))


def _accumulate_ppe(
    cfg: dict,
    balances: dict,
    basis: dict,
    config: TaxConfig,
    monthly_gross: float = 0.0,
    age: int | None = None,
    state: SimulationState | None = None,
) -> None:
    """Annual base contribution (employer, % of base) + additional contribution (fixed amount).

    The 7% base limit is enforced via a warning in _collect_warnings —
    the engine calculates from the given value.

    30% of the employer's base contributions go to ZUS (sub-account), not to
    PPE — as required by the PPE Act. The remaining 70% plus the participant's
    additional contribution are credited to the PPE account.
    """
    base_annual = _resolve_base(cfg, monthly_gross) * MONTHS_PER_YEAR
    employer = base_annual * cfg.get("employer_pct", 0.0)
    employer_to_zus = employer * PPE_ZUS_FRACTION
    employer_to_ppe = employer - employer_to_zus
    additional = cfg.get("annual_contribution", 0.0)
    total_ppe = employer_to_ppe + additional
    balances["ppe"] = balances.get("ppe", 0.0) * (1 + cfg.get("roi", DEFAULT_ROI)) + total_ppe
    basis["ppe"] = basis.get("ppe", 0.0) + total_ppe
    if state is not None and total_ppe > 0:
        v_age = age if age is not None else state.start_age
        state.basis_vintages.setdefault("ppe", []).append((v_age, total_ppe))
    if employer_to_zus > 0:
        balances["zus"] = balances.get("zus", 0.0) + employer_to_zus


def _asset_class_of(rules) -> str:
    """Classifies an account within an OKI group: savings or investment."""
    if rules and rules.asset_class:
        return rules.asset_class
    return "inwestycyjne"


def _apply_asset_tax(
    balances: dict[str, float] | None = None,
    year_start_balances: dict[str, float] | None = None,
    merged_tax: dict[str, float] | None = None,
    asset_exemptions: dict[str, float] | None = None,
    config: TaxConfig | None = None,
    state: SimulationState | None = None,
) -> None:
    """Annual asset value tax (OKI) above the exemption threshold.

    The base is the average annual asset value; the rate is asset_tax_rate
    (0.85% in 2027, from 2028 approx. 19% of the NBP reference rate).
    The tax is paid regardless of investment performance — deducted from
    the balance and included in the annual tax (total_tax). OKI withdrawals
    are not subject to Belka tax.

    Accounts marked with the same asset_group (e.g. OKI investment +
    savings) share a common limit: 100,000 PLN total, of which max
    25,000 PLN for the savings portion (deposits/bonds). Each standalone
    OKI account retains its own independent threshold.
    """
    if state is not None:
        balances = state.balances
        asset_exemptions = state.asset_exemptions
        config = state.config
    assert (
        balances is not None
        and year_start_balances is not None
        and merged_tax is not None
        and asset_exemptions is not None
        and config is not None
    )
    groups: dict[str, list[str]] = {}
    for account in balances:
        rules = config.accounts.get(account)
        if not rules or rules.tax_model != "assets":
            continue
        groups.setdefault(rules.asset_group or account, []).append(account)

    for members in groups.values():
        savings = [
            a for a in members if _asset_class_of(config.accounts.get(a)) == "oszczednosciowe"
        ]
        invested = [
            a for a in members if _asset_class_of(config.accounts.get(a)) != "oszczednosciowe"
        ]
        rate = max((config.accounts[a].asset_tax_rate for a in members), default=0.0)

        def _avg(account: str) -> float:
            return (year_start_balances.get(account, 0.0) + balances[account]) / 2.0

        def _exemption(account: str) -> float:
            rules = config.accounts[account]
            return asset_exemptions.get(account, rules.asset_exemption)

        savings_avg = sum(_avg(a) for a in savings)
        invested_avg = sum(_avg(a) for a in invested)

        if not invested:
            # Standalone savings-type account (threshold 25 000 PLN).
            tax = (
                max(
                    0.0,
                    savings_avg - max((_exemption(a) for a in savings), default=0.0),
                )
                * rate
            )
            for a in savings:
                _deduct_asset_tax(balances, merged_tax, a, tax, _avg(a), savings_avg)
            continue

        savings_limit = max((_exemption(a) for a in savings), default=0.0)
        total_limit = max((_exemption(a) for a in invested), default=savings_limit)

        s_tax = max(0.0, savings_avg - savings_limit) * rate
        used = min(savings_avg, savings_limit)
        i_tax = max(0.0, invested_avg - (total_limit - used)) * rate
        for a in savings:
            _deduct_asset_tax(balances, merged_tax, a, s_tax, _avg(a), savings_avg)
        for a in invested:
            _deduct_asset_tax(balances, merged_tax, a, i_tax, _avg(a), invested_avg)


def _deduct_asset_tax(balances, merged_tax, account, total_tax, avg, group_avg) -> None:
    """Deducts the account's share of the asset value tax."""
    if total_tax <= 0 or group_avg <= 0:
        return
    share = avg / group_avg
    tax = total_tax * share
    balances[account] = max(0.0, balances[account] - tax)
    merged_tax[account] = merged_tax.get(account, 0.0) + tax


def _apply_tax(
    withdrawals: dict[str, float] | None = None,
    year_start_balances: dict[str, float] | None = None,
    basis: dict[str, float] | None = None,
    age: int | None = None,
    config: TaxConfig | None = None,
    early_returned: set[str] | None = None,
    yearly_scale_handled: set[str] | None = None,
    state: SimulationState | None = None,
) -> dict[str, float]:
    """Calculate the annual tax for each account and update the cost basis."""
    if state is not None:
        assert withdrawals is not None
        assert year_start_balances is not None
        basis = state.basis
        config = state.config
        early_returned = state.early_returned
    assert (
        withdrawals is not None
        and year_start_balances is not None
        and basis is not None
        and age is not None
        and config is not None
        and early_returned is not None
    )
    if yearly_scale_handled is None:
        yearly_scale_handled = set()
    tax: dict[str, float] = {}
    scale_income = 0.0
    scale_accounts: list[tuple[str, float]] = []

    for account, amount in withdrawals.items():
        rules = config.accounts.get(account)
        if not rules:
            continue
        if rules.tax_periodic:
            # Gains already taxed on each term during accumulation (lokata).
            continue
        if account in early_returned or account in yearly_scale_handled:
            # One-time IKZE early return — tax already collected at return,
            # subsequent withdrawals (installments from net capital) not re-taxed.
            # ZUS pension — scale tax already merged with IKZE in _process_ikze_returns.
            continue

        early = rules.min_withdrawal_age > 0 and age < rules.min_withdrawal_age
        model = rules.early_tax_model if early else rules.tax_model
        rate = rules.early_tax_rate if early else rules.tax_rate
        basis_key = rules.early_tax_basis if early else rules.tax_basis

        if model == "none":
            continue
        if model == "assets":
            # Asset value tax (OKI) calculated separately in _apply_asset_tax —
            # withdrawals not subject to capital gains tax.
            continue
        if model == "scale":
            scale_accounts.append((account, amount))
            scale_income += amount
            continue

        # model == "flat"
        if basis_key == "full":
            tax[account] = tax.get(account, 0.0) + amount * rate
        else:  # "gains" — podatek tylko od zysku (Belka)
            start_balance = year_start_balances.get(account, 0.0)
            account_basis = basis.get(account, 0.0)
            inflation = getattr(config, "inflation", 0.0) or 0.0
            if (
                inflation
                and state is not None
                and state.start_age is not None
                and account in state.basis_vintages
            ):
                factor_now = cumulative_factor(inflation, age - state.start_age)
                factor_next = cumulative_factor(inflation, age - state.start_age + 1)
                start_nom = start_balance * factor_now
                # basis nominal as sum of vintaged nominal historic
                vintages = state.basis_vintages.get(account, [])
                basis_nom = 0.0
                for v_age, v_amt in vintages:
                    v_factor = cumulative_factor(inflation, v_age - state.start_age)
                    basis_nom += v_amt * v_factor
                if start_nom > 0:
                    gain_share_nom = max(0.0, (start_nom - basis_nom) / start_nom)
                else:
                    gain_share_nom = 0.0
                amount_nom = amount * factor_next
                tax_nom = amount_nom * gain_share_nom * rate
                tax[account] = (
                    tax.get(account, 0.0) + deflate(tax_nom, inflation, 1)
                    if False
                    else tax_nom / factor_next
                )
                # FIFO reduce vintages and basis
                principal_nom = amount_nom * (1 - gain_share_nom)
                # reduce vintages FIFO
                remaining = principal_nom
                new_vintages: list[tuple[int, float]] = []
                for v_age, v_amt in vintages:
                    v_nom = v_amt * cumulative_factor(inflation, v_age - state.start_age)
                    if remaining <= 0:
                        new_vintages.append((v_age, v_amt))
                    elif v_nom <= remaining + 1e-9:
                        remaining -= v_nom
                    else:
                        # partial
                        remaining_nom = v_nom - remaining
                        remaining = 0
                        v_factor = cumulative_factor(inflation, v_age - state.start_age)
                        new_amt_real = remaining_nom / v_factor
                        new_vintages.append((v_age, new_amt_real))
                state.basis_vintages[account] = new_vintages
                # update real basis as sum of remaining vintages real
                basis[account] = sum(amt for _, amt in new_vintages)
            else:
                if start_balance > 0:
                    gain_share = max(0.0, (start_balance - account_basis) / start_balance)
                else:
                    gain_share = 0.0
                tax[account] = tax.get(account, 0.0) + amount * gain_share * rate
                principal = amount * (1 - gain_share)
                basis[account] = max(0.0, account_basis - principal)

    if scale_income > 0:
        total_scale = scale_tax(scale_income, **config.scale_kwargs())
        total_scale += danina_solidarnosciowa(
            scale_income,
            danina_prog=config.danina_prog,
            danina_rate=config.danina_rate,
        )
        for account, amount in scale_accounts:
            tax[account] = tax.get(account, 0.0) + total_scale * (amount / scale_income)

    return tax


def _collect_warnings(
    data: SimulationInput,
    state: SimulationState | None = None,
    target: float | None = None,
) -> list[str]:
    """Warnings about suboptimal configuration (premature withdrawals, contribution limits)."""
    warnings: list[str] = []
    config = data.config
    retirement_age = _pension_age(config, data.gender)

    for si in data.stages:
        if si.stage_type == "realizacja":
            stage_target = target if target is not None else si.withdrawal_target_gross_monthly
            is_const_target = (
                "zus" not in si.accounts
                and stage_target is not None
                and stage_target > 0
            )
            for name, cfg in si.accounts.items():
                if name == "zus" and cfg.monthly_pension <= 0:
                    if si.start_age < retirement_age:
                        label = ACCOUNT_LABELS["zus"]
                        warnings.append(
                            f"{label} wyliczana z kapitału od {si.start_age} r.ż. — "
                            f"przed powszechnym wiekiem emerytalnym ({retirement_age} r.ż.). "
                            f"Realnie świadczenie nie przysługuje wcześniej; "
                            f"wynik ma charakter poglądowy."
                        )
                rules = config.accounts.get(name)
                if not rules or rules.min_withdrawal_age <= 0:
                    continue
                if si.start_age >= rules.min_withdrawal_age:
                    continue
                if is_const_target and state is not None:
                    tapped_early = any(
                        age < rules.min_withdrawal_age
                        and state.computed.get(age, {}).get("withdrawal", {}).get(name, 0.0) > 1e-6
                        for age in state.computed
                    )
                    if not tapped_early and name not in state.early_returned:
                        continue
                label = ACCOUNT_LABELS.get(name, name)
                if name == "ppk" and si.start_age < rules.min_withdrawal_age:
                    warnings.append(
                        f"PPK wypłacane od {si.start_age} r.ż. (przed "
                        f"{rules.min_withdrawal_age} r.ż.) — środki pracodawcy i dopłaty "
                        f"państwa przepadają; podatek Belka 19% od zysku pracownika."
                    )
                early = rules.early_tax_model
                if early == "scale":
                    lower = int(config.rate_lower * 100)
                    upper = int(config.rate_upper * 100)
                    if config.prog2 is not None and config.rate_middle is not None:
                        middle = int(config.rate_middle * 100)
                        skala = f"{lower}/{middle}/{upper}%"
                    else:
                        skala = f"{lower}/{upper}%"
                    flat = rules.tax_rate * 100
                    before = f"przed {rules.min_withdrawal_age} r.ż."
                    after = f"po {rules.min_withdrawal_age} r.ż."
                    warnings.append(
                        f"{label} wypłacane od {si.start_age} r.ż. ({before}) — jednorazowy zwrot "
                        f"całości w pierwszym roku etapu, podatek wg skali {skala} "
                        f"od całości; {after} ryczałt {flat:.0f}% od każdej wypłaty."
                    )
                elif early in ("flat", "none") and rules.early_tax_rate != rules.tax_rate:
                    early_pct = rules.early_tax_rate * 100
                    normal_pct = rules.tax_rate * 100
                    before = f"przed {rules.min_withdrawal_age} r.ż."
                    after = f"po {rules.min_withdrawal_age} r.ż."
                    warnings.append(
                        f"{label} wypłacane od {si.start_age} r.ż. ({before}) — podatek "
                        f"{early_pct:.0f}% od zysku; {after} {normal_pct:.0f}%."
                    )

        if si.stage_type == "akumulacja":
            for name, cfg in si.accounts.items():
                contribution = cfg.annual_contribution
                limits = config.limits
                limit = None
                if name == "ike" and contribution > limits.ike_annual:
                    limit = limits.ike_annual
                elif name == "ikze":
                    ikze_limit = (
                        limits.ikze_annual_self_employed
                        if cfg.ikze_limit == "self_employed"
                        else limits.ikze_annual
                    )
                    if contribution > ikze_limit:
                        limit = ikze_limit
                elif name == "oipe" and contribution > limits.oipe_annual:
                    limit = limits.oipe_annual
                elif name == "ppe" and contribution > limits.ppe_additional_annual:
                    limit = limits.ppe_additional_annual
                if limit is not None:
                    label = ACCOUNT_LABELS.get(name, name)
                    warnings.append(
                        f"Dopłaty na {label} ({contribution:,.0f} zł/rok) przekraczają "
                        f"roczny limit wpłat ({limit:,.0f} zł)."
                    )

                if name == "ikze" and contribution > 0:
                    refund_target = cfg.ikze_refund_target
                    if refund_target == "auto" and not any(
                        acc in si.accounts for acc in _IKZE_REINVEST_ORDER
                    ):
                        warnings.append(
                            "IKZE: zwrot podatku nie jest reinwestowany — w etapie nie ma "
                            "konta docelowego (IKE, OIPE, broker, OKI, obligacje, "
                            "lokata, krypto, gotówka)."
                        )
                    elif refund_target in ("ike", "oipe"):
                        target_cfg = si.accounts.get(refund_target)
                        limit = (
                            config.limits.ike_annual
                            if refund_target == "ike"
                            else config.limits.oipe_annual
                        )
                        if target_cfg and target_cfg.annual_contribution >= limit - 1e-6:
                            label = ACCOUNT_LABELS.get(refund_target, refund_target)
                            warnings.append(
                                f"IKZE: limit wpłat na {label} jest już wykorzystany — "
                                f"zwrot nie zostanie zainwestowany."
                            )

                if name == "ppk":
                    total_pct = cfg.employee_pct + cfg.employer_pct
                    if total_pct > config.ppk.max_total_pct:
                        warnings.append(
                            f"Suma wpłat do PPK ({total_pct * 100:.1f}% podstawy) "
                            f"przekracza ustawowy limit 8%."
                        )
                elif name == "ppe":
                    if cfg.employer_pct > config.ppe.max_employer_pct:
                        warnings.append(
                            f"Składka podstawowa PPE ({cfg.employer_pct * 100:.1f}% podstawy) "
                            f"przekracza ustawowy limit 7%."
                        )

    # Cash — inflation <= 0% means no erosion (unlikely).
    eff_infl = data.inflation if data.inflation is not None else config.inflation
    cash_warnings: set[str] = set()
    for si in data.stages:
        for name in si.accounts:
            if name == "gotowka" and eff_infl <= 1e-9:
                cash_warnings.add(
                    f"Gotówka — inflacja {eff_infl * 100:.1f}% — zakładasz brak inflacji lub "
                    f"wieloletnią deflację. Realnie gotówka traci na wartości "
                    f"(domyślnie -2,5%/rok); wynik mało prawdopodobny."
                )
    if cash_warnings:
        warnings.extend(sorted(cash_warnings))

    return warnings
