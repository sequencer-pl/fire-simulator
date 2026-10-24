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
            tier_0 = [
                acc
                for acc, cfg in investable.items()
                if cfg.get("min_withdrawal_age", 0) <= 0
                or age >= cfg.get("min_withdrawal_age", 0)
                or cfg.get("early_returned", False)
            ]
            tier_1 = [
                acc
                for acc, cfg in investable.items()
                if acc not in tier_0 and cfg.get("early_tax_model", "none") != "scale"
            ]
            tier_2 = [
                acc for acc in investable if acc not in tier_0 and acc not in tier_1
            ]

            remaining_needed = max(0.0, desired_withdrawal)
            for tier in (tier_0, tier_1, tier_2):
                tier_balance = sum(max(0.0, balances.get(acc, 0.0)) for acc in tier)
                if remaining_needed > 1e-9 and tier_balance > 0:
                    tier_draw = min(tier_balance, remaining_needed)
                    for account in tier:
                        balance = max(0.0, balances.get(account, 0.0))
                        roi = investable[account].get("roi", 0.02)
                        withdrawn = min(balance, tier_draw * (balance / tier_balance))
                        new_balances[account] = (balance - withdrawn) * (1 + roi)
                        withdrawal[account] = withdrawn
                        tax[account] = 0.0
                    remaining_needed = max(0.0, remaining_needed - tier_draw)
                else:
                    for account in tier:
                        balance = max(0.0, balances.get(account, 0.0))
                        roi = investable[account].get("roi", 0.02)
                        new_balances[account] = balance * (1 + roi)
                        withdrawal[account] = 0.0
                        tax[account] = 0.0

        return {
            "balances": new_balances,
            "withdrawal": withdrawal,
            "tax": tax,
        }
