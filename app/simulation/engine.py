from app.simulation.schemas import (
    SimulationInput,
    SimulationResult,
    YearResult,
)
from app.stages.registry import create_stage


def simulate(data: SimulationInput) -> SimulationResult:
    """
    Silnik symulacji — pętla po wiekach.

    Dla każdego roku:
    1. Znajdujemy aktywne etapy (start_age <= age < end_age)
    2. Dla każdego aktywnego etapu: calculate_year z deduplikacją kont
    3. Merge withdrawal/tax (sumowanie)
    4. Passive growth raz dla kont nieobsługiwanych przez żaden etap
    5. Zapis computed[age]

    end_age jest exclusive.
    """
    if not data.stages:
        return SimulationResult(years=[], accounts=[], final_wealth=0, peak_wealth=0, total_withdrawn=0, total_tax=0)

    balances: dict[str, float] = {}
    account_rois: dict[str, float] = {}

    first_stage = data.stages[0]
    for acc_name, acc_cfg in first_stage.accounts.items():
        if acc_cfg.starting_balance > 0:
            balances[acc_name] = acc_cfg.starting_balance
        account_rois[acc_name] = acc_cfg.roi

    all_accounts: set[str] = set()
    computed: dict[int, dict] = {}

    for stage_input in data.stages:
        for acc_name in stage_input.accounts:
            all_accounts.add(acc_name)
        for name, cfg in stage_input.accounts.items():
            account_rois[name] = cfg.roi

    min_age = min(si.start_age for si in data.stages)
    max_age = data.max_age

    for age in range(min_age, max_age + 1):
        active_stages = [
            si for si in data.stages
            if si.start_age <= age < si.end_age
        ]

        if not active_stages:
            continue

        starting = dict(balances)
        processed_accounts: set[str] = set()
        merged_withdrawal: dict[str, float] = {}
        merged_tax: dict[str, float] = {}
        stage_label_parts: list[str] = []
        seen_labels: set[str] = set()

        for stage_input in active_stages:
            stage_obj = create_stage(stage_input.stage_type)
            accounts_config = {
                name: cfg.model_dump() for name, cfg in stage_input.accounts.items()
            }

            accounts_to_process = {
                name: cfg for name, cfg in accounts_config.items()
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
            for k, v in result["tax"].items():
                merged_tax[k] = merged_tax.get(k, 0) + v

            balances.update(result["balances"])
            processed_accounts.update(accounts_to_process.keys())

            label = stage_input.name or stage_obj.name
            if label not in seen_labels:
                stage_label_parts.append(label)
                seen_labels.add(label)

        for acc_name in list(balances.keys()):
            if acc_name not in processed_accounts:
                roi = account_rois.get(acc_name, 0.02)
                balances[acc_name] = balances[acc_name] * (1 + roi)

        computed[age] = {
            "starting_balances": starting,
            "ending_balances": dict(balances),
            "withdrawal": merged_withdrawal,
            "tax": merged_tax,
            "stage_name": "+".join(stage_label_parts),
        }

    sorted_ages = sorted(computed.keys())
    years: list[YearResult] = []
    total_withdrawn = 0.0
    total_tax = 0.0

    for age in sorted_ages:
        c = computed[age]
        sb = c["starting_balances"]
        stage_withdrawal = sum(c["withdrawal"].values())
        stage_tax = sum(c["tax"].values())
        total_withdrawn += stage_withdrawal
        total_tax += stage_tax

        years.append(
            YearResult(
                age=age,
                stage_name=c["stage_name"],
                balances={k: round(v, 2) for k, v in sb.items()},
                total_wealth=round(sum(sb.values()), 2),
                annual_withdrawal=round(stage_withdrawal, 2),
                monthly_withdrawal=round(stage_withdrawal / 12, 2),
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
        total_withdrawn=round(total_withdrawn, 2),
        total_tax=round(total_tax, 2),
        has_pension=has_pension,
    )
