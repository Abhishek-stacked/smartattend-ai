from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import PageParams, current_user, page_params, require_roles
from app.core.database import get_db
from app.core.errors import forbidden, not_found
from app.models import Faculty, User
from app.models.base import utcnow
from app.models.people import FACULTY_STATUSES
from app.models.user import ROLE_ADMIN, ROLE_FACULTY
from app.schemas.auth import ResetLinkOut, UserCreatedOut, UserOut
from app.schemas.common import Page, paginate
from app.schemas.people import FacultyDetail, FacultyIn, FacultyOut, FacultyUpdate, ReasonIn
from app.services import people_service

router = APIRouter(prefix="/faculty", tags=["faculty"])
admin_only = require_roles(ROLE_ADMIN)


@router.get("", response_model=Page[FacultyOut])
def list_faculty(
    q: str | None = Query(None, max_length=100),
    department: str | None = Query(None, max_length=80),
    status_filter: str | None = Query(None, alias="status"),
    paging: PageParams = Depends(page_params),
    _: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    if status_filter and status_filter not in FACULTY_STATUSES:
        status_filter = "__invalid__"
    stmt = people_service.search_faculty(db, q=q, department=department, status=status_filter)
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    return Page(items=[FacultyOut.model_validate(f) for f in items], total=total, page=paging.page,
                page_size=paging.page_size)


@router.post("", response_model=FacultyOut, status_code=status.HTTP_201_CREATED)
def create_faculty(body: FacultyIn, request: Request, actor: User = Depends(admin_only),
                   db: Session = Depends(get_db)):
    faculty = people_service.create_faculty(db, body, actor, request)
    return FacultyOut.model_validate(faculty)


@router.get("/{faculty_id}", response_model=FacultyDetail)
def get_faculty(faculty_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role_name not in (ROLE_ADMIN, ROLE_FACULTY):
        raise forbidden()
    if user.role_name == ROLE_FACULTY and (user.faculty is None or user.faculty.id != faculty_id):
        raise not_found("Faculty member")
    faculty = people_service.get_faculty(db, faculty_id)
    return FacultyDetail(**people_service.faculty_detail(db, faculty))


@router.patch("/{faculty_id}", response_model=FacultyOut)
def update_faculty(faculty_id: int, body: FacultyUpdate, request: Request,
                   actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    faculty = people_service.get_faculty(db, faculty_id)
    faculty = people_service.update_faculty(db, faculty, body, actor, request)
    return FacultyOut.model_validate(faculty)


@router.post("/{faculty_id}/deactivate", response_model=FacultyOut)
def deactivate_faculty(faculty_id: int, body: ReasonIn, request: Request,
                       actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    faculty = people_service.get_faculty(db, faculty_id)
    faculty = people_service.deactivate_faculty(db, faculty, body.reason, actor, request)
    return FacultyOut.model_validate(faculty)


@router.post("/{faculty_id}/account", response_model=UserCreatedOut)
def create_faculty_account(faculty_id: int, request: Request, actor: User = Depends(admin_only),
                           db: Session = Depends(get_db)):
    faculty: Faculty = people_service.get_faculty(db, faculty_id)
    user, url, expires = people_service.faculty_account(db, faculty, actor, request)
    return UserCreatedOut(user=UserOut.from_user(user, utcnow()), reset=ResetLinkOut(reset_url=url, expires_at=expires))
