from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import PageParams, page_params, require_roles
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import forbidden, not_found
from app.models import Role, User
from app.models.base import utcnow
from app.models.user import ROLE_ADMIN
from app.schemas.auth import AdminCreateIn, PasswordSetIn, ResetLinkOut, RoleName, UserCreatedOut, UserOut, UserUpdateIn
from app.schemas.common import Page, like_pattern, paginate
from app.services import auth_service, user_service

router = APIRouter(prefix="/users", tags=["users"])
admin_only = require_roles(ROLE_ADMIN)


@router.get("", response_model=Page[UserOut])
def list_users(
    q: str | None = Query(None, max_length=100),
    role: RoleName | None = None,
    is_active: bool | None = None,
    paging: PageParams = Depends(page_params),
    _: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    stmt = select(User).join(Role).order_by(User.full_name, User.id)
    if q:
        stmt = stmt.where(or_(User.full_name.ilike(like_pattern(q)), User.email.ilike(like_pattern(q))))
    if role:
        stmt = stmt.where(Role.name == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    now = utcnow()
    return Page(items=[UserOut.from_user(u, now) for u in items], total=total, page=paging.page,
                page_size=paging.page_size)


@router.post("", response_model=UserCreatedOut, status_code=status.HTTP_201_CREATED)
def create_admin(body: AdminCreateIn, request: Request, actor: User = Depends(admin_only),
                 db: Session = Depends(get_db)):
    if actor.email.lower() != get_settings().primary_admin_email.strip().lower():
        raise forbidden("Only the primary administrator can add administrator accounts")
    user = user_service.create_account(db, email=body.email, full_name=body.full_name, role=body.role,
                                       actor=actor, request=request)
    db.commit()
    url, expires = auth_service.issue_reset_link(db, user, actor, request)
    return UserCreatedOut(user=UserOut.from_user(user, utcnow()), reset=ResetLinkOut(reset_url=url, expires_at=expires))


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdateIn, request: Request, actor: User = Depends(admin_only),
                db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    user_service.update_user(db, user, actor=actor, full_name=body.full_name, is_active=body.is_active,
                             unlock=body.unlock, request=request)
    return UserOut.from_user(user, utcnow())


@router.post("/{user_id}/reset-link", response_model=ResetLinkOut)
def reset_link(user_id: int, request: Request, actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    url, expires = auth_service.issue_reset_link(db, user, actor, request)
    return ResetLinkOut(reset_url=url, expires_at=expires)


@router.post("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def set_password(user_id: int, body: PasswordSetIn, request: Request, actor: User = Depends(admin_only),
                 db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    auth_service.set_password_by_admin(db, user, body.password, actor, request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
