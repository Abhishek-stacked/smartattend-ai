"""Student-raised attendance corrections reviewed by staff.

A request never changes a record by itself. Approval applies the change and the audit entry in the
same transaction; only one pending request may exist per student and session.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import can_view_session
from app.core.errors import AppError, conflict, not_found
from app.models import AttendanceRecord, AttendanceSession, CorrectionRequest, SessionParticipant, Student, User
from app.models.base import utcnow
from app.models.user import ROLE_ADMIN, ROLE_STUDENT
from app.services import attendance_service, audit_service
from app.services.review_service import RECORD_FIELDS

MARKABLE_SESSION_STATUSES = ("active", "closed", "finalized")
REVIEWABLE_SESSION_STATUSES = ("active", "closed", "finalized")


def get_request(db: Session, request_id: int, user: User) -> CorrectionRequest:
    row = db.get(CorrectionRequest, request_id)
    if row is None:
        raise not_found("Correction request")
    if user.role_name == ROLE_STUDENT:
        if user.student is None or row.student_id != user.student.id:
            raise not_found("Correction request")
    elif user.role_name != ROLE_ADMIN:
        if not can_view_session(user, row.session):
            raise not_found("Correction request")
    return row


def _record(db: Session, session_id: int, student_id: int) -> AttendanceRecord | None:
    return db.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == student_id
        )
    )


def create(db: Session, student: Student, *, session_id: int, requested_status: str, reason: str,
           actor: User, request=None) -> CorrectionRequest:
    session = db.get(AttendanceSession, session_id)
    if session is None:
        raise not_found("Session")
    participant = db.scalar(
        select(SessionParticipant.id).where(
            SessionParticipant.session_id == session.id, SessionParticipant.student_id == student.id
        )
    )
    if participant is None:
        raise not_found("Session")
    if session.status == "cancelled":
        raise AppError(400, "session_cancelled", "A correction cannot be raised for a cancelled session")
    if session.status not in MARKABLE_SESSION_STATUSES:
        raise AppError(400, "session_not_started", "Corrections can be raised once the session has started",
                       {"current_status": session.status})

    record = _record(db, session.id, student.id)
    if record is not None and record.status == requested_status:
        raise AppError(422, "no_change", f"The record is already marked {requested_status}")
    pending = db.scalar(
        select(CorrectionRequest.id).where(
            CorrectionRequest.student_id == student.id,
            CorrectionRequest.session_id == session.id,
            CorrectionRequest.status == "pending",
        )
    )
    if pending is not None:
        raise conflict("request_pending", "A correction request for this session is already awaiting review")

    row = CorrectionRequest(
        student_id=student.id,
        session_id=session.id,
        attendance_record_id=record.id if record else None,
        request_type="correction" if record else "manual_attendance",
        requested_status=requested_status,
        reason=reason,
        status="pending",
    )
    db.add(row)
    db.flush()
    audit_service.record(
        db, actor=actor, action="correction.create", entity_type="correction_request", entity_id=row.id,
        after={"session_id": session.id, "student_id": student.id, "request_type": row.request_type,
               "requested_status": requested_status, "current_status": record.status if record else None},
        reason=reason, request=request,
    )
    db.commit()
    return row


def search(db: Session, *, student_id: int | None, faculty_id: int | None, status: str | None,
           session_id: int | None):
    stmt = (
        select(CorrectionRequest)
        .join(AttendanceSession, AttendanceSession.id == CorrectionRequest.session_id)
        .order_by(CorrectionRequest.created_at.desc(), CorrectionRequest.id.desc())
    )
    if student_id is not None:
        stmt = stmt.where(CorrectionRequest.student_id == student_id)
    if faculty_id is not None:
        stmt = stmt.where(AttendanceSession.faculty_id == faculty_id)
    if status:
        stmt = stmt.where(CorrectionRequest.status == status)
    if session_id is not None:
        stmt = stmt.where(CorrectionRequest.session_id == session_id)
    return stmt


def out(db: Session, row: CorrectionRequest) -> dict:
    session = row.session
    record = _record(db, row.session_id, row.student_id)
    return {
        "id": row.id,
        "student_id": row.student_id,
        "student_name": row.student.full_name,
        "registration_number": row.student.registration_number,
        "session_id": session.id,
        "course_code": session.course.code,
        "course_name": session.course.name,
        "session_title": session.title,
        "session_date": session.session_date,
        "session_status": session.status,
        "attendance_record_id": record.id if record else None,
        "current_status": record.status if record else None,
        "request_type": row.request_type,
        "requested_status": row.requested_status,
        "reason": row.reason,
        "status": row.status,
        "created_at": row.created_at,
        "reviewed_at": row.reviewed_at,
        "reviewer_note": row.reviewer_note,
    }


def withdraw(db: Session, row: CorrectionRequest, actor: User, reason: str | None, request=None) -> CorrectionRequest:
    if row.status != "pending":
        raise conflict("not_pending", "Only a pending request can be withdrawn",
                       {"status": row.status})
    row.status = "withdrawn"
    row.reviewer_note = reason
    row.reviewed_at = utcnow()
    audit_service.record(
        db, actor=actor, action="correction.withdraw", entity_type="correction_request", entity_id=row.id,
        before={"status": "pending"}, after={"status": "withdrawn"}, reason=reason, request=request,
    )
    db.commit()
    return row


def _lock_pending(db: Session, request_id: int) -> CorrectionRequest:
    row = db.scalar(
        select(CorrectionRequest).where(CorrectionRequest.id == request_id)
        .with_for_update(of=CorrectionRequest)
    )
    if row is None:
        raise not_found("Correction request")
    if row.status != "pending":
        raise conflict("not_pending", "This request has already been reviewed", {"status": row.status})
    return row


def _apply(db: Session, row: CorrectionRequest, actor: User, note: str, request=None) -> AttendanceRecord:
    session = row.session
    if session.status not in REVIEWABLE_SESSION_STATUSES:
        raise AppError(400, "session_not_markable",
                       "This session cannot accept attendance changes",
                       {"current_status": session.status})
    attendance_service.assert_eligible(db, session, row.student_id)

    record = _record(db, session.id, row.student_id)
    if record is None:
        record = attendance_service.insert_record(
            db, session_id=session.id, student_id=row.student_id, status=row.requested_status,
            source="manual", marked_by_user_id=actor.id,
        )
        if record is None:
            raise conflict("duplicate_attendance", "This student already has a record for this session")
        audit_service.record(
            db, actor=actor, action="attendance.manual", entity_type="attendance_record",
            entity_id=record.id,
            after={"session_id": session.id, "student_id": row.student_id,
                   "status": row.requested_status, "source": "manual", "correction_request_id": row.id},
            reason=note, request=request,
        )
        return record

    if record.status != row.requested_status:
        before = audit_service.snapshot(record, RECORD_FIELDS)
        record.status = row.requested_status
        record.reviewer_id = actor.id
        record.corrected_at = utcnow()
        record.correction_reason = note
        audit_service.record(
            db, actor=actor, action="attendance.update", entity_type="attendance_record",
            entity_id=record.id, before=before, after=audit_service.snapshot(record, RECORD_FIELDS),
            reason=note, request=request,
        )
    return record


def approve(db: Session, row: CorrectionRequest, actor: User, note: str, request=None) -> CorrectionRequest:
    row = _lock_pending(db, row.id)
    if actor.role_name != ROLE_ADMIN and not can_view_session(actor, row.session):
        raise not_found("Correction request")
    record = _apply(db, row, actor, note, request)
    row.status = "approved"
    row.reviewer_id = actor.id
    row.reviewed_at = utcnow()
    row.reviewer_note = note
    audit_service.record(
        db, actor=actor, action="correction.approve", entity_type="correction_request", entity_id=row.id,
        before={"status": "pending"},
        after={"status": "approved", "record_id": record.id, "record_status": record.status},
        reason=note, request=request,
    )
    db.commit()
    return row


def reject(db: Session, row: CorrectionRequest, actor: User, note: str, request=None) -> CorrectionRequest:
    row = _lock_pending(db, row.id)
    if actor.role_name != ROLE_ADMIN and not can_view_session(actor, row.session):
        raise not_found("Correction request")
    row.status = "rejected"
    row.reviewer_id = actor.id
    row.reviewed_at = utcnow()
    row.reviewer_note = note
    audit_service.record(
        db, actor=actor, action="correction.reject", entity_type="correction_request", entity_id=row.id,
        before={"status": "pending"}, after={"status": "rejected"}, reason=note, request=request,
    )
    db.commit()
    return row
