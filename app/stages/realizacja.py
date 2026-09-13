from app.core.pmt import pmt
from app.stages.base import BaseStage


class RealizacjaStage(BaseStage):
    """Profit realization stage.

    Two modes:
    - default (desired_withdrawal is None): classic PMT annuitization —
      every account pays itself out down to its buffer over the remaining
      window (used by the editor and legacy stages);
    - constant target (desired_withdrawal >= 0): the non-ZUS portfolio pays
      a fixed annual amount (target minus current ZUS pension), distributed
      across accounts proportionally to their balances; leftover keeps
      growing at ROI. Used by the wizard FIRE model.
    """

    name = "Realizacja"
    stage_type = "withdrawal"

    def calculate_year(
        self,
        age: int,
        end_age: int,
        balances: dict[str, float],
        config: dict,
        desired_withdrawal: float | None = None,
    ) -> dict:
        new_balances = {}
        withdrawal = {}
        tax = {}

        pension_accounts = {
            account: cfg for account, cfg in config.items() if cfg.get("monthly_pension", 0.0) > 0
        }
        investable = {
            account: cfg for account, cfg in config.items() if account not in pension_accounts
        }

        for account, cfg in pension_accounts.items():
            balance = balances.get(account, 0.0)
            new_balances[account] = balance
            withdrawal[account] = cfg["monthly_pension"] * 12
            tax[account] = 0.0

        if not investable:
            return {
                "balances": {**new_balances},
                "withdrawal": withdrawal,
                "tax": tax,
            }

        if desired_withdrawal is None:
            for account, cfg in investable.items():
                balance = balances.get(account, 0.0)
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
        else:
            total_balance = sum(max(0.0, balances.get(account, 0.0)) for account in investable)
            for account, cfg in investable.items():
                balance = max(0.0, balances.get(account, 0.0))
                roi = cfg.get("roi", 0.02)
                if total_balance > 0:
                    share = min(balance, desired_withdrawal * (balance / total_balance))
                else:
                    share = 0.0
                withdrawn = max(0.0, share)
                new_balances[account] = (balance - withdrawn) * (1 + roi)
                withdrawal[account] = withdrawn
                tax[account] = 0.0

        return {
            "balances": new_balances,
            "withdrawal": withdrawal,
            "tax": tax,
        }
