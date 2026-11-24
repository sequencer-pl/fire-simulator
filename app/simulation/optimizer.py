"""Optymalizator planu Asystenta.

Warstwa nad deterministycznym symulatorem: dzieli nowe wpłaty między wszystkie
konta w granicach profilu ryzyka, dobiera wiek rozpoczęcia ZUS i zwraca
rekomendację oraz porównanie. Nie dotyka istniejącego portfela — wynik jest
sugestią dla przyszłych wpłat.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.simulation.config import WRAPPER_ACCOUNTS, base_account_key
from app.simulation.planner import (
    WizardAnswers,
    WizardPlanResult,
    _evaluate_with_result,
    _normalize_salary,
    _solve_payout,
    build_stages,
    plan,
    resolve_config,
    suggest_allocation_plan,
)
from app.simulation.schemas import SimulationResult

Objective = Literal["payout", "total"]


class OptimizerCandidate(BaseModel):
    """One evaluated policy variant."""

    zus_start_age: int
    allocations: dict[str, float] = Field(default_factory=dict)
    vehicles: dict[str, str] = Field(default_factory=dict)
    asset_mix: dict[str, float] = Field(default_factory=dict)
    withdrawal_policy: str = "defer_tier"
    payout_monthly: float = 0.0
    min_monthly: float = 0.0
    mean_monthly: float = 0.0
    total_withdrawn: float = 0.0
    final_wealth_net: float = 0.0
    met: bool = False
    feasible: bool = True
    break_even_age: float | None = None
    is_baseline: bool = False


class WizardOptimizeRequest(BaseModel):
    answers: WizardAnswers
    objective: Objective = "payout"
    bequest_target: float | None = Field(default=None, ge=0.0, le=1e9)


class PlanOptimizerResult(BaseModel):
    objective: Objective = "payout"
    bequest_target: float = 0.0
    risk_profile: str = "zrownowazony"
    asset_mix: dict[str, float] = Field(default_factory=dict)
    binding_limits: list[str] = Field(default_factory=list)
    baseline: OptimizerCandidate
    recommended: OptimizerCandidate | None = None
    best_total: OptimizerCandidate | None = None
    candidates: list[OptimizerCandidate] = Field(default_factory=list)
    evaluated: int = 0
    warnings: list[str] = Field(default_factory=list)


def _statutory_age(a: WizardAnswers, config) -> int:
    return config.zus.wiek_emerytalny_k if a.gender == "k" else config.zus.wiek_emerytalny_m


def _first_zus_monthly(years) -> float:
    for year in years:
        if year.zus_monthly > 0:
            return float(year.zus_monthly)
    return 0.0


BUCKETS = ("safe", "market", "high")
def _profile(a: WizardAnswers, config):
    return config.risk_profiles.get(a.risk_profile) or config.risk_profiles["zrownowazony"]


def _risk_class(config, account: str, vehicles: dict[str, str]) -> str:
    base = base_account_key(account)
    if base in WRAPPER_ACCOUNTS:
        vehicle = vehicles.get(base)
        rules = config.wrapper_vehicles.get(vehicle or "")
        if rules is not None:
            return rules.risk_class
        return "market"
    rules = config.get_account_rules(account)
    return rules.risk_class if rules else "market"


def _bucket_totals(
    weights: dict[str, float], config, vehicles: dict[str, str]
) -> dict[str, float]:
    totals = {bucket: 0.0 for bucket in BUCKETS}
    for account, weight in weights.items():
        if weight <= 0:
            continue
        risk_class = _risk_class(config, account, vehicles)
        if risk_class in totals:
            totals[risk_class] += weight
    return totals


def _asset_mix(
    weights: dict[str, float], config, vehicles: dict[str, str]
) -> dict[str, float]:
    return {
        key: round(value, 2)
        for key, value in _bucket_totals(weights, config, vehicles).items()
    }


def _bucket_proportions(
    weights: dict[str, float], config, vehicles: dict[str, str]
) -> dict[str, dict[str, float]]:
    props: dict[str, dict[str, float]] = {bucket: {} for bucket in BUCKETS}
    for account, weight in weights.items():
        if weight <= 0:
            continue
        risk_class = _risk_class(config, account, vehicles)
        if risk_class in props:
            props[risk_class][account] = props[risk_class].get(account, 0.0) + weight
    defaults = {"safe": "obligacje", "market": "broker", "high": "krypto"}
    for bucket, accounts in props.items():
        total = sum(accounts.values())
        if total <= 0:
            props[bucket] = {defaults[bucket]: 1.0}
        else:
            props[bucket] = {key: value / total for key, value in accounts.items()}
    return props


def _wrapper_capacity(a: WizardAnswers, config, pool_annual: float) -> float:
    if pool_annual <= 0:
        return 0.0
    limits = config.limits
    capacity = limits.ike_annual + limits.oipe_annual
    capacity += (
        limits.ikze_annual_self_employed
        if a.employment == "b2b"
        else limits.ikze_annual
    )
    return capacity / pool_annual * 100.0


def _wrapper_limit_shares(a: WizardAnswers, config, pool_annual: float) -> dict[str, float]:
    limits = config.limits
    if pool_annual <= 0:
        return {name: 0.0 for name in WRAPPER_ACCOUNTS}
    return {
        "ike": limits.ike_annual / pool_annual * 100.0,
        "ikze": (
            limits.ikze_annual_self_employed
            if a.employment == "b2b"
            else limits.ikze_annual
        ) / pool_annual * 100.0,
        "oipe": limits.oipe_annual / pool_annual * 100.0,
    }


def _account_cap(
    account: str,
    bucket: str,
    profile,
    wrapper_limit_shares: dict[str, float],
) -> float | None:
    base = base_account_key(account)
    if base in wrapper_limit_shares:
        return wrapper_limit_shares[base]
    if bucket == "market" and base in ("broker", "oki_inw"):
        return profile.max_single_taxable * 100.0
    return None


def _add_safe_residual(
    weights: dict[str, float],
    props: dict[str, dict[str, float]],
    vehicles: dict[str, str],
    config,
    amount: float,
    wrapper_limit_shares: dict[str, float],
) -> None:
    if amount <= 1e-9:
        return
    candidates = list(props.get("safe", {}).keys())
    candidates += [
        name for name in ("obligacje", "lokata", "oki_osk", "gotowka")
        if name not in candidates
    ]
    for account in candidates:
        if amount <= 1e-9:
            break
        base = base_account_key(account)
        cap = wrapper_limit_shares.get(base) if base in wrapper_limit_shares else None
        if cap is None:
            room = amount
        else:
            room = max(0.0, cap - weights.get(account, 0.0))
        take = min(amount, room)
        if take > 1e-9:
            weights[account] = weights.get(account, 0.0) + take
            amount -= take
    if amount > 1e-9:
        weights["gotowka"] = weights.get("gotowka", 0.0) + amount


def _add_market_residual(
    weights: dict[str, float],
    props: dict[str, dict[str, float]],
    profile,
    amount: float,
    wrapper_limit_shares: dict[str, float],
) -> None:
    if amount <= 1e-9:
        return
    candidates = list(props.get("market", {}).keys())
    candidates += [name for name in ("broker", "oki_inw") if name not in candidates]
    for account in candidates:
        if amount <= 1e-9:
            break
        base = base_account_key(account)
        if base in wrapper_limit_shares:
            cap = wrapper_limit_shares[base]
        elif base in ("broker", "oki_inw"):
            cap = profile.max_single_taxable * 100.0
        else:
            cap = None
        room = amount if cap is None else max(0.0, cap - weights.get(account, 0.0))
        take = min(amount, room)
        if take > 1e-9:
            weights[account] = weights.get(account, 0.0) + take
            amount -= take
    if amount > 1e-9:
        weights["broker"] = weights.get("broker", 0.0) + amount


def _weights_from_buckets(
    shares: dict[str, float],
    props: dict[str, dict[str, float]],
    a: WizardAnswers,
    config,
    pool_annual: float,
    vehicles: dict[str, str],
) -> dict[str, float]:
    profile = _profile(a, config)
    bucket = {key: max(0.0, float(value)) for key, value in shares.items()}
    bucket["high"] = min(bucket["high"], profile.max_crypto * 100.0)
    bucket["market"] = min(bucket["market"], profile.max_market * 100.0)

    # Safe is the residual class; then enforce the profile's minimum.
    bucket["safe"] = max(0.0, 100.0 - bucket["high"] - bucket["market"])
    if bucket["safe"] < profile.min_safe * 100.0 - 1e-9:
        short = profile.min_safe * 100.0 - bucket["safe"]
        for source in ("market", "high"):
            take = min(short, bucket[source])
            bucket[source] -= take
            bucket["safe"] += take
            short -= take

    wrapper_limit_shares = _wrapper_limit_shares(a, config, pool_annual)
    weights: dict[str, float] = {}
    safe_residual = 0.0
    market_residual = 0.0
    for name in BUCKETS:
        target = bucket.get(name, 0.0)
        if target <= 0:
            continue
        for account, proportion in props[name].items():
            value = target * proportion
            cap = _account_cap(account, name, profile, wrapper_limit_shares)
            if cap is not None:
                excess = max(0.0, value - cap)
                if name == "market":
                    market_residual += excess
                else:
                    safe_residual += excess
                value = min(value, cap)
            weights[account] = weights.get(account, 0.0) + value

    # Residual z capów wraca do właściwej klasy: rynek do taxable market,
    # bezpieczne do bezpiecznych kont.
    _add_market_residual(
        weights, props, profile, market_residual, wrapper_limit_shares
    )
    _add_safe_residual(
        weights, props, vehicles, config, safe_residual, wrapper_limit_shares
    )
    total = sum(weights.values())
    if total <= 0:
        return {}
    if total > 100.0:
        scale = 100.0 / total
        weights = {key: value * scale for key, value in weights.items()}
    elif total < 100.0:
        _add_safe_residual(
            weights, props, vehicles, config, 100.0 - total, wrapper_limit_shares
        )
    return {key: round(value, 2) for key, value in weights.items() if value > 1e-6}


def _seed_weights(
    a: WizardAnswers, config, pool_annual: float
) -> tuple[dict[str, float], dict[str, str]]:
    weights, vehicles = suggest_allocation_plan(a, config, pool_annual)
    if not weights:
        weights = dict(a.allocations)
        vehicles = dict(a.wrapper_vehicles)
    props = _bucket_proportions(weights, config, vehicles)
    shares = _bucket_totals(weights, config, vehicles)
    return (
        _weights_from_buckets(shares, props, a, config, pool_annual, vehicles),
        vehicles,
    )


def _binding_limits(
    weights: dict[str, float],
    a: WizardAnswers,
    config,
    pool_annual: float,
    vehicles: dict[str, str],
) -> list[str]:
    profile = _profile(a, config)
    totals = _bucket_totals(weights, config, vehicles)
    labels: list[str] = []
    if profile.max_crypto > 0 and totals["high"] >= profile.max_crypto * 100 - 0.5:
        labels.append(f"krypto ≤ {profile.max_crypto * 100:.0f}%")
    if profile.max_market < 1.0 and totals["market"] >= profile.max_market * 100 - 0.5:
        labels.append(f"rynkowe ≤ {profile.max_market * 100:.0f}%")
    if profile.min_safe > 0 and totals["safe"] <= profile.min_safe * 100 + 0.5:
        labels.append(f"safe ≥ {profile.min_safe * 100:.0f}%")
    wrapper_cap = _wrapper_capacity(a, config, pool_annual)
    wrapper_weight = sum(
        value for account, value in weights.items()
        if base_account_key(account) in WRAPPER_ACCOUNTS
    )
    if wrapper_cap > 0 and wrapper_weight >= wrapper_cap - 0.5:
        labels.append("limity IKE/IKZE/OIPE")
    else:
        wrapper_shares = _wrapper_limit_shares(a, config, pool_annual)
        for wrapper in WRAPPER_ACCOUNTS:
            cap = wrapper_shares.get(wrapper, 0.0)
            if cap > 0 and weights.get(wrapper, 0.0) >= cap - 0.5:
                labels.append(f"limit {wrapper.upper()}")
    return labels


def _same_candidate(a: OptimizerCandidate, b: OptimizerCandidate) -> bool:
    if a.zus_start_age != b.zus_start_age:
        return False
    if abs(a.payout_monthly - b.payout_monthly) > 1.0:
        return False
    if (a.vehicles or {}) != (b.vehicles or {}):
        return False
    keys = set(a.allocations) | set(b.allocations)
    return all(
        abs(float(a.allocations.get(key, 0.0)) - float(b.allocations.get(key, 0.0))) < 0.5
        for key in keys
    )


def _candidate_score(
    candidate: OptimizerCandidate, objective: Objective
) -> tuple[bool, float, float, float]:
    if objective == "total":
        return (
            candidate.feasible and candidate.met,
            candidate.total_withdrawn,
            candidate.payout_monthly,
            candidate.final_wealth_net,
        )
    return (
        candidate.feasible and candidate.met,
        candidate.payout_monthly,
        candidate.total_withdrawn,
        candidate.final_wealth_net,
    )


def _candidate_from_projection(
    *,
    age: int,
    alloc: dict[str, float],
    vehicles: dict[str, str] | None = None,
    config=None,
    payout: float,
    feasible: bool,
    proj,
    result,
    baseline_zus_age: int,
    baseline_zus_net: float,
    is_baseline: bool = False,
) -> OptimizerCandidate:
    zus_net = _first_zus_monthly(result.years)
    break_even: float | None = None
    if age > baseline_zus_age and zus_net > baseline_zus_net > 0:
        foregone = baseline_zus_net * (age - baseline_zus_age) * 12.0
        extra_annual = (zus_net - baseline_zus_net) * 12.0
        if extra_annual > 0:
            break_even = round(age + foregone / extra_annual, 1)
    vehicle_map = dict(vehicles or {})
    return OptimizerCandidate(
        zus_start_age=age,
        allocations={k: round(v, 2) for k, v in alloc.items()},
        vehicles=vehicle_map,
        asset_mix=_asset_mix(alloc, config, vehicle_map),
        withdrawal_policy=proj.withdrawal_policy,
        payout_monthly=round(payout, 2),
        min_monthly=round(proj.min_monthly, 2),
        mean_monthly=round(proj.mean_monthly, 2),
        total_withdrawn=round(proj.total_withdrawn, 2),
        final_wealth_net=round(proj.final_wealth_net, 2),
        met=proj.met,
        feasible=feasible,
        break_even_age=break_even,
        is_baseline=is_baseline,
    )


def _refine_candidate(
    a: WizardAnswers,
    candidate: OptimizerCandidate,
    *,
    bequest: float,
    baseline_zus_age: int,
    baseline_zus_net: float,
) -> OptimizerCandidate:
    candidate_answers = a.model_copy(
        update={
            "zus_start_age": candidate.zus_start_age,
            "allocations": candidate.allocations,
            "wrapper_vehicles": candidate.vehicles,
        },
        deep=True,
    )
    data = build_stages(candidate_answers)
    payout, feasible = _solve_payout(data, bequest)
    if payout <= 0 or not feasible:
        return candidate
    proj, result = _evaluate_with_result(data, payout, bequest)
    return _candidate_from_projection(
        age=candidate.zus_start_age,
        alloc=candidate.allocations,
        vehicles=candidate.vehicles,
        config=resolve_config(a),
        payout=payout,
        feasible=feasible,
        proj=proj,
        result=result,
        baseline_zus_age=baseline_zus_age,
        baseline_zus_net=baseline_zus_net,
    )


def _evaluate_weights(
    a: WizardAnswers,
    weights: dict[str, float],
    *,
    vehicles: dict[str, str],
    age: int,
    bequest: float,
    baseline_zus_age: int,
    baseline_zus_net: float,
    coarse: bool = True,
) -> tuple[OptimizerCandidate | None, SimulationResult | None]:
    candidate_answers = a.model_copy(
        update={
            "zus_start_age": age,
            "allocations": weights,
            "wrapper_vehicles": vehicles,
        },
        deep=True,
    )
    data = build_stages(candidate_answers)
    payout, feasible = _solve_payout(
        data,
        bequest,
        bisection_iter=6 if coarse else 24,
        grossup_iter=8 if coarse else 25,
    )
    if payout <= 0 or not feasible:
        return None, None
    proj, result = _evaluate_with_result(
        data,
        payout,
        bequest,
        grossup_iter=8 if coarse else 25,
    )
    return (
        _candidate_from_projection(
            age=age,
            alloc=weights,
            vehicles=vehicles,
            config=resolve_config(a),
            payout=payout,
            feasible=feasible,
            proj=proj,
            result=result,
            baseline_zus_age=baseline_zus_age,
            baseline_zus_net=baseline_zus_net,
        ),
        result,
    )


def optimize_plan(
    a: WizardAnswers,
    *,
    objective: Objective = "payout",
    bequest: float | None = None,
    max_candidates: int = 8,
    search_budget: int = 26,
) -> PlanOptimizerResult:
    """Optimize all new contributions and the ZUS start age.

    The search is bucket-based (safe / market / high, with IKE/IKZE/OIPE as
    accounts inside those classes), then refines the ZUS start age. Every
    candidate is
    checked by the full deterministic simulator; the result is the best found,
    not a proof of global optimality.
    """
    a = _normalize_salary(a)
    config = resolve_config(a)
    bequest_value = a.bequest_target if bequest is None else max(0.0, bequest)
    a = a.model_copy(update={"bequest_target": bequest_value}, deep=True)

    statutory = _statutory_age(a, config)
    start_age = a.age_now
    warnings: list[str] = []
    if not a.use_zus:
        base_data = build_stages(a)
        base_payout, base_feasible = _solve_payout(base_data, bequest_value)
        base_proj, base_res = _evaluate_with_result(
            base_data, max(base_payout, 0.01), bequest_value
        )
        return PlanOptimizerResult(
            objective=objective,
            bequest_target=round(bequest_value, 2),
            risk_profile=a.risk_profile,
            asset_mix=_asset_mix(a.allocations, config, a.wrapper_vehicles),
            baseline=_candidate_from_projection(
                age=statutory,
                alloc=dict(a.allocations),
                vehicles=a.wrapper_vehicles,
                config=config,
                payout=base_payout,
                feasible=base_feasible,
                proj=base_proj,
                result=base_res,
                baseline_zus_age=statutory,
                baseline_zus_net=0.0,
                is_baseline=True,
            ),
            warnings=["ZUS jest wyłączony — nie ma czego optymalizować."],
        )

    re = a.retire_early_age if a.retire_early_age is not None else statutory
    re = max(re, start_age)
    min_start = max(statutory, re)
    horizon = max(a.plan_end_age, min_start + 1)
    max_start = min(horizon - 1, min_start + 10)
    if max_start < min_start:
        max_start = min_start
    base_start = min_start

    pool_annual = max(0.0, a.savings * 12.0)
    if pool_annual <= 0:
        warnings.append("Brak miesięcznej puli wpłat — optymalizator nie ma czego dzielić.")

    seed_weights, vehicles = _seed_weights(a, config, pool_annual)
    if not seed_weights:
        seed_weights = dict(a.allocations)
        vehicles = dict(a.wrapper_vehicles)
    if not seed_weights:
        warnings.append("Brak dostępnych kont do podziału wpłat.")
    props = _bucket_proportions(seed_weights, config, vehicles)
    shares = _bucket_totals(seed_weights, config, vehicles)
    current_weights = _weights_from_buckets(
        shares, props, a, config, pool_annual, vehicles
    )
    shares = _bucket_totals(current_weights, config, vehicles)

    baseline_candidate, baseline_data = _evaluate_weights(
        a,
        current_weights,
        vehicles=vehicles,
        age=base_start,
        bequest=bequest_value,
        baseline_zus_age=base_start,
        baseline_zus_net=0.0,
        coarse=False,
    )
    if baseline_candidate is None:
        baseline_candidate = _candidate_from_projection(
            age=base_start,
            alloc=current_weights,
            vehicles=vehicles,
            config=config,
            payout=0.0,
            feasible=False,
            proj=_evaluate_with_result(
                build_stages(a), 0.01, bequest_value
            )[0],
            result=_evaluate_with_result(
                build_stages(a), 0.01, bequest_value
            )[1],
            baseline_zus_age=base_start,
            baseline_zus_net=0.0,
            is_baseline=True,
        )
        warnings.append(
            "Nie znaleziono wariantu spełniającego jednocześnie wypłatę i spadek. "
            "Obniż spadek, wydłuż horyzont lub zwiększ oszczędności."
        )
        return PlanOptimizerResult(
            objective=objective,
            bequest_target=round(bequest_value, 2),
            risk_profile=a.risk_profile,
            asset_mix=_asset_mix(current_weights, config, vehicles),
            baseline=baseline_candidate,
            recommended=None,
            best_total=None,
            candidates=[],
            evaluated=0,
            warnings=warnings,
        )
    baseline_candidate.is_baseline = True
    base_zus_net = 0.0
    if baseline_data is not None:
        base_zus_net = _first_zus_monthly(baseline_data.years)

    evaluated = 1
    best_candidate = baseline_candidate
    best_score = _candidate_score(best_candidate, objective)
    budget = max(1, search_budget)

    for step in (0.05, 0.025):
        improved = True
        while improved and evaluated < budget:
            improved = False
            best_move = None
            for source in BUCKETS:
                if shares.get(source, 0.0) < step:
                    continue
                for target in BUCKETS:
                    if source == target:
                        continue
                    candidate_shares = dict(shares)
                    candidate_shares[source] -= step
                    candidate_shares[target] += step
                    weights = _weights_from_buckets(
                        candidate_shares, props, a, config, pool_annual, vehicles
                    )
                    if not weights or weights == current_weights:
                        continue
                    candidate, _ = _evaluate_weights(
                        a,
                        weights,
                        vehicles=vehicles,
                        age=base_start,
                        bequest=bequest_value,
                        baseline_zus_age=base_start,
                        baseline_zus_net=base_zus_net,
                        coarse=True,
                    )
                    evaluated += 1
                    if candidate is None:
                        continue
                    score = _candidate_score(candidate, objective)
                    if score > best_score and (
                        best_move is None or score > best_move[0]
                    ):
                        best_move = (score, candidate_shares, weights, candidate)
            if best_move is not None:
                best_score, shares, current_weights, best_candidate = best_move
                improved = True

    # ZUS start age trade-off on the best allocation.
    age_candidates: list[OptimizerCandidate] = []
    ages: list[int] = []
    for age in (
        base_start,
        min(base_start + 3, max_start),
        min(base_start + 5, max_start),
        min(base_start + 7, max_start),
        min(base_start + 10, max_start),
    ):
        if age not in ages:
            ages.append(age)
    for age in sorted(ages):
        candidate, _ = _evaluate_weights(
            a,
            current_weights,
            vehicles=vehicles,
            age=age,
            bequest=bequest_value,
            baseline_zus_age=base_start,
            baseline_zus_net=base_zus_net,
            coarse=False,
        )
        evaluated += 1
        if candidate is None:
            continue
        age_candidates.append(candidate)
        if _candidate_score(candidate, objective) > best_score:
            best_score = _candidate_score(candidate, objective)
            best_candidate = candidate

    candidates = [best_candidate, baseline_candidate, *age_candidates]
    unique: dict[tuple[int, tuple[tuple[str, float], ...]], OptimizerCandidate] = {}
    for candidate in candidates:
        signature = (
            candidate.zus_start_age,
            tuple(sorted(candidate.allocations.items())),
        )
        unique.setdefault(signature, candidate)
    candidates = list(unique.values())
    candidates.sort(key=lambda candidate: _candidate_score(candidate, objective), reverse=True)
    recommended = candidates[0]
    if not _same_candidate(recommended, baseline_candidate):
        recommended = _refine_candidate(
            a,
            recommended,
            bequest=bequest_value,
            baseline_zus_age=base_start,
            baseline_zus_net=base_zus_net,
        )
    if _same_candidate(recommended, baseline_candidate):
        recommended = baseline_candidate
    if not recommended.met:
        warnings.append(
            "Rekomendacja nie spełnia pełnego celu (wypłata/spadek) — "
            "sprawdź założenia lub obniż wymagania."
        )

    total_sorted = sorted(
        (candidate for candidate in candidates if candidate.met),
        key=lambda candidate: (candidate.total_withdrawn, candidate.payout_monthly),
        reverse=True,
    )
    best_total = total_sorted[0] if total_sorted else None
    if best_total is not None and not _same_candidate(best_total, recommended):
        best_total = _refine_candidate(
            a,
            best_total,
            bequest=bequest_value,
            baseline_zus_age=base_start,
            baseline_zus_net=base_zus_net,
        )
    if best_total is not None and _same_candidate(best_total, recommended):
        best_total = None

    selected = candidates[:max_candidates]
    if not any(_same_candidate(candidate, baseline_candidate) for candidate in selected):
        selected.append(baseline_candidate)

    return PlanOptimizerResult(
        objective=objective,
        bequest_target=round(bequest_value, 2),
        risk_profile=a.risk_profile,
        asset_mix=_asset_mix(recommended.allocations, config, recommended.vehicles),
        binding_limits=_binding_limits(
            recommended.allocations, a, config, pool_annual, recommended.vehicles
        ),
        baseline=baseline_candidate,
        recommended=recommended,
        best_total=best_total,
        candidates=selected,
        evaluated=evaluated,
        warnings=warnings,
    )


def plan_optimized(
    path: int,
    a: WizardAnswers,
    target: float | None = None,
    *,
    scenarios: bool = True,
    search_budget: int = 26,
) -> WizardPlanResult:
    """Plan path 1 with the optimizer's recommended ZUS age and mix.

    The user's answers are the baseline; the returned plan uses the recommended
    variant when it is better. The full optimizer comparison is attached as
    ``optimization`` so the result screen can show "Twoje ustawienia" vs
    "Rekomendacja" without silently hiding the alternative.
    """
    if path != 1:
        return plan(path, a, target, scenarios=scenarios)

    optimization = optimize_plan(
        a,
        objective=a.optimization_objective,
        search_budget=search_budget,
    )
    recommended = optimization.recommended
    chosen = a
    if recommended is not None:
        chosen = a.model_copy(
            update={
                "zus_start_age": recommended.zus_start_age,
                "allocations": recommended.allocations,
                "wrapper_vehicles": recommended.vehicles,
            },
            deep=True,
        )
    result = plan(path, chosen, target, scenarios=scenarios)
    recommended = optimization.recommended
    if recommended is not None:
        # The main plan may pick a better withdrawal policy than the optimizer
        # candidate used during the search; keep the comparison card aligned
        # with the plan the user actually sees.
        recommended.payout_monthly = round(result.projection.min_monthly, 2)
        recommended.min_monthly = round(result.projection.min_monthly, 2)
        recommended.mean_monthly = round(result.projection.mean_monthly, 2)
        recommended.total_withdrawn = round(result.projection.total_withdrawn, 2)
        recommended.final_wealth_net = round(result.projection.final_wealth_net, 2)
        recommended.withdrawal_policy = result.projection.withdrawal_policy
    return result.model_copy(
        update={"optimization": optimization.model_dump(mode="json")}
    )
