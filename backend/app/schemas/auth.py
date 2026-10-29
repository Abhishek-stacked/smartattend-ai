from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.core.config import get_settings
from app.models import User

RoleName = Literal["admin", "faculty", "student"]


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class MeOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: RoleName
    student_id: int | None = None
    faculty_id: int | None = None
    last_login_at: datetime | None = None
    can_create_admins: bool = False

    @classmethod
    def from_user(cls, user: User) -> "MeOut":
        primary = get_settings().primary_admin_email.strip().lower()
        return cls(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role_name,  # type: ignore[arg-type]
            student_id=user.student.id if user.student else None,
            faculty_id=user.faculty.id if user.faculty else None,
            last_login_at=user.last_login_at,
            can_create_admins=user.role_name == "admin" and user.email.lower() == primary,
        )


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: RoleName
    is_active: bool
    locked: bool
    last_login_at: datetime | None
    created_at: datetime
    student_id: int | None = None
    faculty_id: int | None = None

    @classmethod
    def from_user(cls, user: User, now: datetime) -> "UserOut":
        return cls(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role_name,  # type: ignore[arg-type]
            is_active=user.is_active,
            locked=bool(user.locked_until and user.locked_until > now),
            last_login_at=user.last_login_at,
            created_at=user.created_at,
            student_id=user.student.id if user.student else None,
            faculty_id=user.faculty.id if user.faculty else None,
        )


class AdminCreateIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    role: Literal["admin"] = "admin"


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    is_active: bool | None = None
    unlock: bool | None = None


class ResetLinkOut(BaseModel):
    reset_url: str
    expires_at: datetime
    note: str = "Share this link privately. It is shown only once and works a single time."


class PasswordSetIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class UserCreatedOut(BaseModel):
    user: UserOut
    reset: ResetLinkOut


class AccountPasswordOut(BaseModel):
    user: UserOut
    account_created: bool = False
