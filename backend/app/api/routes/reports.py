from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.access import can_manage_course, staff_scope
from app.api.deps import PageParams, page_params
from app.core.database import get_db
from app.core.errors import AppError, not_found
from app.models import Course, User
from app.schemas.reports import (
    ActivityOut,
    ReportOut,
    SummaryOut,
    TrendsOut,
)
from app.services import reports_service

router = APIRouter(prefix="/reports", tags=["reports"])

CORRECTION_STATUSES = ("pending", "approved", "rejected", "withdrawn")


def _range(date_from: date | None, date_to: date | None) -> None:
    if date_from and date_to and date_from > date_to:
        raise AppError(422, "invalid_date_range", "date_from must be on or before date_to")


def _course(db: Session, user: User, course_id: int | None) -> None:
    if course_id is None:
        return
    course = db.get(Course, course_id)
    if course is None or not can_manage_course(user, course):
        raise not_found("Course")


@router.get("/summary", response_model=SummaryOut)
def get_summary(
    date_from: date | None = None,
    date_to: date | None = None,
    course_id: int | None = None,
    user: User = Depends(staff_scope),
    db: Session = Depends(get_db),
):
    _range(date_from, date_to)
    _course(db, user, course_id)
    return reports_service.summary(
        db, reports_service.scope_for(user), date_from=date_from, date_to=date_to, course_id=course_id
    )


@router.get("/trends", response_model=TrendsOut)
def get_trends(
    granularity: str = Query("day", pattern="^(day|week|month)$"),
    date_from: date | None = None,
    date_to: date | None = None,
    course_id: int | None = None,
    user: User = Depends(staff_scope),
    db: Session = Depends(get_db),
):
    _range(date_from, date_to)
    _course(db, user, course_id)
    return reports_service.trends(
        db, reports_service.scope_for(user), granularity=granularity,
        date_from=date_from, date_to=date_to, course_id=course_id,
    )


@router.get("/activity", response_model=ActivityOut)
def get_activity(user: User = Depends(staff_scope), db: Session = Depends(get_db)):
    return reports_service.activity(db, reports_service.scope_for(user))


@router.get("/attendance", response_model=ReportOut)
def get_report(
    report_type: str = Query(..., alias="type"),
    date_from: date | None = None,
    date_to: date | None = None,
    course_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    paging: PageParams = Depends(page_params),
    user: User = Depends(staff_scope),
    db: Session = Depends(get_db),
):
    _range(date_from, date_to)
    _course(db, user, course_id)
    if status_filter is not None and status_filter not in CORRECTION_STATUSES:
        raise AppError(422, "invalid_status", "status must be pending, approved, rejected or withdrawn")
    return reports_service.report(
        db, reports_service.scope_for(user), report_type,
        date_from=date_from, date_to=date_to, course_id=course_id, status=status_filter,
        page=paging.page, page_size=paging.page_size,
    )


@router.get("/export")
def export_report(
    report_type: str = Query(..., alias="type"),
    fmt: str = Query("csv", pattern="^(csv|pdf)$"),
    date_from: date | None = None,
    date_to: date | None = None,
    course_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    user: User = Depends(staff_scope),
    db: Session = Depends(get_db),
):
    _range(date_from, date_to)
    _course(db, user, course_id)
    if status_filter is not None and status_filter not in CORRECTION_STATUSES:
        raise AppError(422, "invalid_status", "status must be pending, approved, rejected or withdrawn")
    payload, media_type, filename = reports_service.export(
        db, reports_service.scope_for(user), report_type, fmt,
        date_from=date_from, date_to=date_to, course_id=course_id, status=status_filter,
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Length": str(len(payload)),
    }
    return Response(content=payload, media_type=media_type, headers=headers)
