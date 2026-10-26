from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.errors import AppError, conflict, not_found
from app.models import AttendanceRecord, AttendanceSession, SessionParticipant, Student, User
from app.models.attendance import ATTENDANCE_STATUSES
from app.models.base import utcnow
from app.services import audit_service

RECORD_FIELDS = ("status", "source", "marked_at")


def _empty_counts() -> dict[str, int]:
    return {"participants": 0, "present": 0, "late": 0, "absent": 0, "pending_review": 0, "excused": 0,
            "unmarked": 0}


def compute_counts_many(db: Session, session_ids: list[int]) -> dict[int, dict[str, int]]:
    counts = {sid: _empty_counts() for sid in session_ids}
    if not session_ids:
        return counts
    participant_rows = db.execute(
        select(SessionParticipant.session_id, func.count(SessionParticipant.id))
        .where(SessionParticipant.session_id.in_(session_ids))
        .group_by(SessionParticipant.session_id)
    ).all()
    for session_id, count in participant_rows:
        counts[session_id]["participants"] = count
    record_rows = db.execute(
        select(AttendanceRecord.session_id, AttendanceRecord.status, func.count(AttendanceRecord.id))
        .where(AttendanceRecord.session_id.in_(session_ids))
        .group_by(AttendanceRecord.session_id, AttendanceRecord.status)
    ).all()
    for session_id, status, count in record_rows:
        if status in counts[session_id]:
            counts[session_id][status] = count
    for c in counts.values():
        marked = c["present"] + c["late"] + c["absent"] + c["pending_review"] + c["excused"]
        c["unmarked"] = max(0, c["participants"] - marked)
    return counts


def compute_counts(db: Session, session_id: int) -> dict[str, int]:
    return compute_counts_many(db, [session_id])[session_id]


def status_for_arrival(session: AttendanceSession, at: datetime) -> str:
    return "late" if at > session.late_after else "present"


def insert_record(
    db: Session,
    *,
    session_id: int,
    student_id: int,
    status: str,
    source: str,
    marked_at: datetime | None = None,
    recognition_event_id: int | None = None,
    marked_by_user_id: int | None = None,
) -> AttendanceRecord | None:
    """Inserts at most one record per (session, student). Returns None when a record already exists."""
    stmt = (
        pg_insert(AttendanceRecord)
        .values(
            session_id=session_id,
            student_id=student_id,
            status=status,
            source=source,
            marked_at=marked_at or utcnow(),
            recognition_event_id=recognition_event_id,
            marked_by_user_id=marked_by_user_id,
        )
        .on_conflict_do_nothing(index_elements=["session_id", "student_id"])
        .returning(AttendanceRecord.id)
    )
    new_id = db.scalar(stmt)
    return None if new_id is None else db.get(AttendanceRecord, new_id)


def participant(db: Session, session_id: int, student_id: int) -> SessionParticipant | None:
    return db.scalar(
        select(SessionParticipant).where(
            SessionParticipant.session_id == session_id, SessionParticipant.student_id == student_id
        )
    )


def assert_eligible(db: Session, session: AttendanceSession, student_id: int) -> Student:
    row = participant(db, session.id, student_id)
    if row is None:
        raise AppError(400, "not_eligible", "This student is not on the session roster")
    student = db.get(Student, student_id)
    if student is None or student.status != "active":
        raise AppError(400, "not_eligible", "This student is not active")
    return student


def mark_manual(db: Session, session_id: int, student_id: int, status: str, reason: str, actor: User,
                request=None) -> AttendanceRecord:
    if status not in ("present", "late", "excused"):
        raise AppError(422, "invalid_status", "Manual status must be present, late or excused")
    session = db.scalar(
        select(AttendanceSession).where(AttendanceSession.id == session_id).with_for_update(of=AttendanceSession)
    )
    if session is None:
        raise not_found("Session")
    if session.status not in ("active", "closed"):
        raise AppError(400, "session_not_markable", "Attendance can only be recorded while the session is active or closed")
    assert_eligible(db, session, student_id)
    record = insert_record(db, session_id=session.id, student_id=student_id, status=status, source="manual",
                           marked_by_user_id=actor.id)
    if record is None:
        raise conflict("duplicate_attendance", "This student already has a record for this session")
    audit_service.record(db, actor=actor, action="attendance.manual", entity_type="attendance_record",
                         entity_id=record.id,
                         after={"session_id": session.id, "student_id": student_id, "status": status,
                                "source": "manual"},
                         reason=reason, request=request)
    db.commit()
    return record


def mark_self(db: Session, session_id: int, student_id: int, actor: User,
              request=None) -> tuple[AttendanceRecord, bool]:
    """Records a student's own attendance for an open session.

    Never overwrites an existing record: face verification and staff decisions take precedence.
    Returns the record and whether it was created by this call.
    """
    from app.services import session_service

    session = db.scalar(
        select(AttendanceSession).where(AttendanceSession.id == session_id).with_for_update(of=AttendanceSession)
    )
    if session is None:
        raise not_found("Session")
    open_now, message = session_service.self_marking_state(db, session, student_id)
    if not open_now:
        raise AppError(403, "self_marking_closed", message or "Self-marking is not available for this session")
    existing = db.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == student_id
        )
    )
    if existing is not None:
        return existing, False
    now = utcnow()
    status = status_for_arrival(session, now)
    record = insert_record(db, session_id=session.id, student_id=student_id, status=status,
                           source="self_reported", marked_at=now, marked_by_user_id=actor.id)
    created = record is not None
    if record is None:
        record = db.scalar(
            select(AttendanceRecord).where(
                AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == student_id
            )
        )
    if record is None:
        raise conflict("duplicate_attendance", "This student already has a record for this session")
    audit_service.record(db, actor=actor, action="attendance.self_mark", entity_type="attendance_record",
                         entity_id=record.id,
                         after={"session_id": session.id, "student_id": student_id, "status": record.status,
                                "source": "self_reported"},
                         request=request)
    db.commit()
    return record, created


def update_record(db: Session, record: AttendanceRecord, status: str, reason: str, actor: User,
                  request=None) -> AttendanceRecord:
    if status not in ATTENDANCE_STATUSES:
        raise AppError(422, "invalid_status", "Unknown attendance status")
    session = record.session
    if session.status == "cancelled":
        raise AppError(400, "session_cancelled", "Attendance cannot be changed on a cancelled session")
    before = audit_service.snapshot(record, RECORD_FIELDS)
    if record.status == status:
        return record
    record.status = status
    record.reviewer_id = actor.id
    record.corrected_at = utcnow()
    record.correction_reason = reason
    audit_service.record(db, actor=actor, action="attendance.update", entity_type="attendance_record",
                         entity_id=record.id, before=before,
                         after=audit_service.snapshot(record, RECORD_FIELDS), reason=reason, request=request)
    db.commit()
    return record


def record_out(record: AttendanceRecord) -> dict[str, Any]:
    session = record.session
    return {
        "id": record.id,
        "session_id": session.id,
        "course_id": session.course_id,
        "course_code": session.course.code,
        "course_name": session.course.name,
        "session_title": session.title,
        "session_date": session.session_date,
        "session_status": session.status,
        "student_id": record.student_id,
        "registration_number": record.student.registration_number,
        "student_name": record.student.full_name,
        "status": record.status,
        "source": record.source,
        "marked_at": record.marked_at,
        "correction_reason": record.correction_reason,
        "corrected_at": record.corrected_at,
        "reviewer_id": record.reviewer_id,
    }


def search_records(db: Session, *, session_id: int | None, course_id: int | None, student_id: int | None,
                   status: str | None, date_from, date_to, faculty_id: int | None):
    stmt = (
        select(AttendanceRecord)
        .join(AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id)
        .order_by(AttendanceSession.session_date.desc(), AttendanceSession.id.desc(), AttendanceRecord.id)
    )
    if session_id is not None:
        stmt = stmt.where(AttendanceRecord.session_id == session_id)
    if course_id is not None:
        stmt = stmt.where(AttendanceSession.course_id == course_id)
    if student_id is not None:
        stmt = stmt.where(AttendanceRecord.student_id == student_id)
    if status:
        stmt = stmt.where(AttendanceRecord.status == status)
    if date_from:
        stmt = stmt.where(AttendanceSession.session_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceSession.session_date <= date_to)
    if faculty_id is not None:
        stmt = stmt.where(AttendanceSession.faculty_id == faculty_id)
    return stmt
