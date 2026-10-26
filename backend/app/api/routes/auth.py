from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CSRF_COOKIE, SESSION_COOKIE, AuthContext, check_csrf, current_user, get_auth
from app.core.config import get_settings
from app.core.database import get_db
from app.core.ratelimit import rate_limit
from app.core.security import new_token
from app.models import User
from app.schemas.auth import ChangePasswordIn, LoginIn, MeOut, ResetPasswordIn
from app.schemas.common import Message
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_auth_cookies(response: Response, token: str) -> None:
    s = get_settings()
    max_age = s.session_ttl_minutes * 60
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure,
                        samesite="lax", path="/")
    response.set_cookie(CSRF_COOKIE, new_token(), max_age=max_age, httponly=False, secure=s.cookie_secure,
                        samesite="lax", path="/")


def _clear_auth_cookies(response: Response) -> None:
    s = get_settings()
    for name, http_only in ((SESSION_COOKIE, True), (CSRF_COOKIE, False)):
        response.delete_cookie(name, path="/", secure=s.cookie_secure, httponly=http_only, samesite="lax")


@router.post("/login", response_model=MeOut, dependencies=[Depends(rate_limit("login", 10, 60))])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    user = auth_service.authenticate(db, body.email, body.password, request)
    token = auth_service.create_session(db, user, request)
    _set_auth_cookies(response, token)
    return MeOut.from_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    session = auth_service.resolve_session(db, request.cookies.get(SESSION_COOKIE))
    if session is not None:
        check_csrf(request)
        auth_service.revoke_session(db, session)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_auth_cookies(response)
    return response


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return MeOut.from_user(user)


@router.post("/change-password", response_model=Message)
def change_password(body: ChangePasswordIn, request: Request, ctx: AuthContext = Depends(get_auth),
                    db: Session = Depends(get_db)) -> Message:
    auth_service.change_password(db, ctx.user, ctx.session, body.current_password, body.new_password, request)
    return Message(message="Password changed. Other signed-in devices were signed out.")


@router.post("/reset-password", response_model=Message, dependencies=[Depends(rate_limit("reset", 10, 900))])
def reset_password(body: ResetPasswordIn, request: Request, db: Session = Depends(get_db)) -> Message:
    auth_service.reset_password(db, body.token, body.new_password, request)
    return Message(message="Password updated. You can now sign in.")
