from app.stages.akumulacja import AkumulacjaStage
from app.stages.base import BaseStage
from app.stages.metadata import STAGE_META
from app.stages.realizacja import RealizacjaStage

STAGE_CLASSES: dict[str, type[BaseStage]] = {
    "akumulacja": AkumulacjaStage,
    "realizacja": RealizacjaStage,
}


def create_stage(stage_type: str) -> BaseStage:
    cls = STAGE_CLASSES.get(stage_type)
    if not cls:
        raise ValueError(f"Nieznany typ etapu: {stage_type}")
    return cls()


def get_all_stage_types() -> dict:
    return STAGE_META
