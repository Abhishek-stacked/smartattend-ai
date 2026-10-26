from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import PageParams, current_user, page_params, require_roles
from app.core.database import get_db
from app.core.errors import not_found
from app.models import Course, CourseEnrollment, Student, User
from app.models.base import utcnow
from app.models.people import STUDENT_STATUSES
from app.models.user import ROLE_ADMIN, ROLE_FACULTY, ROLE_STUDENT
from app.schemas.auth import AccountPasswordOut, PasswordSetIn, ResetLinkOut, UserCreatedOut, UserOut
from app.schemas.common import Page, paginate
from app.schemas.people import ReasonIn, StudentDetail, StudentIn, StudentOut, StudentUpdate
from app.services import people_service

router = APIRouter(prefix="/students", tags=["students"])
admin_only = require_roles(ROLE_ADMIN)


def _visible_or_404(db: Session, user: User, student: Student) -> None:
    if user.role_name == ROLE_ADMIN:
        return
    if user.role_name == ROLE_STUDENT and user.student and user.student.id == student.id:
        return
    if user.role_name == ROLE_FACULTY and user.faculty:
        shared = db.scalar(
            select(CourseEnrollment.id)
            .join(Course, Course.id == CourseEnrollment.course_id)
            .where(
                CourseEnrollment.student_id == student.id,
                CourseEnrollment.status == "active",
                Course.faculty_id == user.faculty.id,
            )
        )
        if shared is not None:
            return
    raise not_found("Student")


@router.get("", response_model=Page[StudentOut])
def list_students(
    q: str | None = Query(None, max_length=100),
    department: str | None = Query(None, max_length=80),
    program: str | None = Query(None, max_length=80),
    status_filter: str | None = Query(None, alias="status"),
    course_id: int | None = None,
    paging: PageParams = Depends(page_params),
    _: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    if status_filter and status_filter not in STUDENT_STATUSES:
        status_filter = "__invalid__"
    stmt = people_service.search_students(db, q=q, department=department, program=program, status=status_filter,
                                          course_id=course_id)
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    return Page(items=[StudentOut.model_validate(s) for s in items], total=total, page=paging.page,
                page_size=paging.page_size)


@router.post("", response_model=StudentOut, status_code=status.HTTP_201_CREATED)
def create_student(body: StudentIn, request: Request, actor: User = Depends(admin_only),
                   db: Session = Depends(get_db)):
    student = people_service.create_student(db, body, actor, request)
    return StudentOut.model_validate(student)


@router.get("/{student_id}", response_model=StudentDetail)
def get_student(student_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student = people_service.get_student(db, student_id)
    _visible_or_404(db, user, student)
    return StudentDetail(**people_service.student_detail(db, student))


@router.patch("/{student_id}", response_model=StudentOut)
def update_student(student_id: int, body: StudentUpdate, request: Request,
                   actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    student = people_service.get_student(db, student_id)
    student = people_service.update_student(db, student, body, actor, request)
    return StudentOut.model_validate(student)


@router.post("/{student_id}/deactivate", response_model=StudentOut)
def deactivate_student(student_id: int, body: ReasonIn, request: Request,
                       actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    student = people_service.get_student(db, student_id)
    student = people_service.deactivate_student(db, student, body.reason, actor, request)
    return StudentOut.model_validate(student)


@router.post("/{student_id}/account", response_model=UserCreatedOut)
def create_student_account(student_id: int, request: Request, actor: User = Depends(admin_only),
                           db: Session = Depends(get_db)):
    student = people_service.get_student(db, student_id)
    user, url, expires = people_service.student_account(db, student, actor, request)
    return UserCreatedOut(user=UserOut.from_user(user, utcnow()), reset=ResetLinkOut(reset_url=url, expires_at=expires))


@router.post("/{student_id}/password", response_model=AccountPasswordOut)
def set_student_password(student_id: int, body: PasswordSetIn, request: Request,
                         actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    student = people_service.get_student(db, student_id)
    user, created = people_service.set_student_password(db, student, body.password, actor, request)
    return AccountPasswordOut(user=UserOut.from_user(user, utcnow()), account_created=created)