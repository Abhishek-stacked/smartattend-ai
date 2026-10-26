from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.access import student_or_forbidden
from app.api.deps import PageParams, page_params
from app.core.database import get_db
from app.core.errors import AppError
from app.models import User
from app.models.attendance import ATTENDANCE_STATUSES
from app.schemas.reports import MeSummaryOut
from app.schemas.session import AttendanceOut
from app.schemas.common import Page, paginate
from app.services import attendance_service, reports_service

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/summary", response_model=MeSummaryOut)
def get_my_summary(
    date_from: date | None = None,
    date_to: date | None = None,
    course_id: int | None = None,
    user: User = Depends(student_or_forbidden),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise AppError(422, "invalid_date_range", "date_from must be on or before date_to")
    payload = reports_service.summary(
        db, reports_service.scope_for(user), date_from=date_from, date_to=date_to, course_id=course_id
    )
    return MeSummaryOut(
        **payload,
        student_id=user.student.id,
        registration_number=user.student.registration_number,
    )


@router.get("/attendance", response_model=Page[AttendanceOut])
def get_my_attendance(
    course_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
    paging: PageParams = Depends(page_params),
    user: User = Depends(student_or_forbidden),
    db: Session = Depends(get_db),
):
    if status_filter is not None and status_filter not in ATTENDANCE_STATUSES:
        raise AppError(422, "invalid_status", "Unknown attendance status")
    stmt = attendance_service.search_records(
        db, session_id=None, course_id=course_id, student_id=user.student.id,
        status=status_filter, date_from=date_from, date_to=date_to, faculty_id=None,
    )
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    return Page(
        items=[AttendanceOut(**attendance_service.record_out(record)) for record in items],
        total=total, page=paging.page, page_size=paging.page_size,
    )
