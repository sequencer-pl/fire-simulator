from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.core.secret import get_secret_key
from app.storage.db import init_db
from app.web.routes import router
from app.web.auth import router as auth_router
from app.web.simulations import router as simulations_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="FIRE Simulator", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=get_secret_key(),
    https_only=False,
    same_site="lax",
)

app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(router)
app.include_router(auth_router)
app.include_router(simulations_router)
