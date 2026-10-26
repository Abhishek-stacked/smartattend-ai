"""Human review for uncertain recognition events.

Nothing here is automatic: a signed-in staff member decides, supplies a note, and the decision
and its attendance effect are audited in one transaction.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import can_view_session
from app.core.errors import AppError, conflict, not_found
from app.models import AttendanceRecord, AttendanceSession, RecognitionEvent, User
from app.models.base import utcnow
from app.models.user import ROLE_ADMIN
from app.services import attendance_service, audit_service

MARK_ACTIONS = {"mark_present": "present", "mark_late": "late"}
RECORD_FIELDS = ("status", "source", "marked_at")


def get_event(db: Session, event_id: int, user: User) -> RecognitionEvent:
    event = db.get(RecognitionEvent, event_id)
    if event is None:
        raise not_found("Recognition event")
    if user.role_name == ROLE_ADMIN:
        return event
    if event.session is None or not can_view_session(user, event.session):
        raise not_found("Recognition event")
    return event


def search_events(db: Session, *, faculty_id: int | None, review_status: str | None,
                  session_id: int | None, outcome: str | None, liveness_status: str | None):
    stmt = (
        select(RecognitionEvent)
        .join(AttendanceSession, AttendanceSession.id == RecognitionEvent.session_id)
        .order_by(RecognitionEvent.occurred_at.desc(), RecognitionEvent.id.desc())
    )
    if faculty_id is not None:
        stmt = stmt.where(AttendanceSession.faculty_id == faculty_id)
    if review_status:
        stmt = stmt.where(RecognitionEvent.review_status == review_status)
    if session_id is not None:
        stmt = stmt.where(RecognitionEvent.session_id == session_id)
    if outcome:
        stmt = stmt.where(RecognitionEvent.outcome == outcome)
    if liveness_status:
        stmt = stmt.where(RecognitionEvent.liveness_status == liveness_status)
    return stmt


def event_out(event: RecognitionEvent) -> dict:
    session = event.session
    student = event.matched_student
    return {
        "id": event.id,
        "occurred_at": event.occurred_at,
        "outcome": event.outcome,
        "review_status": event.review_status,
        "session_id": event.session_id,
        "session_title": session.title if session else None,
        "course_id": session.course_id if session else None,
        "course_code": session.course.code if session else None,
        "course_name": session.course.name if session else None,
        "student_id": student.id if student else None,
        "student_name": student.full_name if student else None,
        "registration_number": student.registration_number if student else None,
        "similarity": event.similarity,
        "second_similarity": event.second_similarity,
        "threshold_used": event.threshold_used,
        "liveness_status": event.liveness_status,
        "liveness_score": event.liveness_score,
        "liveness_model": event.liveness_model,
        "quality": event.quality,
        "error_code": event.error_code,
        "reviewed_at": event.reviewed_at,
        "review_note": event.review_note,
    }


def _lock_pending(db: Session, event_id: int) -> RecognitionEvent:
    event = db.scalar(
        select(RecognitionEvent).where(RecognitionEvent.id == event_id).with_for_update(of=RecognitionEvent)
    )
    if event is None:
        raise not_found("Recognition event")
    if event.review_status != "pending":
        raise conflict("already_reviewed", "This event has already been reviewed",
                       {"review_status": event.review_status})
    return event


def _apply_mark(db: Session, event: RecognitionEvent, status: str, note: str, actor: User,
                request=None) -> AttendanceRecord:
    session = event.session
    if session is None:
        raise AppError(409, "no_session", "The session for this event is no longer available")
    if event.matched_student_id is None:
        raise AppError(422, "no_candidate",
                       "This event has no candidate identity. Use manual attendance on the session roster.")
    if session.status not in ("active", "closed"):
        raise AppError(400, "session_not_markable",
                       "Attendance can only be added while the session is active or closed",
                       {"current_status": session.status})
    attendance_service.assert_eligible(db, session, event.matched_student_id)

    record = db.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == event.matched_student_id,
        )
    )
    if record is None:
        record = attendance_service.insert_record(
            db, session_id=session.id, student_id=event.matched_student_id, status=status,
            source="manual", recognition_event_id=event.id, marked_by_user_id=actor.id,
        )
        if record is None:
            raise conflict("duplicate_attendance", "This student already has a record for this session")
        audit_service.record(
            db, actor=actor, action="attendance.manual", entity_type="attendance_record",
            entity_id=record.id,
            after={"session_id": session.id, "student_id": event.matched_student_id, "status": status,
                   "source": "manual", "recognition_event_id": event.id},
            reason=note, request=request,
        )
        return record

    if record.status != status:
        before = audit_service.snapshot(record, RECORD_FIELDS)
        record.status = status
        record.reviewer_id = actor.id
        record.corrected_at = utcnow()
        record.correction_reason = note
        audit_service.record(
            db, actor=actor, action="attendance.update", entity_type="attendance_record",
            entity_id=record.id, before=before, after=audit_service.snapshot(record, RECORD_FIELDS),
            reason=note, request=request,
        )
    return record


def resolve(db: Session, event: RecognitionEvent, action: str, note: str, actor: User,
            request=None) -> tuple[RecognitionEvent, AttendanceRecord | None]:
    event = _lock_pending(db, event.id)
    if actor.role_name != ROLE_ADMIN:
        if event.session is None or not can_view_session(actor, event.session):
            raise not_found("Recognition event")
    record: AttendanceRecord | None = None
    if action == "dismiss":
        event.review_status = "dismissed"
    elif action in MARK_ACTIONS:
        record = _apply_mark(db, event, MARK_ACTIONS[action], note, actor, request)
        event.review_status = "resolved"
    else:
        raise AppError(422, "invalid_action", "Unknown review action")

    event.reviewed_by_user_id = actor.id
    event.reviewed_at = utcnow()
    event.review_note = note
    audit_service.record(
        db, actor=actor, action="recognition.resolve", entity_type="recognition_event",
        entity_id=event.id, before={"review_status": "pending"},
        after={"review_status": event.review_status, "action": action,
               "student_id": event.matched_student_id,
               "record_id": record.id if record else None,
               "record_status": record.status if record else None},
        reason=note, request=request,
    )
    db.commit()
    return event, record
