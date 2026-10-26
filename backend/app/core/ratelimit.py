"""In-process sliding-window rate limiter (single-process deployments)."""

import threading
import time
from collections import deque

from fastapi import Request

from app.core.errors import AppError


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_s: float) -> tuple[bool, float]:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                return False, window_s - (now - q[0])
            q.append(now)
            if len(self._hits) > 50_000:
                self._evict(now, window_s)
            return True, 0.0

    def _evict(self, now: float, window_s: float) -> None:
        for k in [k for k, q in self._hits.items() if not q or q[-1] <= now - window_s]:
            del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, limit: int, window_s: float, per: str = "ip"):
    def dependency(request: Request) -> None:
        if per == "user" and getattr(request.state, "user_id", None):
            key = f"{name}:u:{request.state.user_id}"
        else:
            key = f"{name}:ip:{client_ip(request)}"
        ok, retry = limiter.hit(key, limit, window_s)
        if not ok:
            raise AppError(429, "rate_limited", "Too many requests. Please wait and try again.", {"retry_after_s": round(retry, 1)})

    return dependency
