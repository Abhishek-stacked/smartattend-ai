from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, conflict, not_found
from app.models import (
    AttendanceRecord,
    AttendanceSession,
    Course,
    CourseEnrollment,
    SessionParticipant,
    Student,
    User,
)
from app.models.base import utcnow
from app.schemas.session import SessionIn, SessionUpdate
from app.services import attendance_service, audit_service, settings_service

SESSION_FIELDS = ("title", "session_date", "scheduled_start", "scheduled_end", "late_after", "attendance_closes_at",
                  "status", "liveness_policy")


def _utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


def session_date_for(start: datetime) -> date:
    return start.astimezone(get_settings().tz).date()


def _window_minutes(session: AttendanceSession) -> tuple[int, int]:
    late_min = int((session.late_after - session.scheduled_start).total_seconds() // 60)
    window_min = int((session.attendance_closes_at - session.scheduled_start).total_seconds() // 60)
    return late_min, window_min


def _validate_window(start: datetime, end: datetime, late_min: int, window_min: int) -> tuple[datetime, datetime]:
    if end <= start:
        raise AppError(422, "invalid_time_range", "The session must end after it starts")
    if late_min > window_min:
        raise AppError(422, "invalid_window", "The late cutoff must fall inside the attendance window")
    return start + timedelta(minutes=late_min), start + timedelta(minutes=window_min)


def _assert_no_overlap(db: Session, course_id: int, start: datetime, end: datetime, exclude_id: int | None = None) -> None:
    stmt = select(AttendanceSession.id).where(
        AttendanceSession.course_id == course_id,
        AttendanceSession.status.in_(("scheduled", "active", "paused")),
        AttendanceSession.scheduled_start < end,
        AttendanceSession.scheduled_end > start,
    )
    if exclude_id is not None:
        stmt = stmt.where(AttendanceSession.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise conflict("session_overlap", "Another open session for this course overlaps that time")


def get_session(db: Session, session_id: int) -> AttendanceSession:
    session = db.get(AttendanceSession, session_id)
    if session is None:
        raise not_found("Session")
    return session


def out(db: Session, session: AttendanceSession, counts: dict | None = None) -> dict:
    counts = counts or attendance_service.compute_counts(db, session.id)
    return {
        "id": session.id,
        "course_id": session.course_id,
        "course_code": session.course.code,
        "course_name": session.course.name,
        "faculty_id": session.faculty_id,
        "faculty_name": session.faculty.full_name,
        "title": session.title,
        "session_date": session.session_date,
        "scheduled_start": session.scheduled_start,
        "scheduled_end": session.scheduled_end,
        "late_after": session.late_after,
        "attendance_closes_at": session.attendance_closes_at,
        "status": session.status,
        "liveness_policy": session.liveness_policy,
        "self_marking_enabled": session.self_marking_enabled,
        "started_at": session.started_at,
        "closed_at": session.closed_at,
        "finalized_at": session.finalized_at,
        "created_at": session.created_at,
        "counts": counts,
    }


def create_session(db: Session, data: SessionIn, actor: User, request=None,
                   faculty_scope: int | None = None) -> AttendanceSession:
    course = db.get(Course, data.course_id)
    if course is None or (faculty_scope is not None and course.faculty_id != faculty_scope):
        raise not_found("Course")
    if course.status != "active":
        raise AppError(400, "course_archived", "Sessions cannot be created for an archived course")
    if course.faculty_id is None:
        raise AppError(400, "course_has_no_faculty", "Assign a faculty member to this course before scheduling sessions")

    settings = settings_service.get_all(db)
    start, end = _utc(data.scheduled_start), _utc(data.scheduled_end)
    late_min = settings["default_late_after_min"] if data.late_after_min is None else data.late_after_min
    window_min = settings["default_window_min"] if data.window_min is None else data.window_min
    late_after, closes = _validate_window(start, end, late_min, window_min)
    _assert_no_overlap(db, course.id, start, end)

    session = AttendanceSession(
        course_id=course.id,
        faculty_id=course.faculty_id,
        title=data.title.strip(),
        session_date=session_date_for(start),
        scheduled_start=start,
        scheduled_end=end,
        late_after=late_after,
        attendance_closes_at=closes,
        status="scheduled",
        liveness_policy=settings["liveness_policy"],
        created_by_user_id=actor.id,
    )
    db.add(session)
    db.flush()

    student_ids = db.scalars(
        select(CourseEnrollment.student_id).where(
            CourseEnrollment.course_id == course.id, CourseEnrollment.status == "active"
        )
    ).all()
    if student_ids:
        db.execute(
            pg_insert(SessionParticipant)
            .values([{"session_id": session.id, "student_id": sid} for sid in student_ids])
            .on_conflict_do_nothing(index_elements=["session_id", "student_id"])
        )
    audit_service.record(db, actor=actor, action="session.create", entity_type="attendance_session",
                         entity_id=session.id,
                         after={"course_id": course.id, "title": session.title,
                                "scheduled_start": start.isoformat(), "participants": len(student_ids)},
                         request=request)
    db.commit()
    return session


def update_session(db: Session, session: AttendanceSession, data: SessionUpdate, actor: User,
                   request=None) -> AttendanceSession:
    if session.status != "scheduled":
        raise AppError(400, "session_not_editable", "Only scheduled sessions can be edited")
    before = audit_service.snapshot(session, SESSION_FIELDS)
    late_min, window_min = _window_minutes(session)
    start = _utc(data.scheduled_start) if data.scheduled_start else session.scheduled_start
    end = _utc(data.scheduled_end) if data.scheduled_end else session.scheduled_end
    late_min = late_min if data.late_after_min is None else data.late_after_min
    window_min = window_min if data.window_min is None else data.window_min
    late_after, closes = _validate_window(start, end, late_min, window_min)
    _assert_no_overlap(db, session.course_id, start, end, exclude_id=session.id)

    session.title = data.title.strip() if data.title else session.title
    session.scheduled_start = start
    session.scheduled_end = end
    session.late_after = late_after
    session.attendance_closes_at = closes
    session.session_date = session_date_for(start)
    audit_service.record(db, actor=actor, action="session.update", entity_type="attendance_session",
                         entity_id=session.id, before=before, after=audit_service.snapshot(session, SESSION_FIELDS),
                         request=request)
    db.commit()
    return session


def _lock(db: Session, session_id: int) -> AttendanceSession:
    session = db.scalar(
        select(AttendanceSession).where(AttendanceSession.id == session_id).with_for_update(of=AttendanceSession)
    )
    if session is None:
        raise not_found("Session")
    return session


def _transition(db: Session, session_id: int, *, allowed: tuple[str, ...], new_status: str, action: str,
                actor: User, request=None, reason: str | None = None, **fields) -> AttendanceSession:
    session = _lock(db, session_id)
    if session.status not in allowed:
        raise AppError(400, "invalid_transition",
                       f"Cannot {action} a session that is {session.status}",
                       {"current_status": session.status, "allowed": list(allowed)})
    before = {"status": session.status}
    session.status = new_status
    for key, value in fields.items():
        setattr(session, key, value)
    audit_service.record(db, actor=actor, action=f"session.{action}", entity_type="attendance_session",
                         entity_id=session.id, before=before, after={"status": new_status}, reason=reason,
                         request=request)
    db.commit()
    return session


def start(db: Session, session_id: int, actor: User, request=None) -> AttendanceSession:
    return _transition(db, session_id, allowed=("scheduled",), new_status="active", action="start",
                       actor=actor, request=request, started_at=utcnow())


def pause(db: Session, session_id: int, actor: User, request=None) -> AttendanceSession:
    return _transition(db, session_id, allowed=("active",), new_status="paused", action="pause",
                       actor=actor, request=request)


def resume(db: Session, session_id: int, actor: User, request=None) -> AttendanceSession:
    return _transition(db, session_id, allowed=("paused",), new_status="active", action="resume",
                       actor=actor, request=request)


def close(db: Session, session_id: int, actor: User, request=None) -> AttendanceSession:
    return _transition(db, session_id, allowed=("active", "paused"), new_status="closed", action="close",
                       actor=actor, request=request, closed_at=utcnow())


def cancel(db: Session, session_id: int, actor: User, reason: str | None, request=None) -> AttendanceSession:
    return _transition(db, session_id, allowed=("scheduled",), new_status="cancelled", action="cancel",
                       actor=actor, request=request, reason=reason)


def reopen(db: Session, session_id: int, actor: User, reason: str, request=None) -> AttendanceSession:
    return _transition(db, session_id, allowed=("closed",), new_status="active", action="reopen",
                       actor=actor, request=request, reason=reason, closed_at=None)


def finalize(db: Session, session_id: int, actor: User, request=None) -> AttendanceSession:
    session = _lock(db, session_id)
    if session.status != "closed":
        raise AppError(400, "invalid_transition", "Only a closed session can be finalized",
                       {"current_status": session.status})
    participant_ids = db.scalars(
        select(SessionParticipant.student_id).where(SessionParticipant.session_id == session.id)
    ).all()
    recorded = set(
        db.scalars(select(AttendanceRecord.student_id).where(AttendanceRecord.session_id == session.id)).all()
    )
    missing = [sid for sid in participant_ids if sid not in recorded]
    now = utcnow()
    if missing:
        db.execute(
            pg_insert(AttendanceRecord)
            .values([{"session_id": session.id, "student_id": sid, "status": "absent", "source": "system",
                      "marked_at": now} for sid in missing])
            .on_conflict_do_nothing(index_elements=["session_id", "student_id"])
        )
    session.status = "finalized"
    session.finalized_at = now
    audit_service.record(db, actor=actor, action="session.finalize", entity_type="attendance_session",
                         entity_id=session.id, after={"absences_created": len(missing),
                                                      "participants": len(participant_ids)}, request=request)
    db.commit()
    return session


def self_marking_state(db: Session, session: AttendanceSession, student_id: int,
                       participant_row: SessionParticipant | None = None,
                       now: datetime | None = None) -> tuple[bool, str | None]:
    """Returns whether a student may self-mark right now, and why not when they cannot."""
    now = now or utcnow()
    if not session.self_marking_enabled:
        return False, "Self-marking is not enabled for this session"
    if session.status in ("closed", "finalized", "cancelled"):
        return False, "This session is closed for attendance"
    if session.status == "paused":
        return False, "The session is paused"
    if now < session.scheduled_start:
        return False, "Self-marking opens when the session starts"
    if now > session.attendance_closes_at:
        return False, "The self-marking window for this session has closed"
    row = participant_row if participant_row is not None else attendance_service.participant(db, session.id, student_id)
    if row is None:
        return False, "You are not on the roster for this session"
    if row.self_marking_locked_at is not None:
        return False, "Self-marking is locked for you on this session"
    student = db.get(Student, student_id)
    if student is None or student.status != "active":
        return False, "Your student record is not active"
    return True, None


def set_self_marking_enabled(db: Session, session: AttendanceSession, enabled: bool, actor: User,
                             request=None) -> AttendanceSession:
    before = {"self_marking_enabled": session.self_marking_enabled}
    session.self_marking_enabled = enabled
    audit_service.record(db, actor=actor, action="session.self_marking.enable" if enabled
                         else "session.self_marking.disable", entity_type="attendance_session",
                         entity_id=session.id, before=before, after={"self_marking_enabled": enabled},
                         request=request)
    db.commit()
    return session


def set_self_marking_lock(db: Session, session: AttendanceSession, student_id: int, locked: bool,
                          reason: str | None, actor: User, request=None) -> SessionParticipant:
    row = attendance_service.participant(db, session.id, student_id)
    if row is None:
        raise not_found("Student")
    before = {"locked": row.self_marking_locked_at is not None, "reason": row.self_marking_lock_reason}
    if locked:
        row.self_marking_locked_at = utcnow()
        row.self_marking_locked_by_user_id = actor.id
        row.self_marking_lock_reason = reason or None
    else:
        row.self_marking_locked_at = None
        row.self_marking_locked_by_user_id = None
        row.self_marking_lock_reason = None
    audit_service.record(db, actor=actor, action="session.self_marking.lock" if locked
                         else "session.self_marking.unlock", entity_type="session_participant",
                         entity_id=row.id, before=before,
                         after={"locked": locked, "student_id": student_id, "reason": row.self_marking_lock_reason},
                         reason=reason, request=request)
    db.commit()
    return row


def roster(db: Session, session: AttendanceSession) -> list[dict]:
    rows = db.execute(
        select(SessionParticipant, AttendanceRecord)
        .join(Student, Student.id == SessionParticipant.student_id)
        .outerjoin(
            AttendanceRecord,
            and_(AttendanceRecord.session_id == SessionParticipant.session_id,
                 AttendanceRecord.student_id == SessionParticipant.student_id),
        )
        .where(SessionParticipant.session_id == session.id)
        .order_by(Student.full_name, Student.registration_number)
    ).all()
    from app.models import BiometricTemplate

    student_ids = [p.student_id for p, _ in rows]
    enrolled = set(
        db.scalars(select(BiometricTemplate.student_id).where(BiometricTemplate.student_id.in_(student_ids))).all()
    ) if student_ids else set()
    return [
        {
            "student_id": p.student.id,
            "registration_number": p.student.registration_number,
            "full_name": p.student.full_name,
            "status": record.status if record else None,
            "source": record.source if record else None,
            "marked_at": record.marked_at if record else None,
            "biometric_enrolled": p.student_id in enrolled,
            "self_marking_locked": p.self_marking_locked_at is not None,
            "self_marking_lock_reason": p.self_marking_lock_reason,
        }
        for p, record in rows
    ]


def sessions_for_student(db: Session, student_id: int) -> list[dict]:
    rows = db.execute(
        select(AttendanceSession, AttendanceRecord.status, SessionParticipant)
        .join(SessionParticipant, SessionParticipant.session_id == AttendanceSession.id)
        .outerjoin(
            AttendanceRecord,
            and_(AttendanceRecord.session_id == AttendanceSession.id,
                 AttendanceRecord.student_id == SessionParticipant.student_id),
        )
        .where(SessionParticipant.student_id == student_id)
        .order_by(AttendanceSession.session_date.desc(), AttendanceSession.scheduled_start.desc())
    ).all()
    from app.models import CorrectionRequest

    pending = set(db.scalars(
        select(CorrectionRequest.session_id).where(
            CorrectionRequest.student_id == student_id, CorrectionRequest.status == "pending"
        )
    ).all())
    out_rows = []
    for session, record_status, participant_row in rows:
        open_now, message = self_marking_state(db, session, student_id, participant_row=participant_row)
        out_rows.append({
            "id": session.id,
            "course_id": session.course_id,
            "course_code": session.course.code,
            "course_name": session.course.name,
            "title": session.title,
            "session_date": session.session_date,
            "scheduled_start": session.scheduled_start,
            "scheduled_end": session.scheduled_end,
            "status": session.status,
            "record_status": record_status,
            "has_pending_request": session.id in pending,
            "self_marking_open": open_now and record_status is None,
            "self_marking_message": message,
            "self_marking_closes_at": session.attendance_closes_at,
        })
    return out_rows


def search_sessions(db: Session, *, course_id: int | None, status: str | None, date_from, date_to,
                    faculty_id: int | None):
    stmt = select(AttendanceSession).order_by(
        AttendanceSession.session_date.desc(), AttendanceSession.scheduled_start.desc()
    )
    if course_id is not None:
        stmt = stmt.where(AttendanceSession.course_id == course_id)
    if status:
        stmt = stmt.where(AttendanceSession.status == status)
    if date_from:
        stmt = stmt.where(AttendanceSession.session_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceSession.session_date <= date_to)
    if faculty_id is not None:
        stmt = stmt.where(AttendanceSession.faculty_id == faculty_id)
    return stmt
