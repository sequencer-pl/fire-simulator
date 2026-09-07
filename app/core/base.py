MONTHS_PER_YEAR = 12


def resolve_base(cfg: dict, global_monthly_gross: float) -> float:
    if cfg.get("monthly_base", 0.0) > 0:
        return cfg["monthly_base"]
    return global_monthly_gross
