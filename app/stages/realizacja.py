from app.core.pmt import pmt
from app.stages.base import BaseStage


class RealizacjaStage(BaseStage):
    """Etap realizacji zysków - wypłaty PMT ze wszystkich kont + ZUS."""

    name = "Realizacja"
    stage_type = "withdrawal"

    def calculate_year(
        self, age: int, end_age: int, balances: dict[str, float], config: dict
    ) -> dict:
        new_balances = {}
        withdrawal = {}
        tax = {}

        for account, cfg in config.items():
            balance = balances.get(account, 0.0)

            monthly_pension = cfg.get("monthly_pension", 0.0)
            if monthly_pension > 0:
                new_balances[account] = balance
                withdrawal[account] = monthly_pension * 12
                tax[account] = 0.0
                continue

            roi = cfg.get("roi", 0.02)
            buffer = cfg.get("buffer", 0.0)
            years_left = max(1, end_age - age)

            annual_pmt = pmt(roi, years_left, -balance, buffer, when=1)
            withdrawal_amount = max(0.0, annual_pmt)
            remaining = balance - withdrawal_amount
            new_balance = remaining * (1 + roi)

            new_balances[account] = new_balance
            withdrawal[account] = withdrawal_amount
            tax[account] = 0.0

        return {
            "balances": new_balances,
            "withdrawal": withdrawal,
            "tax": tax,
        }
