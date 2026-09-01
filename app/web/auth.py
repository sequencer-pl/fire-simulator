import sqlite3
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.security import hash_password, is_valid_password, verify_password
from app.storage import db

from .routes import _current_user_id, _now

router = APIRouter()

_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = 10
_RATE_WINDOW = 60.0


def _check_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    attempts = _login_attempts[ip]
    attempts[:] = [t for t in attempts if now - t < _RATE_WINDOW]
    if len(attempts) >= _RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Za dużo prób logowania. Spróbuj za chwilę.")
    attempts.append(now)


class AuthPayload(BaseModel):
    email: str
    password: str


@router.post("/api/register")
async def api_register(payload: AuthPayload, request: Request):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Podaj poprawny adres e-mail.")
    if not is_valid_password(payload.password):
        raise HTTPException(status_code=400, detail="Hasło musi mieć co najmniej 8 znaków.")
    try:
        user_id = db.create_user(email, hash_password(payload.password), _now())
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Konto z tym e-mailem już istnieje.") from None
    request.session["user_id"] = user_id
    return {"email": email}


@router.post("/api/login")
async def api_login(payload: AuthPayload, request: Request):
    _check_rate_limit(request)
    email = payload.email.strip().lower()
    user = db.get_user_by_email(email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Nieprawidłowy e-mail lub hasło.")
    request.session["user_id"] = user["id"]
    return {"email": email}


@router.post("/api/logout")
async def api_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/api/session")
async def api_session(request: Request):
    user_id = _current_user_id(request)
    if not user_id:
        return {"email": None}
    user = db.get_user_by_id(user_id)
    if not user:
        request.session.clear()
        return {"email": None}
    return {"email": user["email"]}
