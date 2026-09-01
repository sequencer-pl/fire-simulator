MONTHS_PER_YEAR = 12


def resolve_base(cfg: dict, global_monthly_gross: float) -> float:
    if cfg.get("base_override_enabled"):
        return cfg.get("monthly_base", 0.0)
    return global_monthly_gross
