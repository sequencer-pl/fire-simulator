from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.web.routes import router

app = FastAPI(title="FIRE Simulator")

app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(router)
