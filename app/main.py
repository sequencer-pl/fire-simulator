import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

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

_CSP = (
    "default-src 'self'; "
    "script-src 'self' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


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


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", _CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
    )
    return response


@app.middleware("http")
async def reject_cross_origin_writes(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        host = request.headers.get("host")
        if origin and host and urlparse(origin).netloc != host:
            return JSONResponse(
                status_code=403,
                content={"detail": "Niedozwolone źródło żądania."},
            )
    return await call_next(request)


@app.get("/healthz")
async def healthz(_: Request):
    """Liveness/readiness probe used by the hosting platform."""
    try:
        with connect() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "db": False})
    return {"status": "ok", "db": True}


app.mount(
    "/static",
    StaticFiles(directory=str(Path(__file__).resolve().parents[1] / "static")),
    name="static",
)
app.include_router(router)
app.include_router(auth_router)
app.include_router(simulations_router)
