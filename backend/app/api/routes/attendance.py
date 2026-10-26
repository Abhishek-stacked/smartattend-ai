from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import can_view_session, faculty_id_or_none, staff_scope
from app.api.deps import PageParams, current_user, page_params
from app.core.database import get_db
from app.core.errors import forbidden, not_found
from app.models import AttendanceRecord, AuditLog, RecognitionEvent, User
from app.models.attendance import ATTENDANCE_STATUSES
from app.models.user import ROLE_ADMIN, ROLE_FACULTY, ROLE_STUDENT
from app.schemas.common import Page, paginate
from app.schemas.session import AttendanceDetail, AttendanceOut, AttendanceUpdate
from app.services import attendance_service, settings_service

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _can_view(record: AttendanceRecord, user: User) -> bool:
    if user.role_name == ROLE_ADMIN:
        return True
    if user.role_name == ROLE_FACULTY:
        return can_view_session(user, record.session)
    return user.role_name == ROLE_STUDENT and user.student is not None and user.student.id == record.student_id


def _get(db: Session, record_id: int, user: User) -> AttendanceRecord:
    record = db.get(AttendanceRecord, record_id)
    if record is None or not _can_view(record, user):
        raise not_found("Attendance record")
    return record


def _event(db: Session, event_id: int | None) -> dict | None:
    if event_id is None:
        return None
    event = db.get(RecognitionEvent, event_id)
    if event is None:
        return None
    return {
        "id": event.id,
        "occurred_at": event.occurred_at,
        "outcome": event.outcome,
        "similarity": event.similarity,
        "second_similarity": event.second_similarity,
        "threshold_used": event.threshold_used,
        "liveness_status": event.liveness_status,
        "liveness_score": event.liveness_score,
        "model_name": event.model_name,
        "model_version": event.model_version,
        "processing_ms": event.processing_ms,
        "review_status": event.review_status,
    }


def _history(db: Session, record_id: int) -> list[dict]:
    rows = db.execute(
        select(AuditLog, User.full_name)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(AuditLog.entity_type == "attendance_record", AuditLog.entity_id == str(record_id))
        .order_by(AuditLog.occurred_at, AuditLog.id)
    ).all()
    return [
        {
            "id": log.id,
            "occurred_at": log.occurred_at,
            "action": log.action,
            "actor_name": name,
            "actor_role": log.actor_role,
            "before": log.before,
            "after": log.after,
            "reason": log.reason,
        }
        for log, name in rows
    ]


@router.get("", response_model=Page[AttendanceOut])
def list_attendance(
    session_id: int | None = None,
    course_id: int | None = None,
    student_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
    paging: PageParams = Depends(page_params),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if status_filter and status_filter not in ATTENDANCE_STATUSES:
        status_filter = "__invalid__"
    if user.role_name == ROLE_STUDENT:
        if user.student is None:
            raise forbidden()
        student_id = user.student.id
        scope = None
    elif user.role_name in (ROLE_ADMIN, ROLE_FACULTY):
        if user.role_name == ROLE_FACULTY and user.faculty is None:
            raise forbidden("Your account is not linked to a faculty profile")
        scope = None if user.role_name == ROLE_ADMIN else faculty_id_or_none(user)
    else:
        raise forbidden()

    stmt = attendance_service.search_records(db, session_id=session_id, course_id=course_id, student_id=student_id,
                                             status=status_filter, date_from=date_from, date_to=date_to,
                                             faculty_id=scope)
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    return Page(items=[AttendanceOut(**attendance_service.record_out(r)) for r in items], total=total,
                page=paging.page, page_size=paging.page_size)


@router.get("/{record_id}", response_model=AttendanceDetail)
def get_attendance(record_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    record = _get(db, record_id, user)
    payload = attendance_service.record_out(record)
    return AttendanceDetail(**payload, event=_event(db, record.recognition_event_id),
                            history=_history(db, record.id))


@router.patch("/{record_id}", response_model=AttendanceDetail)
def update_attendance(record_id: int, body: AttendanceUpdate, request: Request,
                      actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    record = _get(db, record_id, actor)
    if actor.role_name == ROLE_FACULTY and not settings_service.get(db, "faculty_can_correct"):
        raise forbidden("Faculty corrections are disabled. Ask an administrator to make this change")
    record = attendance_service.update_record(db, record, body.status, body.reason, actor, request)
    payload = attendance_service.record_out(record)
    return AttendanceDetail(**payload, event=_event(db, record.recognition_event_id),
                            history=_history(db, record.id))
