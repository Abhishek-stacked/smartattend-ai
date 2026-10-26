from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, conflict
from app.core.security import unusable_password_hash
from app.models import User
from app.models.base import utcnow
from app.models.user import ROLE_IDS
from app.services import audit_service, auth_service

USER_FIELDS = ("email", "full_name", "is_active")


def email_taken(db: Session, email: str, exclude_user_id: int | None = None) -> bool:
    stmt = select(User.id).where(User.email == auth_service.normalize_email(email))
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return db.scalar(stmt) is not None


def create_account(db: Session, *, email: str, full_name: str, role: str, actor: User | None, request=None) -> User:
    """Creates a login with an unusable password; the person sets one via a reset link."""
    email = auth_service.normalize_email(email)
    if email_taken(db, email):
        raise conflict("email_exists", "An account with this email already exists")
    user = User(email=email, full_name=full_name.strip(), role_id=ROLE_IDS[role], password_hash=unusable_password_hash())
    db.add(user)
    db.flush()
    audit_service.record(db, actor=actor, action="user.create", entity_type="user", entity_id=user.id,
                         after={"email": email, "full_name": user.full_name, "role": role}, request=request)
    return user


def update_user(db: Session, user: User, *, actor: User, full_name: str | None, is_active: bool | None,
                unlock: bool | None, request=None) -> User:
    before = audit_service.snapshot(user, USER_FIELDS)
    if is_active is False and user.id == actor.id:
        raise AppError(400, "cannot_deactivate_self", "You cannot deactivate your own account")
    if full_name is not None:
        user.full_name = full_name.strip()
    if is_active is not None and is_active != user.is_active:
        user.is_active = is_active
        if not is_active:
            auth_service.revoke_all_sessions(db, user.id)
    if unlock:
        user.locked_until = None
        user.failed_login_attempts = 0
    user.updated_at = utcnow()
    audit_service.record(db, actor=actor, action="user.update", entity_type="user", entity_id=user.id,
                         before=before, after=audit_service.snapshot(user, USER_FIELDS) | {"unlocked": bool(unlock)},
                         request=request)
    db.commit()
    return user
