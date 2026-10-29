import logging
import re
import uuid

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    attendance,
    auth,
    corrections,
    courses,
    enrollment,
    faculty,
    me,
    recognition,
    reports,
    review,
    sessions,
    students,
    system,
    users,
)
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.ratelimit import rate_limit

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,36}$")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if settings.is_production and not settings.cookie_secure:
        logging.getLogger(__name__).warning(
            "APP_ENV=production with COOKIE_SECURE=false: session cookies will be sent over plain HTTP. "
            "Terminate TLS and set COOKIE_SECURE=true."
        )

    # Swagger UI pulls its assets from a CDN, which the production CSP forbids,
    # so the interactive docs are a development-only surface.
    docs_enabled = not settings.is_production

    app = FastAPI(
        title="SmartAttend AI API",
        version="1.0.0",
        description="Face-recognition attendance management. All endpoints are under /api.",
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
    )
    register_error_handlers(app)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        incoming = request.headers.get("X-Request-ID", "")
        request.state.request_id = incoming if _REQUEST_ID_RE.match(incoming) else str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Content-Disposition"],
    )

    api = APIRouter(prefix="/api", dependencies=[Depends(rate_limit("api", 600, 60))])
    for module in (system, auth, users, students, faculty, courses, sessions, attendance, enrollment,
                   recognition, review, corrections, reports, me):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
