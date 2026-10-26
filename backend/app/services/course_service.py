from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.errors import AppError, conflict, not_found
from app.models import (
    AttendanceSession,
    BiometricTemplate,
    Course,
    CourseEnrollment,
    Faculty,
    SessionParticipant,
    Student,
    User,
)
from app.models.base import utcnow
from app.schemas.common import like_pattern
from app.schemas.course import CourseIn, CourseUpdate
from app.services import audit_service

COURSE_FIELDS = ("code", "name", "department", "term", "faculty_id", "status")


def student_count(db: Session, course_id: int) -> int:
    return db.scalar(
        select(func.count(CourseEnrollment.id)).where(
            CourseEnrollment.course_id == course_id, CourseEnrollment.status == "active"
        )
    ) or 0


def course_out(db: Session, course: Course) -> dict:
    return {
        "id": course.id,
        "code": course.code,
        "name": course.name,
        "department": course.department,
        "term": course.term,
        "faculty_id": course.faculty_id,
        "faculty_name": course.faculty.full_name if course.faculty else None,
        "status": course.status,
        "student_count": student_count(db, course.id),
        "created_at": course.created_at,
    }


def get_course(db: Session, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if course is None:
        raise not_found("Course")
    return course


def create_course(db: Session, data: CourseIn, actor: User, request=None) -> Course:
    if db.scalar(select(Course.id).where(Course.code == data.code)):
        raise conflict("duplicate_course_code", "A course with this code already exists")
    if data.faculty_id is not None:
        faculty = db.get(Faculty, data.faculty_id)
        if faculty is None:
            raise AppError(422, "invalid_faculty", "Selected faculty member does not exist")
        if faculty.status != "active":
            raise AppError(422, "faculty_inactive", "Selected faculty member is not active")
    course = Course(
        code=data.code,
        name=data.name,
        department=data.department,
        term=data.term,
        faculty_id=data.faculty_id,
        status="active",
    )
    db.add(course)
    db.flush()
    audit_service.record(db, actor=actor, action="course.create", entity_type="course", entity_id=course.id,
                         after=audit_service.snapshot(course, COURSE_FIELDS), request=request)
    db.commit()
    return course


def update_course(db: Session, course: Course, data: CourseUpdate, actor: User, request=None) -> Course:
    before = audit_service.snapshot(course, COURSE_FIELDS)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("faculty_id") is not None:
        faculty = db.get(Faculty, changes["faculty_id"])
        if faculty is None:
            raise AppError(422, "invalid_faculty", "Selected faculty member does not exist")
        if faculty.status != "active":
            raise AppError(422, "faculty_inactive", "Selected faculty member is not active")
    for field in ("name", "department", "term", "status"):
        if changes.get(field) is not None:
            setattr(course, field, changes[field])
    if "faculty_id" in changes:
        course.faculty_id = changes["faculty_id"]
    audit_service.record(db, actor=actor, action="course.update", entity_type="course", entity_id=course.id,
                         before=before, after=audit_service.snapshot(course, COURSE_FIELDS), request=request)
    db.commit()
    return course


def search_courses(db: Session, *, q: str | None, department: str | None, status: str | None,
                   faculty_id: int | None):
    stmt = select(Course).order_by(Course.code)
    if q:
        pattern = like_pattern(q)
        stmt = stmt.where(or_(Course.code.ilike(pattern), Course.name.ilike(pattern)))
    if department:
        stmt = stmt.where(Course.department == department)
    if status:
        stmt = stmt.where(Course.status == status)
    if faculty_id is not None:
        stmt = stmt.where(Course.faculty_id == faculty_id)
    return stmt


def _sync_open_sessions(db: Session, course_id: int, student_ids: list[int]) -> None:
    if not student_ids:
        return
    session_ids = db.scalars(
        select(AttendanceSession.id).where(
            AttendanceSession.course_id == course_id,
            AttendanceSession.status.in_(("scheduled", "active", "paused")),
        )
    ).all()
    if not session_ids:
        return
    db.execute(
        pg_insert(SessionParticipant)
        .values([
            {"session_id": session_id, "student_id": student_id}
            for session_id in session_ids
            for student_id in student_ids
        ])
        .on_conflict_do_nothing(index_elements=["session_id", "student_id"])
    )


def enroll_students(db: Session, course: Course, student_ids: list[int], actor: User,
                    request=None) -> dict:
    now = utcnow()
    unique_ids = list(dict.fromkeys(student_ids))
    added = already = skipped = 0
    added_ids: list[int] = []
    for student_id in unique_ids:
        student = db.get(Student, student_id)
        if student is None:
            raise AppError(422, "invalid_student", f"Student {student_id} does not exist", {"student_id": student_id})
        if student.status != "active":
            skipped += 1
            continue
        existing = db.scalar(
            select(CourseEnrollment).where(
                CourseEnrollment.course_id == course.id, CourseEnrollment.student_id == student_id
            )
        )
        if existing is None:
            db.add(CourseEnrollment(course_id=course.id, student_id=student_id, status="active", enrolled_at=now))
            added += 1
            added_ids.append(student_id)
        elif existing.status == "dropped":
            existing.status = "active"
            existing.enrolled_at = now
            existing.dropped_at = None
            added += 1
            added_ids.append(student_id)
        else:
            already += 1
    if added_ids:
        _sync_open_sessions(db, course.id, added_ids)
    if added:
        audit_service.record(db, actor=actor, action="enrollment.add", entity_type="course", entity_id=course.id,
                             after={"added_student_ids": unique_ids, "added": added}, request=request)
    db.commit()
    return {"added": added, "already_enrolled": already, "skipped_inactive": skipped}


def drop_enrollment(db: Session, course: Course, student_id: int, actor: User, request=None) -> None:
    enrollment = db.scalar(
        select(CourseEnrollment).where(
            CourseEnrollment.course_id == course.id, CourseEnrollment.student_id == student_id
        )
    )
    if enrollment is None or enrollment.status == "dropped":
        raise not_found("Enrollment")
    enrollment.status = "dropped"
    enrollment.dropped_at = utcnow()
    scheduled_ids = select(AttendanceSession.id).where(
        AttendanceSession.course_id == course.id,
        AttendanceSession.status == "scheduled",
    )
    db.execute(
        delete(SessionParticipant).where(
            SessionParticipant.student_id == student_id,
            SessionParticipant.session_id.in_(scheduled_ids),
        )
    )
    audit_service.record(db, actor=actor, action="enrollment.drop", entity_type="course", entity_id=course.id,
                         after={"student_id": student_id}, request=request)
    db.commit()


def roster(db: Session, course: Course) -> list[dict]:
    rows = db.execute(
        select(CourseEnrollment, Student)
        .join(Student, Student.id == CourseEnrollment.student_id)
        .where(CourseEnrollment.course_id == course.id, CourseEnrollment.status == "active")
        .order_by(Student.full_name, Student.id)
    ).all()
    student_ids = [s.id for _, s in rows]
    enrolled_with_template = set(
        db.scalars(select(BiometricTemplate.student_id).where(BiometricTemplate.student_id.in_(student_ids))).all()
    ) if student_ids else set()
    return [
        {
            "student_id": s.id,
            "registration_number": s.registration_number,
            "full_name": s.full_name,
            "email": s.email,
            "department": s.department,
            "status": s.status,
            "enrolled_at": e.enrolled_at,
            "biometric_enrolled": s.id in enrolled_with_template,
        }
        for e, s in rows
    ]
