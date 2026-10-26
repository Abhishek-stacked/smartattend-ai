from fastapi import Depends

from app.api.deps import current_user
from app.core.errors import forbidden
from app.models import AttendanceSession, Course, User
from app.models.user import ROLE_ADMIN, ROLE_FACULTY, ROLE_STUDENT


def faculty_id_or_none(user: User) -> int | None:
    return user.faculty.id if user.faculty else None


def staff_scope(user: User = Depends(current_user)) -> User:
    if user.role_name not in (ROLE_ADMIN, ROLE_FACULTY):
        raise forbidden()
    if user.role_name == ROLE_FACULTY and user.faculty is None:
        raise forbidden("Your account is not linked to a faculty profile")
    return user


def student_or_forbidden(user: User = Depends(current_user)) -> User:
    if user.role_name != ROLE_STUDENT or user.student is None:
        raise forbidden()
    return user


def can_manage_course(user: User, course: Course) -> bool:
    if user.role_name == ROLE_ADMIN:
        return True
    return user.role_name == ROLE_FACULTY and course.faculty_id is not None and \
        course.faculty_id == faculty_id_or_none(user)


def can_view_session(user: User, session: AttendanceSession) -> bool:
    return can_manage_course(user, session.course)
