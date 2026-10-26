import hmac
from dataclasses import dataclass

from fastapi import Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, forbidden
from app.models import AuthSession, User
from app.services import auth_service

SESSION_COOKIE = "sa_session"
CSRF_COOKIE = "sa_csrf"
CSRF_HEADER = "X-CSRF-Token"
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class AuthContext:
    user: User
    session: AuthSession


def check_csrf(request: Request) -> None:
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get(CSRF_HEADER, "")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise AppError(403, "csrf_failed", "Security token missing or invalid. Reload the page and try again.")


def get_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    session = auth_service.resolve_session(db, request.cookies.get(SESSION_COOKIE))
    if session is None:
        raise AppError(401, "unauthenticated", "Please sign in to continue")
    if request.method in _UNSAFE_METHODS:
        check_csrf(request)
    request.state.user_id = session.user_id
    return AuthContext(user=session.user, session=session)


def current_user(ctx: AuthContext = Depends(get_auth)) -> User:
    return ctx.user


def require_roles(*roles: str):
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role_name not in roles:
            raise forbidden()
        return user

    return dependency


@dataclass
class PageParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(20, ge=1, le=100),
) -> PageParams:
    return PageParams(page, page_size)
