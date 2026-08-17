from abc import ABC, abstractmethod


class BaseStage(ABC):
    """Interface for all simulation stages."""

    name: str
    stage_type: str

    @abstractmethod
    def calculate_year(
        self, age: int, end_age: int, balances: dict[str, float], config: dict
    ) -> dict:
        """
        Oblicza salda po jednym roku.

        Args:
            age: bieżący wiek
            end_age: wiek końca etapu
            balances: {konto: saldo} z poprzedniego roku
            config: parametry kont {konto: {roi, contribution, buffer, ...}}

        Returns:
            {
                "balances": {konto: nowe_saldo},
                "withdrawal": {konto: kwota_wypłaty},
                "tax": {konto: kwota_podatku}
            }
        """
