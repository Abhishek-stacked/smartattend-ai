from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import (
    hash_password,
    hash_token,
    needs_rehash,
    new_token,
    password_problems,
    verify_password,
)
from app.models import AuthSession, PasswordResetToken, User
from app.models.base import utcnow
from app.services import audit_service

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15
RESET_TOKEN_HOURS = 24
LAST_SEEN_WRITE_INTERVAL = timedelta(seconds=60)

INVALID_CREDENTIALS = AppError(401, "invalid_credentials", "Invalid email or password")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def authenticate(db: Session, email: str, password: str, request: Request | None = None) -> User:
    now = utcnow()
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is not None and user.locked_until and user.locked_until > now:
        verify_password(None, password)
        raise AppError(429, "account_locked", "Too many failed attempts. Try again later.",
                       {"retry_after_s": int((user.locked_until - now).total_seconds())})

    ok = verify_password(user.password_hash if user else None, password)
    if not ok or user is None or not user.is_active:
        if user is not None:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_login_attempts = 0
            audit_service.record(db, actor=None, action="auth.login_failed", entity_type="user",
                                 entity_id=user.id, request=request)
            db.commit()
        raise INVALID_CREDENTIALS

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return user


def create_session(db: Session, user: User, request: Request | None = None) -> str:
    settings = get_settings()
    token = new_token()
    now = utcnow()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(minutes=settings.session_ttl_minutes),
            ip_address=request.client.host if request and request.client else None,
            user_agent=(request.headers.get("user-agent", "")[:255] if request else None),
        )
    )
    audit_service.record(db, actor=user, action="auth.login", entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return token


def resolve_session(db: Session, token: str | None) -> AuthSession | None:
    if not token:
        return None
    settings = get_settings()
    s = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    now = utcnow()
    if s is None or s.revoked_at is not None or s.expires_at <= now:
        return None
    if s.last_seen_at + timedelta(minutes=settings.session_idle_minutes) <= now:
        s.revoked_at = now
        db.commit()
        return None
    if not s.user.is_active:
        return None
    if now - s.last_seen_at >= LAST_SEEN_WRITE_INTERVAL:
        s.last_seen_at = now
        db.commit()
    return s


def revoke_session(db: Session, session: AuthSession) -> None:
    session.revoked_at = utcnow()
    db.commit()


def revoke_all_sessions(db: Session, user_id: int, except_id: int | None = None) -> None:
    stmt = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if except_id is not None:
        stmt = stmt.where(AuthSession.id != except_id)
    db.execute(stmt.values(revoked_at=utcnow()))


def validate_new_password(password: str, email: str) -> None:
    problems = password_problems(password, email)
    if problems:
        raise AppError(422, "weak_password", "Password " + "; ".join(problems), problems)


def change_password(db: Session, user: User, session: AuthSession, current: str, new: str, request=None) -> None:
    if not verify_password(user.password_hash, current):
        raise AppError(400, "invalid_current_password", "Current password is incorrect")
    validate_new_password(new, user.email)
    user.password_hash = hash_password(new)
    user.password_changed_at = utcnow()
    revoke_all_sessions(db, user.id, except_id=session.id)
    audit_service.record(db, actor=user, action="auth.password_changed", entity_type="user", entity_id=user.id, request=request)
    db.commit()


def issue_reset_link(db: Session, target: User, actor: User, request=None) -> tuple[str, datetime]:
    token = new_token()
    expires = utcnow() + timedelta(hours=RESET_TOKEN_HOURS)
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == target.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    db.add(PasswordResetToken(user_id=target.id, token_hash=hash_token(token), expires_at=expires, created_by_user_id=actor.id))
    audit_service.record(db, actor=actor, action="user.reset_link_issued", entity_type="user", entity_id=target.id, request=request)
    db.commit()
    url = f"{get_settings().frontend_base_url.rstrip('/')}/reset-password?token={token}"
    return url, expires


def reset_password(db: Session, token: str, new: str, request=None) -> None:
    row = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token)).with_for_update()
    )
    now = utcnow()
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise AppError(400, "invalid_reset_token", "This reset link is invalid or has expired")
    user = db.get(User, row.user_id)
    assert user is not None
    validate_new_password(new, user.email)
    user.password_hash = hash_password(new)
    user.password_changed_at = now
    user.failed_login_attempts = 0
    user.locked_until = None
    row.used_at = now
    revoke_all_sessions(db, user.id)
    audit_service.record(db, actor=user, action="auth.password_reset", entity_type="user", entity_id=user.id, request=request)
    db.commit()


def set_password_by_admin(db: Session, target: User, new: str, actor: User, request=None) -> None:
    """Administrator sets a password directly; outstanding reset links are cancelled."""
    validate_new_password(new, target.email)
    now = utcnow()
    target.password_hash = hash_password(new)
    target.password_changed_at = now
    target.failed_login_attempts = 0
    target.locked_until = None
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == target.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    revoke_all_sessions(db, target.id)
    audit_service.record(db, actor=actor, action="auth.password_set", entity_type="user", entity_id=target.id,
                         reason="administrator set password", request=request)
    db.commit()
