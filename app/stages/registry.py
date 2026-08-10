from app.stages.akumulacja import AkumulacjaStage
from app.stages.base import BaseStage
from app.stages.realizacja import RealizacjaStage

STAGE_CLASSES: dict[str, type[BaseStage]] = {
    "akumulacja": AkumulacjaStage,
    "realizacja": RealizacjaStage,
}

STAGE_META = {
    "akumulacja": {
        "label": "Akumulacja",
        "description": "Etap akumulacji kapitału - oszczędzanie i inwestowanie",
        "type": "accumulation",
        "available_accounts": {
            "broker": {
                "label": "Broker",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                    },
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                },
            },
            "ike": {
                "label": "IKE",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                    },
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                },
            },
            "ikze": {
                "label": "IKZE",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                    },
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                },
            },
            "lokata": {
                "label": "Lokata",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "roi": {
                        "label": "Oprocentowanie",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
                },
            },
        },
    },
    "realizacja": {
        "label": "Realizacja",
        "description": "Etap realizacji zysków - wypłaty PMT (annuitet)",
        "type": "withdrawal",
        "available_accounts": {
            "broker": {
                "label": "Broker",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "ike": {
                "label": "IKE",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "ikze": {
                "label": "IKZE",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "lokata": {
                "label": "Lokata",
                "fields": {
                    "roi": {
                        "label": "Oprocentowanie",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "zus": {
                "label": "ZUS (emerytura)",
                "fields": {
                    "monthly_pension": {"label": "Emerytura mies.", "type": "number", "step": 1000},
                },
            },
        },
    },
}


def create_stage(stage_type: str) -> BaseStage:
    cls = STAGE_CLASSES.get(stage_type)
    if not cls:
        raise ValueError(f"Nieznany typ etapu: {stage_type}")
    return cls()


def get_all_stage_types() -> dict:
    return STAGE_META
