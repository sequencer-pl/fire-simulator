from app.core.tax import scale_tax
from app.simulation.config import ACCOUNT_LABELS, TaxConfig
from app.simulation.schemas import (
    SimulationInput,
    SimulationResult,
    StageInput,
    YearResult,
)
from app.simulation.tablica_sdtz import sdtz_months
from app.stages.registry import create_stage

DEFAULT_ROI = 0.02
PPE_ZUS_FRACTION = 0.30
MONTHS_PER_YEAR = 12


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
    for si in data.stages:
        for name, cfg in si.accounts.items():
            if cfg.roi <= -1:
                raise ValueError(
                    f"ROI konta {ACCOUNT_LABELS.get(name, name)} nie może być mniejsze "
                    f"lub równe -100% (otrzymano {cfg.roi * 100:.0f}%)."
                )


def _init_state(data: SimulationInput) -> tuple:
    config = data.config
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
            if name != "zus" or stage_input.stage_type == "akumulacja":
                account_rois[name] = cfg.roi
            if cfg.asset_exemption is not None:
                asset_exemptions[name] = cfg.asset_exemption
            if cfg.starting_balance > 0:
                balances.setdefault(name, cfg.starting_balance)
                basis.setdefault(name, cfg.starting_balance)
                if name == "ppk":
                    basis_employee.setdefault(name, cfg.starting_balance)
            if name == "zus" and cfg.starting_balance_ofe > 0 and cfg.ofe_member:
                balances.setdefault("zus:ofe", cfg.starting_balance_ofe)

    computed: dict[int, dict] = {}
    early_returned: set[str] = set()
    forfeited: set[str] = set()
    zus_pensions: dict[str, float] = {}
    welcomed_ppk: set[str] = set()

    return (
        config, balances, basis, basis_employee, account_rois,
        asset_exemptions, all_accounts, computed, early_returned,
        forfeited, zus_pensions, welcomed_ppk,
    )


def _process_ikze_returns(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float],
    config: TaxConfig,
    early_returned: set[str],
) -> dict[str, float]:
    # One-time IKZE early return before qualifying age (e.g. 65):
    # scale tax on ENTIRE balance is deducted before PMT calculation,
    # so installment payments are based on net capital ("payout + deposit" model).
    early_return_tax: dict[str, float] = {}
    for si in active_stages:
        if si.stage_type != "realizacja" or age != si.start_age:
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
            full = balances.get(acc, 0.0)
            early_return_tax[acc] = scale_tax(
                full,
                kwota_wolna=config.kwota_wolna,
                prog=config.prog,
                rate_lower=config.rate_lower,
                rate_upper=config.rate_upper,
            )
            balances[acc] = max(0.0, full - early_return_tax[acc])
    early_returned.update(early_return_tax.keys())
    return early_return_tax


def _process_ppk_forfeits(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float],
    basis: dict[str, float],
    basis_employee: dict[str, float],
    config: TaxConfig,
    forfeited: set[str],
    year_start_balances: dict[str, float],
) -> None:
    # PPK: employer and state contribution forfeit on early withdrawal before age 60.
    for si in active_stages:
        if si.stage_type != "realizacja" or age != si.start_age:
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
                year_start_balances[acc] = balances[acc]
                forfeited.add(acc)


def _process_stages(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float],
    basis: dict[str, float],
    basis_employee: dict[str, float],
    config: TaxConfig,
    account_rois: dict[str, float],
    processed_accounts: set[str],
    zus_pensions: dict[str, float],
    welcomed_ppk: set[str],
) -> tuple[dict[str, float], list[str]]:
    merged_withdrawal: dict[str, float] = {}
    stage_label_parts: list[str] = []
    seen_labels: set[str] = set()
    zus_handled = False

    for stage_input in active_stages:
        stage_obj = create_stage(stage_input.stage_type)
        accounts_config = {
            name: cfg.model_dump() for name, cfg in stage_input.accounts.items()
        }

        # ZUS — contributions and capital indexation (accumulation) plus capital
        # conversion to pension (realization) are handled by the engine because
        # they differ from regular accounts (indexation instead of ROI, ŚDTŻ instead of PMT).
        if "zus" in accounts_config and not zus_handled:
            if stage_input.stage_type == "akumulacja":
                _accumulate_zus(accounts_config["zus"], balances, config)
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
                    accounts_config["ppk"], balances, basis,
                    basis_employee, config, welcomed_ppk,
                )
                processed_accounts.add("ppk")
            if "ppe" in accounts_config:
                _accumulate_ppe(
                    accounts_config["ppe"], balances, basis, config
                )
                processed_accounts.add("ppe")

        accounts_to_process = {
            name: cfg
            for name, cfg in accounts_config.items()
            if name not in processed_accounts
        }

        if not accounts_to_process:
            continue

        result = stage_obj.calculate_year(
            age=age,
            end_age=stage_input.end_age,
            balances=balances,
            config=accounts_to_process,
        )

        for k, v in result["withdrawal"].items():
            merged_withdrawal[k] = merged_withdrawal.get(k, 0) + v

        balances.update(result["balances"])
        processed_accounts.update(accounts_to_process.keys())

        if stage_input.stage_type == "akumulacja":
            for name, cfg in accounts_to_process.items():
                basis[name] = basis.get(name, 0.0) + cfg.get(
                    "annual_contribution", 0.0
                )

        label = stage_input.name or stage_obj.name
        if label not in seen_labels:
            stage_label_parts.append(label)
            seen_labels.add(label)

    return merged_withdrawal, stage_label_parts


def _passive_growth(
    balances: dict[str, float],
    processed_accounts: set[str],
    account_rois: dict[str, float],
    config: TaxConfig,
) -> None:
    for acc_name in list(balances.keys()):
        if acc_name in processed_accounts:
            continue
        if acc_name == "zus":
            balances[acc_name] = balances[acc_name] * (
                1 + config.zus.waloryzacja_skladek
            )
        elif acc_name == "zus:ofe":
            balances[acc_name] = balances[acc_name] * (
                1 + account_rois.get("zus", DEFAULT_ROI)
            )
        else:
            roi = account_rois.get(acc_name, DEFAULT_ROI)
            balances[acc_name] = balances[acc_name] * (1 + roi)


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
        annual_net_deduction = stage_tax - c.get("early_return_tax", 0.0)
        stage_withdrawal_net = max(0.0, stage_withdrawal - annual_net_deduction)
        total_withdrawn_net += stage_withdrawal_net
        total_tax += stage_tax

        years.append(
            YearResult(
                age=age,
                stage_name=c["stage_name"],
                balances={k: round(v, 2) for k, v in sb.items()},
                total_wealth=round(sum(sb.values()), 2),
                annual_withdrawal=round(stage_withdrawal_net, 2),
                monthly_withdrawal=round(stage_withdrawal_net / MONTHS_PER_YEAR, 2),
                tax_paid=round(stage_tax, 2),
            )
        )

    return years, total_withdrawn_net, total_tax


def simulate(data: SimulationInput) -> SimulationResult:
    """
    Simulation engine — loop over ages.

    For each year:
    1. Find active stages (start_age <= age < end_age)
    2. For each active stage: calculate_year with account deduplication
    3. Merge withdrawal (gross)
    4. Apply taxes per account rules (basis tracking, scale/flat) — net
    5. Passive growth once for accounts not handled by any stage
    6. Store computed[age]

    end_age is exclusive.
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

    (
        config, balances, basis, basis_employee, account_rois,
        asset_exemptions, all_accounts, computed, early_returned,
        forfeited, zus_pensions, welcomed_ppk,
    ) = _init_state(data)

    min_age = min(si.start_age for si in data.stages)
    max_age = data.max_age

    for age in range(min_age, max_age + 1):
        active_stages = [
            si for si in data.stages if si.start_age <= age < si.end_age
        ]

        if not active_stages:
            continue

        year_start_balances = dict(balances)
        processed_accounts: set[str] = set()

        early_return_tax = _process_ikze_returns(
            active_stages, age, balances, config, early_returned
        )

        _process_ppk_forfeits(
            active_stages, age, balances, basis, basis_employee,
            config, forfeited, year_start_balances,
        )

        merged_withdrawal, stage_label_parts = _process_stages(
            active_stages, age, balances, basis, basis_employee,
            config, account_rois, processed_accounts, zus_pensions,
            welcomed_ppk,
        )

        merged_tax = _apply_tax(
            withdrawals=merged_withdrawal,
            year_start_balances=year_start_balances,
            basis=basis,
            age=age,
            config=config,
            early_returned=early_returned,
        )
        for acc, t in early_return_tax.items():
            merged_tax[acc] = merged_tax.get(acc, 0.0) + t

        _passive_growth(balances, processed_accounts, account_rois, config)

        _apply_asset_tax(
            balances=balances,
            year_start_balances=year_start_balances,
            merged_tax=merged_tax,
            asset_exemptions=asset_exemptions,
            config=config,
        )

        computed[age] = {
            "starting_balances": year_start_balances,
            "ending_balances": dict(balances),
            "withdrawal": merged_withdrawal,
            "tax": merged_tax,
            "early_return_tax": sum(early_return_tax.values()),
            "stage_name": "+".join(stage_label_parts),
        }

    years, total_withdrawn_net, total_tax = _assemble_years(computed)

    sorted_ages = sorted(computed.keys())
    final_balances = (
        computed[sorted_ages[-1]]["ending_balances"] if sorted_ages else {}
    )
    peak_wealth = max((y.total_wealth for y in years), default=0.0)

    display_accounts = sorted(a for a in all_accounts if a != "zus")
    has_pension = any("zus" in si.accounts for si in data.stages)

    warnings = _collect_warnings(data)
    for name, pension in zus_pensions.items():
        if pension <= 0:
            warnings.append(
                f"{ACCOUNT_LABELS.get(name, name)}: brak zgromadzonego "
                f"kapitału — wyliczona emerytura wynosi 0 zł/mies. "
                f"Uzupełnij kapitał i podstawę w etapie akumulacji "
                f"albo wpisz emeryturę ręcznie."
            )
        elif config.zus.min_emerytura > 0 and pension < config.zus.min_emerytura:
            warnings.append(
                f"{ACCOUNT_LABELS.get(name, name)}: wyliczona emerytura "
                f"{pension:,.0f} zł/mies. jest niższa od emerytury "
                f"minimalnej ({config.zus.min_emerytura:,.0f} zł). "
                f"ZUS podnosi świadczenie do minimum przy spełnieniu "
                f"warunków stażowych."
            )

    return SimulationResult(
        years=years,
        accounts=display_accounts,
        final_wealth=round(sum(final_balances.values()), 2),
        peak_wealth=round(peak_wealth, 2),
        total_withdrawn=round(total_withdrawn_net, 2),
        total_tax=round(total_tax, 2),
        has_pension=has_pension,
        warnings=warnings,
    )


def _accumulate_zus(cfg: dict, balances: dict, config: TaxConfig) -> None:
    """Annual contribution and pension capital indexation (accumulation)."""
    zus_cfg = config.zus
    base_annual = cfg.get("monthly_base", 0.0) * MONTHS_PER_YEAR
    cap = zus_cfg.limit_base_annual
    capped = min(base_annual, cap) if cap and cap > 0 else base_annual
    total_contrib = capped * zus_cfg.skladka_rate

    if cfg.get("ofe_member"):
        if "zus:ofe" not in balances and cfg.get("starting_balance_ofe", 0.0) > 0:
            balances["zus:ofe"] = cfg["starting_balance_ofe"]
        ofe_contrib = capped * zus_cfg.ofe_rate
        zus_contrib = total_contrib - ofe_contrib
        waloryzacja = (
            cfg.get("waloryzacja_skladek")
            if cfg.get("waloryzacja_skladek") is not None
            else zus_cfg.waloryzacja_skladek
        )
        balances["zus"] = (
            balances.get("zus", 0.0) * (1 + waloryzacja) + zus_contrib
        )
        balances["zus:ofe"] = (
            balances.get("zus:ofe", 0.0) * (1 + cfg.get("roi", DEFAULT_ROI))
            + ofe_contrib
        )
    else:
        waloryzacja = (
            cfg.get("waloryzacja_skladek")
            if cfg.get("waloryzacja_skladek") is not None
            else zus_cfg.waloryzacja_skladek
        )
        balances["zus"] = (
            balances.get("zus", 0.0) * (1 + waloryzacja) + total_contrib
        )


def _accumulate_ppk(
    cfg: dict,
    balances: dict,
    basis: dict,
    basis_employee: dict,
    config: TaxConfig,
    welcomed: set[str],
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
    base_annual = cfg.get("monthly_base", 0.0) * MONTHS_PER_YEAR
    emp_pct = cfg.get("employee_pct", ppk_cfg.employee_pct)
    employer_pct = cfg.get("employer_pct", ppk_cfg.employer_pct)
    emp_contrib = base_annual * emp_pct
    employer_contrib = base_annual * employer_pct
    state = 0.0
    if cfg.get("state_topups", True):
        state += ppk_cfg.state_annual
        if "ppk" not in welcomed:
            state += ppk_cfg.state_welcoming
            welcomed.add("ppk")
    total = emp_contrib + employer_contrib + state
    balances["ppk"] = (
        balances.get("ppk", 0.0) * (1 + cfg.get("roi", DEFAULT_ROI)) + total
    )
    basis["ppk"] = basis.get("ppk", 0.0) + total
    basis_employee["ppk"] = basis_employee.get("ppk", 0.0) + emp_contrib


def _accumulate_ppe(cfg: dict, balances: dict, basis: dict, config: TaxConfig) -> None:
    """Annual base contribution (employer, % of base) + additional contribution (fixed amount).

    The 7% base limit is enforced via a warning in _collect_warnings —
    the engine calculates from the given value.

    30% of the employer's base contributions go to ZUS (sub-account), not to
    PPE — as required by the PPE Act. The remaining 70% plus the participant's
    additional contribution are credited to the PPE account.
    """
    base_annual = cfg.get("monthly_base", 0.0) * MONTHS_PER_YEAR
    employer = base_annual * cfg.get("employer_pct", 0.0)
    employer_to_zus = employer * PPE_ZUS_FRACTION
    employer_to_ppe = employer - employer_to_zus
    additional = cfg.get("annual_contribution", 0.0)
    total_ppe = employer_to_ppe + additional
    balances["ppe"] = (
        balances.get("ppe", 0.0) * (1 + cfg.get("roi", DEFAULT_ROI)) + total_ppe
    )
    basis["ppe"] = basis.get("ppe", 0.0) + total_ppe
    if employer_to_zus > 0:
        balances["zus"] = balances.get("zus", 0.0) + employer_to_zus


def _asset_class_of(rules) -> str:
    """Classifies an account within an OKI group: savings or investment."""
    if rules and rules.asset_class:
        return rules.asset_class
    return "inwestycyjne"


def _apply_asset_tax(
    balances: dict[str, float],
    year_start_balances: dict[str, float],
    merged_tax: dict[str, float],
    asset_exemptions: dict[str, float],
    config: TaxConfig,
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
    groups: dict[str, list[str]] = {}
    for account in balances:
        rules = config.accounts.get(account)
        if not rules or rules.tax_model != "assets":
            continue
        groups.setdefault(rules.asset_group or account, []).append(account)

    for members in groups.values():
        savings = [
            a
            for a in members
            if _asset_class_of(config.accounts.get(a)) == "oszczednosciowe"
        ]
        invested = [
            a
            for a in members
            if _asset_class_of(config.accounts.get(a)) != "oszczednosciowe"
        ]
        rate = max(
            (config.accounts[a].asset_tax_rate for a in members), default=0.0
        )

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
                    savings_avg
                    - max((_exemption(a) for a in savings), default=0.0),
                )
                * rate
            )
            for a in savings:
                _deduct_asset_tax(
                    balances, merged_tax, a, tax, _avg(a), savings_avg
                )
            continue

        savings_limit = max((_exemption(a) for a in savings), default=0.0)
        total_limit = max(
            (_exemption(a) for a in invested), default=savings_limit
        )

        s_tax = max(0.0, savings_avg - savings_limit) * rate
        used = min(savings_avg, savings_limit)
        i_tax = max(0.0, invested_avg - (total_limit - used)) * rate
        for a in savings:
            _deduct_asset_tax(
                balances, merged_tax, a, s_tax, _avg(a), savings_avg
            )
        for a in invested:
            _deduct_asset_tax(
                balances, merged_tax, a, i_tax, _avg(a), invested_avg
            )


def _deduct_asset_tax(
    balances, merged_tax, account, total_tax, avg, group_avg
) -> None:
    """Deducts the account's share of the asset value tax."""
    if total_tax <= 0 or group_avg <= 0:
        return
    share = avg / group_avg
    tax = total_tax * share
    balances[account] = max(0.0, balances[account] - tax)
    merged_tax[account] = merged_tax.get(account, 0.0) + tax


def _convert_zus(
    zus_pensions: dict[str, float],
    age: int,
    start_age: int,
    accounts_config: dict,
    balances: dict,
    config: TaxConfig,
) -> None:
    """Convert capital to pension at the start of the realization stage.

    Pension = capital / SDTZ(age). Injecting it into the stage config as
    monthly_pension causes RealizacjaStage to treat it as a regular
    benefit. After conversion the capital is zeroed out, and the benefit
    is annually adjusted by waloryzacja_swiadczenia.
    """
    cfg = accounts_config["zus"]
    if cfg.get("monthly_pension", 0.0) > 0:
        return
    zus_cfg = config.zus
    if age == start_age and "zus" not in zus_pensions:
        capital = balances.pop("zus", 0.0) + balances.pop("zus:ofe", 0.0)
        months = sdtz_months(age)
        zus_pensions["zus"] = capital / months if months > 0 else 0.0
    elif "zus" in zus_pensions:
        waloryzacja = (
            cfg.get("waloryzacja_swiadczenia")
            if cfg.get("waloryzacja_swiadczenia") is not None
            else zus_cfg.waloryzacja_swiadczenia
        )
        zus_pensions["zus"] = zus_pensions["zus"] * (1 + waloryzacja)
    cfg["monthly_pension"] = zus_pensions.get("zus", 0.0)


def _apply_tax(
    withdrawals: dict[str, float],
    year_start_balances: dict[str, float],
    basis: dict[str, float],
    age: int,
    config: TaxConfig,
    early_returned: set[str],
) -> dict[str, float]:
    """Calculate the annual tax for each account and update the cost basis."""
    tax: dict[str, float] = {}
    scale_income = 0.0
    scale_accounts: list[tuple[str, float]] = []

    for account, amount in withdrawals.items():
        rules = config.accounts.get(account)
        if not rules:
            continue
        if account in early_returned:
            # One-time IKZE early return — tax already collected at return,
            # subsequent withdrawals (installments from net capital) not re-taxed.
            continue

        early = rules.min_withdrawal_age > 0 and age < rules.min_withdrawal_age
        model = rules.early_tax_model if early else rules.tax_model
        rate = rules.early_tax_rate if early else rules.tax_rate

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
        if rules.tax_basis == "full":
            tax[account] = tax.get(account, 0.0) + amount * rate
        else:  # "gains" — podatek tylko od zysku (Belka)
            start_balance = year_start_balances.get(account, 0.0)
            account_basis = basis.get(account, 0.0)
            if start_balance > 0:
                gain_share = max(
                    0.0, (start_balance - account_basis) / start_balance
                )
            else:
                gain_share = 0.0
            tax[account] = tax.get(account, 0.0) + amount * gain_share * rate
            principal = amount * (1 - gain_share)
            basis[account] = max(0.0, account_basis - principal)

    if scale_income > 0:
        total_scale = scale_tax(
            scale_income,
            kwota_wolna=config.kwota_wolna,
            prog=config.prog,
            rate_lower=config.rate_lower,
            rate_upper=config.rate_upper,
        )
        for account, amount in scale_accounts:
            tax[account] = (
                tax.get(account, 0.0) + total_scale * (amount / scale_income)
            )

    return tax


def _pension_age(config: TaxConfig, gender: str) -> int:
    """Statutory retirement age by gender (women 60, men 65, since 1.10.2017)."""
    return config.zus.wiek_emerytalny_k if gender == "k" else config.zus.wiek_emerytalny_m


def _collect_warnings(data: SimulationInput) -> list[str]:
    """Warnings about suboptimal configuration (premature withdrawals, contribution limits)."""
    warnings: list[str] = []
    config = data.config
    retirement_age = _pension_age(config, data.gender)

    for si in data.stages:
        if si.stage_type == "realizacja":
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
                label = ACCOUNT_LABELS.get(name, name)
                early = rules.early_tax_model
                if early == "scale":
                    lower = int(config.rate_lower * 100)
                    upper = int(config.rate_upper * 100)
                    flat = rules.tax_rate * 100
                    before = f"przed {rules.min_withdrawal_age} r.ż."
                    after = f"po {rules.min_withdrawal_age} r.ż."
                    warnings.append(
                        f"{label} wypłacane od {si.start_age} r.ż. ({before}) — jednorazowy zwrot "
                        f"całości w pierwszym roku etapu, podatek wg skali {lower}/{upper}% "
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

    # Cash — ROI >= 0% means no inflation or deflation (unlikely).
    # Deduplication: cash usually appears in both accumulation and realization.
    cash_warnings: set[str] = set()
    for si in data.stages:
        for name, cfg in si.accounts.items():
            if name == "gotowka" and cfg.roi >= 0:
                cash_warnings.add(
                    f"Gotówka z ROI {cfg.roi * 100:.1f}% — zakładasz brak inflacji lub "
                    f"wieloletnią deflację. Realnie gotówka traci na wartości "
                    f"(domyślnie -2,5%/rok); wynik mało prawdopodobny."
                )
    warnings.extend(sorted(cash_warnings))

    return warnings
