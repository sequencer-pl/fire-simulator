"""Lekkie limity żądań dla endpointów kosztownych lub podatnych na nadużycia.

Aplikacja działa na jednym workerze (SQLite single-writer), więc licznik
in-memory jest wystarczający. W razie skalowania trzeba go zastąpić
współdzielonym store'em (Redis itp.).
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 512:
                self._prune(now)
            hits = self._hits[key]
            while hits and now - hits[0] >= self.window_seconds:
                hits.popleft()
            if len(hits) >= self.limit:
                retry_after = max(1, int(self.window_seconds - (now - hits[0])) + 1)
                raise HTTPException(
                    status_code=429,
                    detail="Za dużo żądań. Spróbuj za chwilę.",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _prune(self, now: float) -> None:
        stale = [
            key
            for key, hits in self._hits.items()
            if not hits or now - hits[-1] >= self.window_seconds
        ]
        for key in stale:
            self._hits.pop(key, None)


LIMITS: dict[str, SlidingWindowLimiter] = {
    "login": SlidingWindowLimiter(limit=10, window_seconds=60),
    "register": SlidingWindowLimiter(limit=5, window_seconds=60),
    "simulate": SlidingWindowLimiter(limit=30, window_seconds=60),
    "save": SlidingWindowLimiter(limit=20, window_seconds=60),
    "wizard_plan": SlidingWindowLimiter(limit=6, window_seconds=60),
    "wizard_suggest": SlidingWindowLimiter(limit=20, window_seconds=60),
    "wizard_salary": SlidingWindowLimiter(limit=60, window_seconds=60),
}


def client_ip(request: Request) -> str:
    """Best-effort client IP.

    Poza produkcją ufamy tylko bezpośredniemu połączeniu. W produkcji (Render)
    bierzemy ostatni wpis X-Forwarded-For — to adres dopisany przez proxy;
    pierwszy wpis klient może podrobić.
    """
    if os.environ.get("FIRE_ENV") == "production":
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            parts = [part.strip() for part in forwarded.split(",") if part.strip()]
            if parts:
                return parts[-1]
    return request.client.host if request.client else "unknown"


def check_limit(bucket: str, request: Request) -> None:
    LIMITS[bucket].hit(client_ip(request))


def reset_rate_limits() -> None:
    for limiter in LIMITS.values():
        limiter.reset()
