from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import conflict, not_found
from app.models import BiometricConsent, BiometricTemplate, Course, CourseEnrollment, Faculty, Student, User
from app.models.base import utcnow
from app.schemas.common import like_pattern
from app.schemas.people import FacultyIn, FacultyUpdate, StudentIn, StudentUpdate
from app.services import audit_service, auth_service, user_service

STUDENT_FIELDS = ("registration_number", "full_name", "email", "department", "program", "enrollment_year", "status")
FACULTY_FIELDS = ("employee_id", "full_name", "email", "department", "designation", "status")


def normalize_email(email: str) -> str:
    return auth_service.normalize_email(email)


def _email_used_by_login(db: Session, email: str) -> bool:
    return db.scalar(select(User.id).where(User.email == normalize_email(email))) is not None


def create_student(db: Session, data: StudentIn, actor: User, request=None) -> Student:
    email = normalize_email(str(data.email))
    if db.scalar(select(Student.id).where(Student.registration_number == data.registration_number)):
        raise conflict("duplicate_registration_number", "A student with this registration number already exists")
    if db.scalar(select(Student.id).where(Student.email == email)) or _email_used_by_login(db, email):
        raise conflict("email_exists", "This email is already in use")
    student = Student(
        registration_number=data.registration_number,
        full_name=data.full_name,
        email=email,
        department=data.department,
        program=data.program,
        enrollment_year=data.enrollment_year,
        status="active",
    )
    db.add(student)
    db.flush()
    audit_service.record(db, actor=actor, action="student.create", entity_type="student", entity_id=student.id,
                         after=audit_service.snapshot(student, STUDENT_FIELDS), request=request)
    db.commit()
    return student


def update_student(db: Session, student: Student, data: StudentUpdate, actor: User, request=None) -> Student:
    before = audit_service.snapshot(student, STUDENT_FIELDS)
    changes = data.model_dump(exclude_unset=True)
    if "email" in changes and changes["email"] is not None:
        email = normalize_email(str(changes["email"]))
        other = db.scalar(select(Student.id).where(Student.email == email, Student.id != student.id))
        if other or _email_used_by_login(db, email):
            raise conflict("email_exists", "This email is already in use")
        student.email = email
    for field in ("full_name", "department", "program", "enrollment_year"):
        if changes.get(field) is not None:
            setattr(student, field, changes[field])
    if changes.get("status") is not None and changes["status"] != student.status:
        student.status = changes["status"]
        if student.status == "active":
            student.deactivated_at = None
            if student.user_id:
                linked = db.get(User, student.user_id)
                if linked is not None:
                    linked.is_active = True
        else:
            student.deactivated_at = utcnow()
            if student.user_id:
                linked = db.get(User, student.user_id)
                if linked is not None:
                    linked.is_active = False
                    auth_service.revoke_all_sessions(db, linked.id)
    audit_service.record(db, actor=actor, action="student.update", entity_type="student", entity_id=student.id,
                         before=before, after=audit_service.snapshot(student, STUDENT_FIELDS), request=request)
    db.commit()
    return student


def deactivate_student(db: Session, student: Student, reason: str, actor: User, request=None) -> Student:
    if student.status == "inactive":
        return student
    before = audit_service.snapshot(student, STUDENT_FIELDS)
    student.status = "inactive"
    student.deactivated_at = utcnow()
    if student.user_id:
        linked = db.get(User, student.user_id)
        if linked is not None:
            linked.is_active = False
            auth_service.revoke_all_sessions(db, linked.id)
    audit_service.record(db, actor=actor, action="student.deactivate", entity_type="student", entity_id=student.id,
                         before=before, after=audit_service.snapshot(student, STUDENT_FIELDS), reason=reason,
                         request=request)
    db.commit()
    return student


def student_account(db: Session, student: Student, actor: User, request=None) -> tuple[User, str, datetime]:
    if student.user_id:
        raise conflict("account_exists", "This student already has a portal account")
    user = user_service.create_account(db, email=student.email, full_name=student.full_name, role="student",
                                       actor=actor, request=request)
    student.user_id = user.id
    db.commit()
    url, expires = auth_service.issue_reset_link(db, user, actor, request)
    return user, url, expires


def set_student_password(db: Session, student: Student, new_password: str, actor: User,
                         request=None) -> tuple[User, bool]:
    auth_service.validate_new_password(new_password, student.email)
    created = False
    if student.user_id is None:
        user = user_service.create_account(db, email=student.email, full_name=student.full_name, role="student",
                                           actor=actor, request=request)
        student.user_id = user.id
        created = True
    else:
        user = db.get(User, student.user_id)
        if user is None:
            raise not_found("User")
    auth_service.set_password_by_admin(db, user, new_password, actor, request)
    return user, created


def student_detail(db: Session, student: Student) -> dict:
    enrollments = db.execute(
        select(CourseEnrollment, Course)
        .join(Course, Course.id == CourseEnrollment.course_id)
        .where(CourseEnrollment.student_id == student.id, CourseEnrollment.status == "active")
        .order_by(Course.code)
    ).all()
    consent = db.scalar(
        select(BiometricConsent.id).where(BiometricConsent.student_id == student.id, BiometricConsent.status == "granted")
    )
    templates = db.scalar(
        select(func.count(BiometricTemplate.id)).where(BiometricTemplate.student_id == student.id)
    ) or 0
    return {
        "id": student.id,
        "user_id": student.user_id,
        "registration_number": student.registration_number,
        "full_name": student.full_name,
        "email": student.email,
        "department": student.department,
        "program": student.program,
        "enrollment_year": student.enrollment_year,
        "status": student.status,
        "deactivated_at": student.deactivated_at,
        "created_at": student.created_at,
        "updated_at": student.updated_at,
        "has_account": student.user_id is not None,
        "enrollments": [
            {"course_id": c.id, "code": c.code, "name": c.name, "term": c.term, "status": e.status}
            for e, c in enrollments
        ],
        "biometric_consented": consent is not None,
        "template_count": templates,
    }


def create_faculty(db: Session, data: FacultyIn, actor: User, request=None) -> Faculty:
    email = normalize_email(str(data.email))
    if db.scalar(select(Faculty.id).where(Faculty.employee_id == data.employee_id)):
        raise conflict("duplicate_employee_id", "A faculty member with this employee ID already exists")
    if db.scalar(select(Faculty.id).where(Faculty.email == email)) or _email_used_by_login(db, email):
        raise conflict("email_exists", "This email is already in use")
    faculty = Faculty(
        employee_id=data.employee_id,
        full_name=data.full_name,
        email=email,
        department=data.department,
        designation=data.designation,
        status="active",
    )
    db.add(faculty)
    db.flush()
    audit_service.record(db, actor=actor, action="faculty.create", entity_type="faculty", entity_id=faculty.id,
                         after=audit_service.snapshot(faculty, FACULTY_FIELDS), request=request)
    db.commit()
    return faculty


def update_faculty(db: Session, faculty: Faculty, data: FacultyUpdate, actor: User, request=None) -> Faculty:
    before = audit_service.snapshot(faculty, FACULTY_FIELDS)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("email") is not None:
        email = normalize_email(str(changes["email"]))
        other = db.scalar(select(Faculty.id).where(Faculty.email == email, Faculty.id != faculty.id))
        if other or _email_used_by_login(db, email):
            raise conflict("email_exists", "This email is already in use")
        faculty.email = email
    for field in ("full_name", "department", "designation", "status"):
        if changes.get(field) is not None:
            setattr(faculty, field, changes[field])
    if changes.get("status") == "inactive" and faculty.user_id:
        linked = db.get(User, faculty.user_id)
        if linked is not None:
            linked.is_active = False
            auth_service.revoke_all_sessions(db, linked.id)
    if changes.get("status") == "active" and faculty.user_id:
        linked = db.get(User, faculty.user_id)
        if linked is not None:
            linked.is_active = True
    audit_service.record(db, actor=actor, action="faculty.update", entity_type="faculty", entity_id=faculty.id,
                         before=before, after=audit_service.snapshot(faculty, FACULTY_FIELDS), request=request)
    db.commit()
    return faculty


def deactivate_faculty(db: Session, faculty: Faculty, reason: str, actor: User, request=None) -> Faculty:
    if faculty.status == "inactive":
        return faculty
    before = audit_service.snapshot(faculty, FACULTY_FIELDS)
    faculty.status = "inactive"
    if faculty.user_id:
        linked = db.get(User, faculty.user_id)
        if linked is not None:
            linked.is_active = False
            auth_service.revoke_all_sessions(db, linked.id)
    audit_service.record(db, actor=actor, action="faculty.deactivate", entity_type="faculty", entity_id=faculty.id,
                         before=before, after=audit_service.snapshot(faculty, FACULTY_FIELDS), reason=reason,
                         request=request)
    db.commit()
    return faculty


def faculty_account(db: Session, faculty: Faculty, actor: User, request=None) -> tuple[User, str, datetime]:
    if faculty.user_id:
        raise conflict("account_exists", "This faculty member already has a portal account")
    user = user_service.create_account(db, email=faculty.email, full_name=faculty.full_name, role="faculty",
                                       actor=actor, request=request)
    faculty.user_id = user.id
    db.commit()
    url, expires = auth_service.issue_reset_link(db, user, actor, request)
    return user, url, expires


def faculty_detail(db: Session, faculty: Faculty) -> dict:
    rows = db.execute(
        select(Course, func.count(CourseEnrollment.id))
        .outerjoin(
            CourseEnrollment,
            (CourseEnrollment.course_id == Course.id) & (CourseEnrollment.status == "active"),
        )
        .where(Course.faculty_id == faculty.id)
        .group_by(Course.id)
        .order_by(Course.code)
    ).all()
    return {
        "id": faculty.id,
        "user_id": faculty.user_id,
        "employee_id": faculty.employee_id,
        "full_name": faculty.full_name,
        "email": faculty.email,
        "department": faculty.department,
        "designation": faculty.designation,
        "status": faculty.status,
        "created_at": faculty.created_at,
        "updated_at": faculty.updated_at,
        "has_account": faculty.user_id is not None,
        "courses": [
            {"course_id": c.id, "code": c.code, "name": c.name, "term": c.term, "status": c.status,
             "student_count": count}
            for c, count in rows
        ],
    }


def get_student(db: Session, student_id: int) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise not_found("Student")
    return student


def get_faculty(db: Session, faculty_id: int) -> Faculty:
    faculty = db.get(Faculty, faculty_id)
    if faculty is None:
        raise not_found("Faculty member")
    return faculty


def search_students(db: Session, *, q: str | None, department: str | None, program: str | None,
                    status: str | None, course_id: int | None):
    stmt = select(Student).order_by(Student.full_name, Student.id)
    if q:
        pattern = like_pattern(q)
        stmt = stmt.where(or_(Student.full_name.ilike(pattern), Student.registration_number.ilike(pattern),
                              Student.email.ilike(pattern)))
    if department:
        stmt = stmt.where(Student.department == department)
    if program:
        stmt = stmt.where(Student.program == program)
    if status:
        stmt = stmt.where(Student.status == status)
    if course_id:
        stmt = stmt.where(
            Student.id.in_(
                select(CourseEnrollment.student_id).where(
                    CourseEnrollment.course_id == course_id, CourseEnrollment.status == "active"
                )
            )
        )
    return stmt


def search_faculty(db: Session, *, q: str | None, department: str | None, status: str | None):
    stmt = select(Faculty).order_by(Faculty.full_name, Faculty.id)
    if q:
        pattern = like_pattern(q)
        stmt = stmt.where(or_(Faculty.full_name.ilike(pattern), Faculty.employee_id.ilike(pattern),
                              Faculty.email.ilike(pattern)))
    if department:
        stmt = stmt.where(Faculty.department == department)
    if status:
        stmt = stmt.where(Faculty.status == status)
    return stmt
