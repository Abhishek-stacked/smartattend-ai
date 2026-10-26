"""Attendance analytics and exports.

Every number is derived from the database on request. There is no cached or fabricated statistic:
when a filter matches no rows the report is empty and the API says so.
"""

import csv
import html
import io
from datetime import date, datetime, timezone
from typing import Any, Iterable

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import (
    AttendanceRecord,
    AttendanceSession,
    CorrectionRequest,
    Course,
    CourseEnrollment,
    RecognitionEvent,
    SessionParticipant,
    Student,
    User,
)
from app.models.attendance import ATTENDANCE_STATUSES
from app.models.base import utcnow
from app.models.user import ROLE_ADMIN, ROLE_FACULTY, ROLE_STUDENT
from app.services import attendance_service

GRANULARITIES = ("day", "week", "month")
GROUP_TYPES = ("daily", "weekly", "monthly", "course", "student", "faculty")
DETAIL_TYPES = ("late", "absence", "exceptions", "corrections")
REPORT_TYPES = GROUP_TYPES + DETAIL_TYPES
MAX_EXPORT_ROWS = 10_000

STATUS_LABELS = {
    "present": "Present",
    "late": "Late",
    "absent": "Absent",
    "excused": "Excused",
    "pending_review": "Pending review",
}

CORRECTION_STATUS_LABELS = {
    "pending": "Pending",
    "approved": "Approved",
    "rejected": "Rejected",
    "withdrawn": "Withdrawn",
}

REPORT_LABELS = {
    "daily": "Daily attendance",
    "weekly": "Weekly attendance",
    "monthly": "Monthly attendance",
    "course": "Attendance by course",
    "student": "Attendance by student",
    "faculty": "Attendance by faculty",
    "late": "Late arrivals",
    "absence": "Absences",
    "exceptions": "Pending review records",
    "corrections": "Correction requests",
}


class Scope:
    """Who the numbers may describe. Faculty sees own courses, students see themselves."""

    def __init__(self, role: str, faculty_id: int | None = None, student_id: int | None = None):
        self.role = role
        self.faculty_id = faculty_id
        self.student_id = student_id


def scope_for(user: User) -> Scope:
    if user.role_name == ROLE_ADMIN:
        return Scope(ROLE_ADMIN)
    if user.role_name == ROLE_FACULTY:
        if user.faculty is None:
            raise AppError(403, "forbidden", "Your account is not linked to a faculty profile")
        return Scope(ROLE_FACULTY, faculty_id=user.faculty.id)
    if user.role_name == ROLE_STUDENT:
        if user.student is None:
            raise AppError(403, "forbidden", "Your account is not linked to a student profile")
        return Scope(ROLE_STUDENT, student_id=user.student.id)
    raise AppError(403, "forbidden", "This report is not available for your role")


def as_of() -> datetime:
    return utcnow()


def rate(present: int, late: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(((present + late) / total) * 100, 1)


def _stamp(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _count(db: Session, stmt: Select) -> int:
    return db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0


def _record_select(
    scope: Scope,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    course_id: int | None = None,
) -> Select:
    stmt = (
        select(AttendanceRecord)
        .join(AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id)
        .join(Student, Student.id == AttendanceRecord.student_id)
        .where(AttendanceSession.status != "cancelled")
        .order_by(
            AttendanceSession.session_date.desc(),
            AttendanceSession.id.desc(),
            Student.full_name,
            Student.registration_number,
        )
    )
    if scope.faculty_id is not None:
        stmt = stmt.where(AttendanceSession.faculty_id == scope.faculty_id)
    if scope.student_id is not None:
        stmt = stmt.where(AttendanceRecord.student_id == scope.student_id)
    if course_id is not None:
        stmt = stmt.where(AttendanceSession.course_id == course_id)
    if date_from is not None:
        stmt = stmt.where(AttendanceSession.session_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(AttendanceSession.session_date <= date_to)
    return stmt


def _session_conditions(scope: Scope, *, course_id: int | None, date_from: date | None,
                        date_to: date | None) -> list:
    conditions = [AttendanceSession.status != "cancelled"]
    if scope.faculty_id is not None:
        conditions.append(AttendanceSession.faculty_id == scope.faculty_id)
    if course_id is not None:
        conditions.append(AttendanceSession.course_id == course_id)
    if date_from is not None:
        conditions.append(AttendanceSession.session_date >= date_from)
    if date_to is not None:
        conditions.append(AttendanceSession.session_date <= date_to)
    return conditions


def _status_counts(db: Session, conditions: list, *, student_id: int | None = None) -> dict[str, int]:
    counts = {status: 0 for status in ATTENDANCE_STATUSES}
    stmt = (
        select(AttendanceRecord.status, func.count(AttendanceRecord.id))
        .join(AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id)
        .where(*conditions)
        .group_by(AttendanceRecord.status)
    )
    if student_id is not None:
        stmt = stmt.where(AttendanceRecord.student_id == student_id)
    rows = db.execute(stmt).all()
    for status, count in rows:
        if status in counts:
            counts[status] = count
    return counts


def _pending_counts(db: Session, scope: Scope) -> tuple[int, int]:
    review_conditions = [RecognitionEvent.review_status == "pending"]
    correction_conditions = [CorrectionRequest.status == "pending"]
    if scope.faculty_id is not None:
        review_conditions.append(AttendanceSession.faculty_id == scope.faculty_id)
        correction_conditions.append(AttendanceSession.faculty_id == scope.faculty_id)
    if scope.student_id is not None:
        correction_conditions.append(CorrectionRequest.student_id == scope.student_id)
    pending_reviews = 0
    if scope.student_id is None:
        pending_reviews = db.scalar(
            select(func.count(RecognitionEvent.id))
            .join(AttendanceSession, AttendanceSession.id == RecognitionEvent.session_id)
            .where(*review_conditions)
        ) or 0
    pending_corrections = db.scalar(
        select(func.count(CorrectionRequest.id))
        .join(AttendanceSession, AttendanceSession.id == CorrectionRequest.session_id)
        .where(*correction_conditions)
    ) or 0
    return int(pending_reviews), int(pending_corrections)


def _courses_in_scope(db: Session, scope: Scope, course_id: int | None) -> int:
    conditions = [Course.status == "active"]
    if scope.faculty_id is not None:
        conditions.append(Course.faculty_id == scope.faculty_id)
    if scope.student_id is not None:
        enrollment_conditions = [
            CourseEnrollment.student_id == scope.student_id,
            CourseEnrollment.status == "active",
            Course.status == "active",
        ]
        if course_id is not None:
            enrollment_conditions.append(Course.id == course_id)
        return db.scalar(
            select(func.count(CourseEnrollment.id))
            .join(Course, Course.id == CourseEnrollment.course_id)
            .where(*enrollment_conditions)
        ) or 0
    if course_id is not None:
        conditions.append(Course.id == course_id)
    return db.scalar(select(func.count(Course.id)).where(*conditions)) or 0


def summary(db: Session, scope: Scope, *, date_from: date | None = None, date_to: date | None = None,
            course_id: int | None = None) -> dict[str, Any]:
    conditions = _session_conditions(scope, course_id=course_id, date_from=date_from, date_to=date_to)
    if scope.student_id is None:
        sessions = db.scalar(select(func.count(AttendanceSession.id)).where(*conditions)) or 0
        participants = db.scalar(
            select(func.count(SessionParticipant.id))
            .join(AttendanceSession, AttendanceSession.id == SessionParticipant.session_id)
            .where(*conditions)
        ) or 0
    else:
        conditions.append(
            AttendanceSession.id.in_(
                select(SessionParticipant.session_id).where(SessionParticipant.student_id == scope.student_id)
            )
        )
        sessions = db.scalar(select(func.count(AttendanceSession.id)).where(*conditions)) or 0
        participants = sessions

    counts = _status_counts(db, conditions, student_id=scope.student_id)
    records = sum(counts.values())
    marked = records

    if scope.student_id is None:
        active_conditions = [AttendanceSession.status == "active"]
        if scope.faculty_id is not None:
            active_conditions.append(AttendanceSession.faculty_id == scope.faculty_id)
        if course_id is not None:
            active_conditions.append(AttendanceSession.course_id == course_id)
    else:
        active_conditions = [
            AttendanceSession.status == "active",
            AttendanceSession.id.in_(
                select(SessionParticipant.session_id).where(SessionParticipant.student_id == scope.student_id)
            ),
        ]
        if course_id is not None:
            active_conditions.append(AttendanceSession.course_id == course_id)
    active_sessions = db.scalar(select(func.count(AttendanceSession.id)).where(*active_conditions)) or 0

    pending_reviews, pending_corrections = _pending_counts(db, scope)
    if scope.student_id is not None:
        pending_reviews = 0

    return {
        "scope": scope.role,
        "date_from": date_from,
        "date_to": date_to,
        "courses": int(_courses_in_scope(db, scope, course_id)),
        "sessions": int(sessions),
        "participants": int(participants),
        "records": int(records),
        "present": counts["present"],
        "late": counts["late"],
        "absent": counts["absent"],
        "pending_review": counts["pending_review"],
        "excused": counts["excused"],
        "unmarked": max(0, int(participants) - records),
        "attendance_rate": rate(counts["present"], counts["late"], marked),
        "pending_reviews": pending_reviews,
        "pending_corrections": pending_corrections,
        "active_sessions": int(active_sessions),
        "generated_at": as_of(),
    }


def _bucket(d: date, granularity: str) -> tuple[str, str]:
    if granularity == "week":
        iso = d.isocalendar()
        return f"{iso.year}-W{iso.week:02d}", f"W{iso.week:02d} {iso.year}"
    if granularity == "month":
        return f"{d.year}-{d.month:02d}", d.strftime("%b %Y")
    return d.isoformat(), d.strftime("%d %b")


def trends(db: Session, scope: Scope, *, granularity: str = "day", date_from: date | None = None,
           date_to: date | None = None, course_id: int | None = None) -> dict[str, Any]:
    if granularity not in GRANULARITIES:
        raise AppError(422, "invalid_granularity", "granularity must be one of day, week or month")
    records = db.scalars(
        _record_select(scope, date_from=date_from, date_to=date_to, course_id=course_id)
    ).all()

    series: dict[str, dict[str, Any]] = {}
    distribution = {status: 0 for status in ATTENDANCE_STATUSES}
    courses: dict[int, dict[str, Any]] = {}
    for record in records:
        distribution[record.status] = distribution.get(record.status, 0) + 1
        key, label = _bucket(record.session.session_date, granularity)
        point = series.setdefault(
            key,
            {"bucket": key, "label": label, "present": 0, "late": 0, "absent": 0, "excused": 0,
             "pending_review": 0, "total": 0, "rate": 0.0},
        )
        if record.status in point:
            point[record.status] += 1
        point["total"] += 1

        course = record.session.course
        row = courses.setdefault(
            course.id,
            {"course_id": course.id, "code": course.code, "name": course.name, "present": 0, "late": 0,
             "absent": 0, "excused": 0, "pending_review": 0, "total": 0, "rate": 0.0},
        )
        if record.status in row:
            row[record.status] += 1
        row["total"] += 1

    for point in series.values():
        point["rate"] = rate(point["present"], point["late"], point["total"])
    ordered = [series[key] for key in sorted(series)]
    for row in courses.values():
        row["rate"] = rate(row["present"], row["late"], row["total"])
    course_rows = sorted(courses.values(), key=lambda item: item["code"])
    return {
        "granularity": granularity,
        "date_from": date_from,
        "date_to": date_to,
        "series": ordered,
        "distribution": distribution,
        "courses": course_rows,
    }


def activity(db: Session, scope: Scope, *, limit: int = 8) -> dict[str, Any]:
    event_stmt = (
        select(RecognitionEvent)
        .join(AttendanceSession, AttendanceSession.id == RecognitionEvent.session_id)
        .order_by(RecognitionEvent.occurred_at.desc(), RecognitionEvent.id.desc())
        .limit(limit)
    )
    if scope.faculty_id is not None:
        event_stmt = event_stmt.where(AttendanceSession.faculty_id == scope.faculty_id)
    events = []
    for event in db.scalars(event_stmt).all():
        session = event.session
        student = event.matched_student or event.candidate_student
        events.append({
            "id": event.id,
            "occurred_at": event.occurred_at,
            "outcome": event.outcome,
            "course_code": session.course.code if session else None,
            "session_title": session.title if session else None,
            "student_name": student.full_name if student else None,
            "liveness_status": event.liveness_status,
            "review_status": event.review_status,
        })

    session_stmt = (
        select(AttendanceSession)
        .where(AttendanceSession.status != "cancelled")
        .order_by(AttendanceSession.session_date.desc(), AttendanceSession.id.desc())
        .limit(5)
    )
    if scope.faculty_id is not None:
        session_stmt = session_stmt.where(AttendanceSession.faculty_id == scope.faculty_id)
    sessions = db.scalars(session_stmt).all()
    counts = attendance_service.compute_counts_many(db, [session.id for session in sessions])
    session_rows = [
        {
            "id": session.id,
            "title": session.title,
            "course_code": session.course.code,
            "session_date": session.session_date,
            "status": session.status,
            "counts": counts[session.id],
        }
        for session in sessions
    ]

    pending_reviews, pending_corrections = _pending_counts(db, scope)
    return {
        "events": events,
        "sessions": session_rows,
        "pending_reviews": pending_reviews,
        "pending_corrections": pending_corrections,
    }


def _counted_columns() -> list[dict[str, str]]:
    return [
        {"key": "present", "label": "Present", "align": "right"},
        {"key": "late", "label": "Late", "align": "right"},
        {"key": "absent", "label": "Absent", "align": "right"},
        {"key": "excused", "label": "Excused", "align": "right"},
        {"key": "pending_review", "label": "Pending", "align": "right"},
        {"key": "total", "label": "Total", "align": "right"},
        {"key": "rate", "label": "Attendance %", "align": "right"},
    ]


def _empty_counts() -> dict[str, int]:
    return {status: 0 for status in ATTENDANCE_STATUSES}


GROUPING: dict[str, list[dict[str, str]]] = {
    "daily": [{"key": "date", "label": "Date", "align": "left"}],
    "weekly": [{"key": "week", "label": "Week", "align": "left"}],
    "monthly": [{"key": "month", "label": "Month", "align": "left"}],
    "course": [
        {"key": "course", "label": "Course", "align": "left"},
        {"key": "course_name", "label": "Name", "align": "left"},
    ],
    "student": [
        {"key": "student", "label": "Student", "align": "left"},
        {"key": "registration", "label": "Reg. no.", "align": "left"},
    ],
    "faculty": [{"key": "faculty", "label": "Faculty", "align": "left"}],
}


def _grouped_report(db: Session, scope: Scope, report_type: str, *, date_from: date | None,
                    date_to: date | None, course_id: int | None, page: int, page_size: int) -> dict[str, Any]:
    records = db.scalars(
        _record_select(scope, date_from=date_from, date_to=date_to, course_id=course_id)
    ).all()
    groups: dict[Any, dict[str, Any]] = {}
    for record in records:
        if report_type == "daily":
            key = record.session.session_date.isoformat()
            dimensions = {"date": record.session.session_date.isoformat()}
        elif report_type == "weekly":
            iso = record.session.session_date.isocalendar()
            key = (iso.year, iso.week)
            dimensions = {"week": f"{iso.year}-W{iso.week:02d}"}
        elif report_type == "monthly":
            key = (record.session.session_date.year, record.session.session_date.month)
            dimensions = {"month": f"{key[0]}-{key[1]:02d}"}
        elif report_type == "course":
            key = record.session.course.id
            dimensions = {"course": record.session.course.code, "course_name": record.session.course.name}
        elif report_type == "student":
            key = record.student.id
            dimensions = {
                "student": record.student.full_name,
                "registration": record.student.registration_number,
            }
        else:
            faculty = record.session.faculty
            key = faculty.id if faculty else 0
            dimensions = {"faculty": faculty.full_name if faculty else "Unassigned"}
        row = groups.setdefault(key, {**dimensions, **_empty_counts(), "total": 0, "rate": 0.0})
        if record.status in row:
            row[record.status] += 1
        row["total"] += 1

    rows = list(groups.values())
    if report_type in ("daily", "weekly", "monthly"):
        rows.sort(key=lambda row: next(iter(row.values())))
    else:
        rows.sort(key=lambda row: next(iter(row.values())).lower())
    for row in rows:
        row["rate"] = rate(row["present"], row["late"], row["total"])

    totals = _empty_counts()
    for row in rows:
        for status in ATTENDANCE_STATUSES:
            totals[status] += row[status]
    total = sum(totals.values())

    return {
        "type": report_type,
        "columns": GROUPING[report_type] + _counted_columns(),
        "rows": rows[(page - 1) * page_size: page * page_size],
        "total": len(rows),
        "page": page,
        "page_size": page_size,
        "date_from": date_from,
        "date_to": date_to,
        "summary": {**totals, "records": total, "rate": rate(totals["present"], totals["late"], total)},
    }


def _detail_report(db: Session, scope: Scope, report_type: str, *, date_from: date | None,
                   date_to: date | None, course_id: int | None, page: int, page_size: int) -> dict[str, Any]:
    status = {"late": "late", "absence": "absent", "exceptions": "pending_review"}[report_type]
    stmt = _record_select(
        scope, date_from=date_from, date_to=date_to, course_id=course_id
    ).where(AttendanceRecord.status == status)
    total = _count(db, stmt)
    records = db.scalars(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    rows = [
        {
            "date": record.session.session_date.isoformat(),
            "course": record.session.course.code,
            "session": record.session.title,
            "student": record.student.full_name,
            "registration": record.student.registration_number,
            "status": STATUS_LABELS.get(record.status, record.status),
            "source": record.source,
            "marked_at": _stamp(record.marked_at),
        }
        for record in records
    ]
    return {
        "type": report_type,
        "columns": [
            {"key": "date", "label": "Date"},
            {"key": "course", "label": "Course"},
            {"key": "session", "label": "Session"},
            {"key": "student", "label": "Student"},
            {"key": "registration", "label": "Reg. no."},
            {"key": "status", "label": "Status"},
            {"key": "source", "label": "Source"},
            {"key": "marked_at", "label": "Marked at"},
        ],
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "date_from": date_from,
        "date_to": date_to,
        "summary": {"records": total},
    }


def _corrections_report(db: Session, scope: Scope, *, date_from: date | None, date_to: date | None,
                        course_id: int | None, status: str | None, page: int, page_size: int) -> dict[str, Any]:
    stmt = (
        select(CorrectionRequest)
        .join(AttendanceSession, AttendanceSession.id == CorrectionRequest.session_id)
        .join(Student, Student.id == CorrectionRequest.student_id)
        .where(AttendanceSession.status != "cancelled")
        .order_by(CorrectionRequest.created_at.desc(), CorrectionRequest.id.desc())
    )
    if scope.faculty_id is not None:
        stmt = stmt.where(AttendanceSession.faculty_id == scope.faculty_id)
    if scope.student_id is not None:
        stmt = stmt.where(CorrectionRequest.student_id == scope.student_id)
    if course_id is not None:
        stmt = stmt.where(AttendanceSession.course_id == course_id)
    if date_from is not None:
        stmt = stmt.where(AttendanceSession.session_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(AttendanceSession.session_date <= date_to)
    if status:
        stmt = stmt.where(CorrectionRequest.status == status)

    total = _count(db, stmt)
    requests = db.scalars(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    rows = []
    for request in requests:
        current = None
        if request.attendance_record_id is not None:
            record = db.get(AttendanceRecord, request.attendance_record_id)
            current = STATUS_LABELS.get(record.status) if record else None
        rows.append({
            "requested_at": _stamp(request.created_at),
            "session_date": request.session.session_date.isoformat(),
            "course": request.session.course.code,
            "session": request.session.title,
            "student": request.student.full_name,
            "registration": request.student.registration_number,
            "current": current or "Not marked",
            "requested": STATUS_LABELS.get(request.requested_status, request.requested_status),
            "status": CORRECTION_STATUS_LABELS.get(request.status, request.status),
            "reason": request.reason,
            "reviewed_at": _stamp(request.reviewed_at),
        })
    return {
        "type": "corrections",
        "columns": [
            {"key": "requested_at", "label": "Requested"},
            {"key": "session_date", "label": "Session date"},
            {"key": "course", "label": "Course"},
            {"key": "session", "label": "Session"},
            {"key": "student", "label": "Student"},
            {"key": "registration", "label": "Reg. no."},
            {"key": "current", "label": "Current"},
            {"key": "requested", "label": "Requested"},
            {"key": "status", "label": "Status"},
            {"key": "reason", "label": "Reason"},
            {"key": "reviewed_at", "label": "Reviewed"},
        ],
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "date_from": date_from,
        "date_to": date_to,
        "summary": {"records": total},
    }


def report(db: Session, scope: Scope, report_type: str, *, date_from: date | None = None,
           date_to: date | None = None, course_id: int | None = None, status: str | None = None,
           page: int = 1, page_size: int = 20) -> dict[str, Any]:
    if report_type not in REPORT_TYPES:
        raise AppError(422, "invalid_report_type", f"Unknown report type '{report_type}'")
    if report_type == "corrections":
        return _corrections_report(db, scope, date_from=date_from, date_to=date_to, course_id=course_id,
                                   status=status, page=page, page_size=page_size)
    if report_type in DETAIL_TYPES:
        return _detail_report(db, scope, report_type, date_from=date_from, date_to=date_to,
                              course_id=course_id, page=page, page_size=page_size)
    return _grouped_report(db, scope, report_type, date_from=date_from, date_to=date_to,
                           course_id=course_id, page=page, page_size=page_size)


FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value: Any) -> str | int | float:
    """CSV cells that begin with a formula marker are prefixed with an apostrophe.

    Numbers stay numeric; only text can trigger spreadsheet formula evaluation.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    if text.startswith(FORMULA_PREFIXES):
        return "'" + text
    return text


def _csv_bytes(columns: list[dict[str, str]], rows: Iterable[dict[str, Any]]) -> bytes:
    buffer = io.StringIO()
    buffer.write("\ufeff")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow([column["label"] for column in columns])
    for row in rows:
        writer.writerow([safe_cell(row.get(column["key"])) for column in columns])
    return buffer.getvalue().encode("utf-8")


def _pdf_bytes(report_type: str, columns: list[dict[str, str]], rows: list[dict[str, Any]], *,
               date_from: date | None, date_to: date | None) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=28,
        rightMargin=28,
        topMargin=28,
        bottomMargin=28,
        title=f"SmartAttend AI - {REPORT_LABELS.get(report_type, report_type)}",
        author="SmartAttend AI",
    )
    heading = ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=14, leading=17, textColor="#0f172a")
    meta = ParagraphStyle("meta", fontName="Helvetica", fontSize=8, leading=11, textColor="#475569")
    body_style = ParagraphStyle("cell", fontName="Helvetica", fontSize=7.5, leading=9.5, textColor="#0f172a")
    head_style = ParagraphStyle("head", parent=body_style, fontName="Helvetica-Bold", textColor="#ffffff")

    def cell(value: Any, style: ParagraphStyle = body_style) -> Paragraph:
        text = "" if value is None else str(value)
        return Paragraph(html.escape(text).replace("\n", "<br/>") or "&nbsp;", style)

    period = "All available data"
    if date_from or date_to:
        period = f"{date_from.isoformat() if date_from else 'start'} to {date_to.isoformat() if date_to else 'today'}"
    story = [
        Paragraph(html.escape(f"SmartAttend AI — {REPORT_LABELS.get(report_type, report_type)}"), heading),
        Paragraph(html.escape(f"Period: {period} · {len(rows)} row(s) · generated {_stamp(as_of())}"), meta),
        Spacer(1, 10),
    ]

    header = [cell(column["label"], head_style) for column in columns]
    data = [header]
    for row in rows:
        data.append([cell(row.get(column["key"])) for column in columns])

    available = landscape(A4)[0] - 56
    widths = [available / max(1, len(columns))] * len(columns)
    table = LongTable(data, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(table)
    doc.build(story)
    return buffer.getvalue()


def export(db: Session, scope: Scope, report_type: str, fmt: str, *, date_from: date | None = None,
           date_to: date | None = None, course_id: int | None = None, status: str | None = None
           ) -> tuple[bytes, str, str]:
    if fmt not in ("csv", "pdf"):
        raise AppError(422, "invalid_format", "format must be csv or pdf")
    payload = report(
        db, scope, report_type, date_from=date_from, date_to=date_to, course_id=course_id, status=status,
        page=1, page_size=MAX_EXPORT_ROWS,
    )
    if payload["total"] > MAX_EXPORT_ROWS:
        raise AppError(
            422, "export_too_large",
            f"This report has {payload['total']} rows; narrow the date range to export at most {MAX_EXPORT_ROWS}",
        )
    columns = payload["columns"]
    rows = payload["rows"]
    filename = f"smartattend-{report_type}-{date.today().isoformat()}.{fmt}"
    if fmt == "csv":
        return _csv_bytes(columns, rows), "text/csv; charset=utf-8", filename
    return _pdf_bytes(report_type, columns, rows, date_from=date_from, date_to=date_to), "application/pdf", filename
