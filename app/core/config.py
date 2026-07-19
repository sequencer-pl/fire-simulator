from pydantic import BaseModel


class AppConfig(BaseModel):
    app_name: str = "FIRE Simulator"
    default_start_age: int = 48
    default_fire_age: int = 50
    default_ike_age: int = 60
    default_ikze_age: int = 65
    default_zus_age: int = 70


settings = AppConfig()
