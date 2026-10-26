from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.access import can_manage_course, faculty_id_or_none, staff_scope
from app.api.deps import PageParams, page_params, require_roles
from app.core.database import get_db
from app.core.errors import AppError, not_found
from app.models import CourseEnrollment, User
from app.models.course import COURSE_STATUSES
from app.models.user import ROLE_ADMIN
from app.schemas.common import Page, paginate
from app.schemas.course import CourseIn, CourseOut, CourseUpdate, EnrollmentIn, EnrollmentResult, RosterStudent
from app.services import course_service

router = APIRouter(prefix="/courses", tags=["courses"])
admin_only = require_roles(ROLE_ADMIN)


@router.get("", response_model=Page[CourseOut])
def list_courses(
    q: str | None = Query(None, max_length=100),
    department: str | None = Query(None, max_length=80),
    status_filter: str | None = Query(None, alias="status"),
    paging: PageParams = Depends(page_params),
    user: User = Depends(staff_scope),
    db: Session = Depends(get_db),
):
    if status_filter and status_filter not in COURSE_STATUSES:
        status_filter = "__invalid__"
    scope = None if user.role_name == ROLE_ADMIN else faculty_id_or_none(user)
    stmt = course_service.search_courses(db, q=q, department=department, status=status_filter, faculty_id=scope)
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    return Page(items=[CourseOut(**course_service.course_out(db, c)) for c in items], total=total,
                page=paging.page, page_size=paging.page_size)


@router.post("", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
def create_course(body: CourseIn, request: Request, actor: User = Depends(admin_only),
                  db: Session = Depends(get_db)):
    course = course_service.create_course(db, body, actor, request)
    return CourseOut(**course_service.course_out(db, course))


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: int, user: User = Depends(staff_scope), db: Session = Depends(get_db)):
    course = course_service.get_course(db, course_id)
    if not can_manage_course(user, course):
        raise not_found("Course")
    return CourseOut(**course_service.course_out(db, course))


@router.patch("/{course_id}", response_model=CourseOut)
def update_course(course_id: int, body: CourseUpdate, request: Request, actor: User = Depends(admin_only),
                  db: Session = Depends(get_db)):
    course = course_service.get_course(db, course_id)
    course = course_service.update_course(db, course, body, actor, request)
    return CourseOut(**course_service.course_out(db, course))


@router.get("/{course_id}/enrollments", response_model=Page[RosterStudent])
def list_enrollments(course_id: int, paging: PageParams = Depends(page_params),
                     user: User = Depends(staff_scope), db: Session = Depends(get_db)):
    course = course_service.get_course(db, course_id)
    if not can_manage_course(user, course):
        raise not_found("Course")
    rows = course_service.roster(db, course)
    start = (paging.page - 1) * paging.page_size
    return Page(items=[RosterStudent(**r) for r in rows[start:start + paging.page_size]], total=len(rows),
                page=paging.page, page_size=paging.page_size)


@router.post("/{course_id}/enrollments", response_model=EnrollmentResult)
def add_enrollments(course_id: int, body: EnrollmentIn, request: Request, actor: User = Depends(admin_only),
                    db: Session = Depends(get_db)):
    course = course_service.get_course(db, course_id)
    if course.status != "active":
        raise AppError(400, "course_archived", "Students cannot be enrolled in an archived course")
    result = course_service.enroll_students(db, course, body.student_ids, actor, request)
    rows = {r["student_id"]: r for r in course_service.roster(db, course)}
    return EnrollmentResult(items=[RosterStudent(**rows[i]) for i in body.student_ids if i in rows], **result)


@router.delete("/{course_id}/enrollments/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def drop_enrollment(course_id: int, student_id: int, request: Request, actor: User = Depends(admin_only),
                    db: Session = Depends(get_db)):
    course = course_service.get_course(db, course_id)
    course_service.drop_enrollment(db, course, student_id, actor, request)
