from app.core.tax import scale_tax
from app.simulation.config import ACCOUNT_LABELS
from app.simulation.schemas import (
    SimulationInput,
    SimulationResult,
    StageInput,
    YearResult,
)
from app.simulation.tablica_sdtz import sdtz_months
from app.stages.registry import create_stage


def _validate_stage_order(stages: list[StageInput]) -> None:
    """Etap realizacji nie może zaczynać się przed końcem ostatniej akumulacji."""
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
    """ROI musi być większe od -100% (niższe wartości psują wzrost i PMT)."""
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

    # Inicjalizacja sald i ROI niezależna od kolejności etapów
    # (najwcześniejszy chronologicznie etap definiuje saldo startowe)
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
    zwrocone: set[str] = set()
    forfeited: set[str] = set()
    zus_pensions: dict[str, float] = {}
    welcomed_ppk: set[str] = set()

    return (
        config, balances, basis, basis_employee, account_rois,
        asset_exemptions, all_accounts, computed, zwrocone,
        forfeited, zus_pensions, welcomed_ppk,
    )


def _process_ikze_returns(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float],
    config,
    zwrocone: set[str],
) -> dict[str, float]:
    # Jednorazowy zwrot IKZE przed wiekiem uprawniającym (np. 65 r.ż.):
    # podatek wg skali od CAŁOŚCI salda jest potrącany przed wyliczeniem PMT,
    # więc wypłaty ratalne są liczone od kapitału netto (model "wypłata + lokata").
    zwrot_tax: dict[str, float] = {}
    for si in active_stages:
        if si.stage_type != "realizacja" or age != si.start_age:
            continue
        for acc in si.accounts:
            rules = config.accounts.get(acc)
            if (
                acc in zwrocone
                or not rules
                or rules.min_withdrawal_age <= 0
                or age >= rules.min_withdrawal_age
                or rules.early_tax_model != "scale"
            ):
                continue
            full = balances.get(acc, 0.0)
            zwrot_tax[acc] = scale_tax(
                full,
                kwota_wolna=config.kwota_wolna,
                prog=config.prog,
                rate_lower=config.rate_lower,
                rate_upper=config.rate_upper,
            )
            balances[acc] = max(0.0, full - zwrot_tax[acc])
    zwrocone.update(zwrot_tax.keys())
    return zwrot_tax


def _process_ppk_forfeits(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float],
    basis: dict[str, float],
    basis_employee: dict[str, float],
    config,
    forfeited: set[str],
    starting: dict[str, float],
) -> None:
    # PPK: przepadek środków pracodawcy i państwa przy wypłacie przed 60 r.ż.
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
                starting[acc] = balances[acc]
                forfeited.add(acc)


def _process_stages(
    active_stages: list[StageInput],
    age: int,
    balances: dict[str, float],
    basis: dict[str, float],
    basis_employee: dict[str, float],
    config,
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

        # ZUS — składki i waloryzacja kapitału (akumulacja) oraz konwersja
        # kapitału na emeryturę (realizacja) są liczone przez silnik, bo
        # różnią się od zwykłych kont (waloryzacja zamiast ROI, ŚDTŻ zamiast PMT).
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

        # PPK / PPE — składki procentowe od podstawy (akumulacja).
        # Wypłaty idą przez generyczny RealizacjaStage (jak IKE).
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
    config,
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
                1 + account_rois.get("zus", 0.02)
            )
        else:
            roi = account_rois.get(acc_name, 0.02)
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
        # Podatek od jednorazowego zwrotu IKZE jest już potrącony z kapitału
        # (model "wypłata + lokata") — nie zmniejsza dodatkowo rocznej wypłaty.
        annual_net_deduction = stage_tax - c.get("zwrot_tax", 0.0)
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
                monthly_withdrawal=round(stage_withdrawal_net / 12, 2),
                tax_paid=round(stage_tax, 2),
            )
        )

    return years, total_withdrawn_net, total_tax


def simulate(data: SimulationInput) -> SimulationResult:
    """
    Silnik symulacji — pętla po wiekach.

    Dla każdego roku:
    1. Znajdujemy aktywne etapy (start_age <= age < end_age)
    2. Dla każdego aktywnego etapu: calculate_year z deduplikacją kont
    3. Merge withdrawal (gross)
    4. Podatki wg reguł kont (basis tracking, skala/ryczałt) — netto
    5. Passive growth raz dla kont nieobsługiwanych przez żaden etap
    6. Zapis computed[age]

    end_age jest exclusive.
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
        asset_exemptions, all_accounts, computed, zwrocone,
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

        starting = dict(balances)
        processed_accounts: set[str] = set()

        zwrot_tax = _process_ikze_returns(
            active_stages, age, balances, config, zwrocone
        )

        _process_ppk_forfeits(
            active_stages, age, balances, basis, basis_employee,
            config, forfeited, starting,
        )

        merged_withdrawal, stage_label_parts = _process_stages(
            active_stages, age, balances, basis, basis_employee,
            config, account_rois, processed_accounts, zus_pensions,
            welcomed_ppk,
        )

        merged_tax = _apply_tax(
            withdrawals=merged_withdrawal,
            starting=starting,
            basis=basis,
            age=age,
            config=config,
            zwrocone=zwrocone,
        )
        for acc, t in zwrot_tax.items():
            merged_tax[acc] = merged_tax.get(acc, 0.0) + t

        _passive_growth(balances, processed_accounts, account_rois, config)

        _apply_asset_tax(
            balances=balances,
            starting=starting,
            merged_tax=merged_tax,
            asset_exemptions=asset_exemptions,
            config=config,
        )

        computed[age] = {
            "starting_balances": starting,
            "ending_balances": dict(balances),
            "withdrawal": merged_withdrawal,
            "tax": merged_tax,
            "zwrot_tax": sum(zwrot_tax.values()),
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


def _accumulate_zus(cfg: dict, balances: dict, config) -> None:
    """Roczna składka i waloryzacja kapitału emerytalnego (akumulacja)."""
    zus_cfg = config.zus
    base_annual = cfg.get("monthly_base", 0.0) * 12
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
            balances.get("zus:ofe", 0.0) * (1 + cfg.get("roi", 0.02))
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
    config,
    welcomed: set[str],
) -> None:
    """Roczna wpłata % od podstawy + dopłaty państwa (akumulacja PPK).

    Wpłata pracownika (employee_pct) i pracodawcy (employer_pct) jest naliczana
    od rocznej podstawy. Dopłata roczna państwa (240 zł) wpada co roku, wpłata
    powitalna (250 zł) tylko w pierwszym roku akumulacji. Całość wliczana do
    podstawy kosztów (basis) — dla Belki przy wypłatach przed 60 r.ż.

    Przed 60 r.ż. pracownik otrzymuje z powrotem tylko własne wpłaty; środki
    pracodawcy i dopłaty państwa przepadają. Dlatego śledzimy basis_employee
    osobno, by obliczyć udział przepadkowy.
    """
    ppk_cfg = config.ppk
    base_annual = cfg.get("monthly_base", 0.0) * 12
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
        balances.get("ppk", 0.0) * (1 + cfg.get("roi", 0.02)) + total
    )
    basis["ppk"] = basis.get("ppk", 0.0) + total
    basis_employee["ppk"] = basis_employee.get("ppk", 0.0) + emp_contrib


def _accumulate_ppe(cfg: dict, balances: dict, basis: dict, config) -> None:
    """Roczna składka podstawowa (pracodawca, % podstawy) + dodatkowa (kwotowo).

    Limit podstawowej (7%) jest kontrolowany ostrzeżeniem w _collect_warnings —
    silnik liczy od podanej wartości.

    30% składek podstawowych pracodawcy trafia do ZUS (subkonto), a nie do
    PPE — zgodnie z ustawą o PPE. Pozostałe 70% + składka dodatkowa uczestnika
    wchodzą na rachunek PPE.
    """
    base_annual = cfg.get("monthly_base", 0.0) * 12
    employer = base_annual * cfg.get("employer_pct", 0.0)
    employer_to_zus = employer * 0.30
    employer_to_ppe = employer - employer_to_zus
    additional = cfg.get("annual_contribution", 0.0)
    total_ppe = employer_to_ppe + additional
    balances["ppe"] = (
        balances.get("ppe", 0.0) * (1 + cfg.get("roi", 0.02)) + total_ppe
    )
    basis["ppe"] = basis.get("ppe", 0.0) + total_ppe
    if employer_to_zus > 0:
        balances["zus"] = balances.get("zus", 0.0) + employer_to_zus


def _asset_class_of(rules) -> str:
    """Klasyfikuje konto w grupie OKI: oszczędnościowe albo inwestycyjne."""
    if rules and rules.asset_class:
        return rules.asset_class
    return "inwestycyjne"


def _apply_asset_tax(
    balances: dict[str, float],
    starting: dict[str, float],
    merged_tax: dict[str, float],
    asset_exemptions: dict[str, float],
    config,
) -> None:
    """Coroczny podatek od wartości aktywów (OKI) ponad próg zwolnienia.

    Podstawa to średnia roczna wartość aktywów, stawka asset_tax_rate
    (0,85% w 2027 r., od 2028 ok. 19% stopy NBP). Podatek płacony jest
    niezależnie od wyniku inwestycyjnego — potrącany z salda i wliczany
    do rocznego podatku (total_tax). Wypłaty z OKI nie podlegają Belce.

    Konta oznaczone tym samym asset_group (np. OKI inwestycyjne + oszczęd-
    nościowe) dzielą wspólny limit: 100 000 zł łącznie, z czego max
    25 000 zł na część oszczędnościową (lokaty/obligacje). Każde samodzielne
    konto OKI zachowuje swój niezależny próg.
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
            return (starting.get(account, 0.0) + balances[account]) / 2.0

        def _exemption(account: str) -> float:
            rules = config.accounts[account]
            return asset_exemptions.get(account, rules.asset_exemption)

        savings_avg = sum(_avg(a) for a in savings)
        invested_avg = sum(_avg(a) for a in invested)

        if not invested:
            # Samodzielne konto o charakterze oszczędnościowym (próg 25 000 zł).
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
    """Potrąca przypadającą na konto część podatku od wartości aktywów."""
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
    config,
) -> None:
    """Konwersja kapitału na emeryturę przy starcie etapu realizacji.

    Emerytura = kapitał / ŚDTŻ(age). Wstrzyknięcie do config etapu jako
    monthly_pension sprawia, że RealizacjaStage traktuje ją jak zwykłe
    świadczenie. Po konwersji kapitał jest zerowany, a świadczenie corocznie
    waloryzowane o waloryzacja_swiadczenia.
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
    starting: dict[str, float],
    basis: dict[str, float],
    age: int,
    config,
    zwrocone: set[str],
) -> dict[str, float]:
    """Oblicza podatek za rok dla każdego konta i aktualizuje podstawę kosztów."""
    tax: dict[str, float] = {}
    scale_income = 0.0
    scale_accounts: list[tuple[str, float]] = []

    for account, amount in withdrawals.items():
        rules = config.accounts.get(account)
        if not rules:
            continue
        if account in zwrocone:
            # Jednorazowy zwrot IKZE przed wiekiem — podatek pobrany przy zwrocie,
            # dalsze wypłaty (raty z kapitału netto) nie są ponownie opodatkowane.
            continue

        early = rules.min_withdrawal_age > 0 and age < rules.min_withdrawal_age
        model = rules.early_tax_model if early else rules.tax_model
        rate = rules.early_tax_rate if early else rules.tax_rate

        if model == "none":
            continue
        if model == "assets":
            # Podatek od wartości aktywów (OKI) liczony osobno w _apply_asset_tax —
            # wypłaty nie podlegają Belce.
            continue
        if model == "scale":
            scale_accounts.append((account, amount))
            scale_income += amount
            continue

        # model == "flat"
        if rules.tax_basis == "full":
            tax[account] = tax.get(account, 0.0) + amount * rate
        else:  # "gains" — podatek tylko od zysku (Belka)
            start_balance = starting.get(account, 0.0)
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


def _pension_age(config, gender: str) -> int:
    """Powszechny wiek emerytalny wg płci (kobiety 60, mężczyźni 65, od 1.10.2017)."""
    return config.zus.wiek_emerytalny_k if gender == "k" else config.zus.wiek_emerytalny_m


def _collect_warnings(data: SimulationInput) -> list[str]:
    """Ostrzeżenia o suboptymalnej konfiguracji (wypłaty przed wiekiem, limity wpłat)."""
    warnings: list[str] = []
    config = data.config
    em_wiek = _pension_age(config, data.gender)

    for si in data.stages:
        if si.stage_type == "realizacja":
            for name, cfg in si.accounts.items():
                if name == "zus" and cfg.monthly_pension <= 0:
                    if si.start_age < em_wiek:
                        label = ACCOUNT_LABELS["zus"]
                        warnings.append(
                            f"{label} wyliczana z kapitału od {si.start_age} r.ż. — "
                            f"przed powszechnym wiekiem emerytalnym ({em_wiek} r.ż.). "
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

    # Gotówka — ROI >= 0% oznacza brak inflacji lub deflację (mało prawdopodobne).
    # Deduplikacja: gotówka występuje zwykle w akumulacji i realizacji naraz.
    gotowka_warnings: set[str] = set()
    for si in data.stages:
        for name, cfg in si.accounts.items():
            if name == "gotowka" and cfg.roi >= 0:
                gotowka_warnings.add(
                    f"Gotówka z ROI {cfg.roi * 100:.1f}% — zakładasz brak inflacji lub "
                    f"wieloletnią deflację. Realnie gotówka traci na wartości "
                    f"(domyślnie -2,5%/rok); wynik mało prawdopodobny."
                )
    warnings.extend(sorted(gotowka_warnings))

    return warnings
