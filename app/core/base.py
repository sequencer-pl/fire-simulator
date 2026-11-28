MONTHS_PER_YEAR = 12


def resolve_base(cfg: dict, global_monthly_gross: float) -> float:
    base = cfg.get("monthly_base", 0.0)
    # ``base_override_enabled`` pozwala świadomie ustawić podstawę 0 (np. ulga
    # na start B2B). Bez flagi 0 oznacza „użyj pensji brutto” (etat/legacy).
    if cfg.get("base_override_enabled") or base > 0:
        return base
    return global_monthly_gross
