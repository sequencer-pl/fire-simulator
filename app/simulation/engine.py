from app.core.tax import scale_tax
from app.simulation.config import ACCOUNT_LABELS
from app.simulation.schemas import (
    SimulationInput,
    SimulationResult,
    StageInput,
    YearResult,
)
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
            years=[], accounts=[], final_wealth=0, peak_wealth=0, total_withdrawn=0, total_tax=0
        )

    _validate_stage_order(data.stages)

    config = data.config
    balances: dict[str, float] = {}
    basis: dict[str, float] = {}
    account_rois: dict[str, float] = {}
    all_accounts: set[str] = set()

    # Inicjalizacja sald i ROI niezależna od kolejności etapów
    # (najwcześniejszy chronologicznie etap definiuje saldo startowe)
    for stage_input in sorted(data.stages, key=lambda s: s.start_age):
        all_accounts.update(stage_input.accounts.keys())
        for name, cfg in stage_input.accounts.items():
            account_rois[name] = cfg.roi
            if cfg.starting_balance > 0:
                balances.setdefault(name, cfg.starting_balance)
                basis.setdefault(name, cfg.starting_balance)

    computed: dict[int, dict] = {}
    zwrocone: set[str] = set()

    min_age = min(si.start_age for si in data.stages)
    max_age = data.max_age

    for age in range(min_age, max_age + 1):
        active_stages = [si for si in data.stages if si.start_age <= age < si.end_age]

        if not active_stages:
            continue

        starting = dict(balances)
        processed_accounts: set[str] = set()
        merged_withdrawal: dict[str, float] = {}
        stage_label_parts: list[str] = []
        seen_labels: set[str] = set()

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

        for stage_input in active_stages:
            stage_obj = create_stage(stage_input.stage_type)
            accounts_config = {name: cfg.model_dump() for name, cfg in stage_input.accounts.items()}

            accounts_to_process = {
                name: cfg for name, cfg in accounts_config.items() if name not in processed_accounts
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
                    basis[name] = basis.get(name, 0.0) + cfg.get("annual_contribution", 0.0)

            label = stage_input.name or stage_obj.name
            if label not in seen_labels:
                stage_label_parts.append(label)
                seen_labels.add(label)

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

        for acc_name in list(balances.keys()):
            if acc_name not in processed_accounts:
                roi = account_rois.get(acc_name, 0.02)
                balances[acc_name] = balances[acc_name] * (1 + roi)

        computed[age] = {
            "starting_balances": starting,
            "ending_balances": dict(balances),
            "withdrawal": merged_withdrawal,
            "tax": merged_tax,
            "zwrot_tax": sum(zwrot_tax.values()),
            "stage_name": "+".join(stage_label_parts),
        }

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

    final_balances = computed[sorted_ages[-1]]["ending_balances"] if sorted_ages else {}
    peak_wealth = max((y.total_wealth for y in years), default=0.0)

    display_accounts = sorted(a for a in all_accounts if a != "zus")
    has_pension = any("zus" in si.accounts for si in data.stages)

    return SimulationResult(
        years=years,
        accounts=display_accounts,
        final_wealth=round(sum(final_balances.values()), 2),
        peak_wealth=round(peak_wealth, 2),
        total_withdrawn=round(total_withdrawn_net, 2),
        total_tax=round(total_tax, 2),
        has_pension=has_pension,
        warnings=_collect_warnings(data),
    )


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
                gain_share = max(0.0, (start_balance - account_basis) / start_balance)
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
            tax[account] = tax.get(account, 0.0) + total_scale * (amount / scale_income)

    return tax


def _collect_warnings(data: SimulationInput) -> list[str]:
    """Ostrzeżenia o suboptymalnej konfiguracji (wypłaty przed wiekiem, limity wpłat)."""
    warnings: list[str] = []
    config = data.config

    for si in data.stages:
        if si.stage_type == "realizacja":
            for name in si.accounts:
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
                if limit is not None:
                    label = ACCOUNT_LABELS.get(name, name)
                    warnings.append(
                        f"Dopłaty na {label} ({contribution:,.0f} zł/rok) przekraczają "
                        f"roczny limit wpłat ({limit:,.0f} zł)."
                    )

    return warnings
