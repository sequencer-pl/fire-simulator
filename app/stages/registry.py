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
            "oipe": {
                "label": "OIPE",
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
            "oki": {
                "label": "OKI",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                    },
                    "asset_exemption": {
                        "label": "Typ aktywów",
                        "type": "select",
                        "options": [
                            {"label": "Inwestycyjne (limit 100 000 zł)", "value": "100000"},
                            {"label": "Oszczędnościowe (limit 25 000 zł)", "value": "25000"},
                        ],
                    },
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                },
            },
            "krypto": {
                "label": "Krypto",
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
            "ppk": {
                "label": "PPK",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "monthly_base": {
                        "label": "Podstawa wymiaru (mies.)",
                        "type": "number",
                        "step": 100,
                    },
                    "employee_pct": {
                        "label": "Wpłata pracownika",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
                    "employer_pct": {
                        "label": "Wpłata pracodawcy",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
                    "state_topups": {
                        "label": "Dopłaty państwa (250 zł + 240 zł/rok)",
                        "type": "checkbox",
                    },
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                },
            },
            "ppe": {
                "label": "PPE",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "monthly_base": {
                        "label": "Podstawa wymiaru (mies.)",
                        "type": "number",
                        "step": 100,
                    },
                    "employer_pct": {
                        "label": "Składka podstawowa pracodawcy",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
                    "annual_contribution": {
                        "label": "Składka dodatkowa (rocznie)",
                        "type": "number",
                        "step": 1000,
                    },
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                },
            },
            "gotowka": {
                "label": "Gotówka",
                "fields": {
                    "starting_balance": {"label": "Saldo startowe", "type": "number", "step": 1000},
                    "roi": {
                        "label": "Inflacja (roczny spadek wartości)",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
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
            "zus": {
                "label": "ZUS (składki)",
                "fields": {
                    "starting_balance": {
                        "label": "Kapitał dziś (z eZUS)",
                        "type": "number",
                        "step": 1000,
                    },
                    "starting_balance_ofe": {
                        "label": "Kapitał OFE dziś",
                        "type": "number",
                        "step": 1000,
                        "visible_when": "ofe_member",
                    },
                    "monthly_base": {
                        "label": "Podstawa wymiaru (mies.)",
                        "type": "number",
                        "step": 100,
                    },
                    "ofe_member": {"label": "Członek OFE", "type": "checkbox"},
                    "roi": {
                        "label": "ROI części OFE",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                        "visible_when": "ofe_member",
                    },
                    "waloryzacja_skladek": {
                        "label": "Waloryzacja składek",
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
            "oipe": {
                "label": "OIPE",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "oki": {
                "label": "OKI",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "krypto": {
                "label": "Krypto",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "ppk": {
                "label": "PPK",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "ppe": {
                "label": "PPE",
                "fields": {
                    "roi": {"label": "ROI", "type": "number", "step": "0.1", "percent": True},
                    "buffer": {"label": "Bufor (zostaje)", "type": "number", "step": 1000},
                },
            },
            "gotowka": {
                "label": "Gotówka",
                "fields": {
                    "roi": {
                        "label": "Inflacja (roczny spadek wartości)",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
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
                    "monthly_pension": {
                        "label": "Emerytura mies. (0 = wylicz z kapitału)",
                        "type": "number",
                        "step": 1000,
                    },
                    "waloryzacja_swiadczenia": {
                        "label": "Waloryzacja świadczenia",
                        "type": "number",
                        "step": "0.1",
                        "percent": True,
                    },
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
