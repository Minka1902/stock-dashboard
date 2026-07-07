"""Web-layer protections: security headers and in-process rate limiting.

Both are deliberately in-memory and single-process — this app runs as one
uvicorn worker (the scheduler, TTL caches and shared SQLite connection all
assume that). See docs/scaling-roadmap.md before adding workers.
"""
import threading
import time

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if request.url.path.startswith("/api/auth/"):
            # Auth responses carry codes/secrets — never let a cache keep them.
            response.headers["Cache-Control"] = "no-store"
        return response


class RateLimiter:
    """Fixed-window counter keyed by (bucket, key). Thread-safe.

    Windows are coarse by design: good enough to blunt brute force and
    accidental hammering, tiny enough to need no external store.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._counts: dict[tuple[str, str], tuple[float, int]] = {}

    def check(self, bucket: str, key: str, limit: int, window_seconds: int,
              now: float | None = None) -> float | None:
        """Count one hit. Returns None if allowed, else seconds until reset."""
        now = time.monotonic() if now is None else now
        with self._lock:
            window_start, count = self._counts.get((bucket, key), (now, 0))
            if now - window_start >= window_seconds:
                window_start, count = now, 0
            count += 1
            self._counts[(bucket, key)] = (window_start, count)
            if count > limit:
                return max(1.0, window_seconds - (now - window_start))
            return None

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


limiter = RateLimiter()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """FastAPI dependency factory: 429 (+ Retry-After) past `limit` hits per window.

    Keys on the authenticated user when available (set by the auth middleware),
    falling back to client IP for anonymous endpoints like login.
    """

    def dependency(request: Request) -> None:
        user = getattr(request.state, "user", None)
        key = f"user:{user.id}" if user is not None else f"ip:{_client_ip(request)}"
        retry_after = limiter.check(bucket, key, limit, window_seconds)
        if retry_after is not None:
            raise HTTPException(
                status_code=429,
                detail="too many requests",
                headers={"Retry-After": str(int(retry_after))},
            )

    return dependency
