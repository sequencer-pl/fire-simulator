from app.stages.base import BaseStage


class AkumulacjaStage(BaseStage):
    """Etap akumulacji kapitału - wzrost + dopłaty."""

    name = "Akumulacja"
    stage_type = "accumulation"

    def calculate_year(
        self, age: int, end_age: int, balances: dict[str, float], config: dict
    ) -> dict:
        new_balances = {}
        withdrawal = {}
        tax = {}

        for account, cfg in config.items():
            balance = balances.get(account, 0.0)
            roi = cfg.get("roi", 0.02)
            contribution = cfg.get("annual_contribution", 0.0)

            new_balance = balance * (1 + roi) + contribution

            new_balances[account] = new_balance
            withdrawal[account] = 0.0
            tax[account] = 0.0

        return {
            "balances": new_balances,
            "withdrawal": withdrawal,
            "tax": tax,
        }
