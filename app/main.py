import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.core.secret import get_secret_key
from app.storage.db import connect, init_db
from app.web.auth import router as auth_router
from app.web.routes import router
from app.web.simulations import router as simulations_router

IS_PRODUCTION = os.environ.get("FIRE_ENV") == "production"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="FIRE Simulator",
    lifespan=lifespan,
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

app.add_middleware(
    SessionMiddleware,
    secret_key=get_secret_key(require_env=IS_PRODUCTION),
    https_only=IS_PRODUCTION,
    same_site="lax",
)


@app.get("/healthz")
async def healthz(_: Request):
    """Liveness/readiness probe used by the hosting platform."""
    try:
        with connect() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "db": False})
    return {"status": "ok", "db": True}


app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(router)
app.include_router(auth_router)
app.include_router(simulations_router)
