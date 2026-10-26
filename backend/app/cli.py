"""Operational commands: python -m app.cli <command>."""

import argparse
import getpass
import sys
from datetime import datetime, timedelta

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.security import hash_password, password_problems
from app.models import AttendanceSession, BiometricTemplate, Course, Faculty, Role, Student, User
from app.models.base import utcnow
from app.models.user import ROLE_ADMIN, ROLE_FACULTY, ROLE_IDS, ROLE_STUDENT
from app.schemas.session import SessionIn
from app.services import (
    attendance_service,
    audit_service,
    biometric_service,
    auth_service,
    course_service,
    session_service,
    settings_service,
)

DEMO_FACULTY = (
    {"employee_id": "FAC-CS-001", "full_name": "Meera Iyer", "email": "meera.iyer@niet.edu",
     "department": "Computer Science", "designation": "Associate Professor"},
    {"employee_id": "FAC-CS-002", "full_name": "Arun Verma", "email": "arun.verma@niet.edu",
     "department": "Computer Science", "designation": "Assistant Professor"},
)

DEMO_STUDENTS = (
    ("CS21-001", "Asha Rao", "asha.rao@niet.edu"),
    ("CS21-002", "Bilal Khan", "bilal.khan@niet.edu"),
    ("CS21-003", "Chen Wei", "chen.wei@niet.edu"),
    ("CS21-004", "Diya Menon", "diya.menon@niet.edu"),
    ("CS21-005", "Ethan Fernandes", "ethan.fernandes@niet.edu"),
    ("CS21-006", "Fatima Sheikh", "fatima.sheikh@niet.edu"),
    ("CS21-007", "Gaurav Patel", "gaurav.patel@niet.edu"),
    ("CS21-008", "Hana Suzuki", "hana.suzuki@niet.edu"),
    ("CS21-009", "Ibrahim Musa", "ibrahim.musa@niet.edu"),
    ("CS21-010", "Jaya Krishnan", "jaya.krishnan@niet.edu"),
)

DEMO_COURSES = (
    {"code": "CS301", "name": "Database Systems", "term": "2026-27 Odd", "faculty": 0},
    {"code": "CS302", "name": "Operating Systems", "term": "2026-27 Odd", "faculty": 1},
    {"code": "CS305", "name": "Web Engineering", "term": "2026-27 Odd", "faculty": 0},
)


def seed_admin(_: argparse.Namespace) -> int:
    settings = get_settings()
    if settings.is_production:
        print("seed-admin is a development command and is disabled when APP_ENV=production.", file=sys.stderr)
        return 2
    email, password = settings.seed_admin_email, settings.seed_admin_password
    if not email or not password:
        print("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env first.", file=sys.stderr)
        return 2
    email = auth_service.normalize_email(email)
    problems = password_problems(password, email)
    if problems:
        print("SEED_ADMIN_PASSWORD is too weak: " + "; ".join(problems), file=sys.stderr)
        return 2
    with SessionLocal() as db:
        settings_service.seed_defaults(db)
        if db.scalar(select(User).where(User.email == email)) is not None:
            db.commit()
            print(f"Admin {email} already exists; nothing changed.")
            return 0
        user = User(email=email, full_name="Development Administrator", role_id=ROLE_IDS[ROLE_ADMIN],
                    password_hash=hash_password(password), password_changed_at=utcnow())
        db.add(user)
        db.flush()
        audit_service.record(db, actor=None, action="user.seed_admin", entity_type="user", entity_id=user.id,
                             after={"email": email})
        db.commit()
    print(f"Created development admin {email}. The password is the SEED_ADMIN_PASSWORD value in .env.")
    return 0


def create_admin(args: argparse.Namespace) -> int:
    """First-run bootstrap that also works in production. The password is never printed."""
    name = args.name.strip()
    if not 2 <= len(name) <= 120:
        print("--name must be between 2 and 120 characters.", file=sys.stderr)
        return 2
    try:
        email = validate_email(args.email.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        print(f"Invalid email: {exc}", file=sys.stderr)
        return 2

    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)) is not None:
            print(f"A user with {email} already exists; nothing changed.", file=sys.stderr)
            return 1

    password = getpass.getpass(f"Password for {email}: ")
    if password != getpass.getpass("Repeat password: "):
        print("Passwords do not match.", file=sys.stderr)
        return 2
    problems = password_problems(password, email)
    if problems:
        print("Password is too weak: " + "; ".join(problems), file=sys.stderr)
        return 2

    with SessionLocal() as db:
        settings_service.seed_defaults(db)
        user = User(email=email, full_name=name, role_id=ROLE_IDS[ROLE_ADMIN],
                    password_hash=hash_password(password), password_changed_at=utcnow())
        db.add(user)
        db.flush()
        audit_service.record(db, actor=None, action="user.create_admin", entity_type="user", entity_id=user.id,
                             after={"email": email, "full_name": name})
        db.commit()
    print(f"Created administrator {email}.")
    return 0


def purge_biometrics(args: argparse.Namespace) -> int:
    """Delete templates kept longer than the retention period after deactivation."""
    with SessionLocal() as db:
        settings_service.seed_defaults(db)
        retention = args.retention_days
        if retention is None:
            retention = settings_service.get(db, "biometric_retention_days")
        if retention < 0:
            print("--retention-days cannot be negative.", file=sys.stderr)
            return 2
        cutoff = utcnow() - timedelta(days=retention)
        students = db.scalars(
            select(Student).where(
                Student.deactivated_at.is_not(None),
                Student.deactivated_at <= cutoff,
            )
        ).all()
        targets = [
            student for student in students
            if db.scalar(select(BiometricTemplate.id).where(BiometricTemplate.student_id == student.id)) is not None
        ]
        pending = sum(
            len(db.scalars(select(BiometricTemplate.id).where(BiometricTemplate.student_id == student.id)).all())
            for student in targets
        )
        if args.dry_run:
            print(f"Dry run: {pending} templates from {len(targets)} deactivated students exceed "
                  f"the {retention}-day retention period.")
            return 0
        if not args.yes:
            print("Refusing to delete without --yes. Use --dry-run to inspect the scope.", file=sys.stderr)
            return 2
        deleted = 0
        for student in targets:
            result = biometric_service.delete_templates(
                db, student, actor=None, withdraw_consent=True,
                reason=f"retention purge: {retention} days after deactivation",
            )
            deleted += result["deleted_templates"]
    print(f"Purged {deleted} templates from {len(targets)} deactivated students.")
    return 0


def seed_demo(_: argparse.Namespace) -> int:
    settings = get_settings()
    if settings.is_production:
        print("seed-demo is a development command and is disabled when APP_ENV=production.", file=sys.stderr)
        return 2
    demo_password = settings.seed_admin_password
    with SessionLocal() as db:
        settings_service.seed_defaults(db)
        admin = db.scalar(
            select(User).join(Role, Role.id == User.role_id).where(Role.name == ROLE_ADMIN).order_by(User.id)
        )
        if admin is None:
            print("Create an administrator first: python -m app.cli seed-admin", file=sys.stderr)
            return 2

        faculty_rows: list[Faculty] = []
        for spec in DEMO_FACULTY:
            faculty = db.scalar(select(Faculty).where(Faculty.employee_id == spec["employee_id"]))
            if faculty is None:
                faculty = Faculty(**spec, status="active")
                db.add(faculty)
                db.flush()
            faculty_rows.append(faculty)

        student_rows: list[Student] = []
        for reg, name, email in DEMO_STUDENTS:
            student = db.scalar(select(Student).where(Student.registration_number == reg))
            if student is None:
                student = Student(registration_number=reg, full_name=name, email=email, department="Computer Science",
                                  program="B.Sc. Computer Science", enrollment_year=2021, status="active")
                db.add(student)
                db.flush()
            student_rows.append(student)

        courses: dict[str, Course] = {}
        for spec in DEMO_COURSES:
            course = db.scalar(select(Course).where(Course.code == spec["code"]))
            if course is None:
                course = Course(code=spec["code"], name=spec["name"], department="Computer Science",
                                term=spec["term"], faculty_id=faculty_rows[spec["faculty"]].id, status="active")
                db.add(course)
                db.flush()
            courses[spec["code"]] = course
        db.commit()

        enrollments = {"CS301": student_rows, "CS302": student_rows, "CS305": student_rows[:6]}
        for code, group in enrollments.items():
            course_service.enroll_students(db, courses[code], [s.id for s in group], admin)

        accounts: list[str] = []
        if demo_password:
            for faculty in faculty_rows:
                if faculty.user_id is None and db.scalar(select(User.id).where(User.email == faculty.email)) is None:
                    user = User(email=faculty.email, full_name=faculty.full_name, role_id=ROLE_IDS[ROLE_FACULTY],
                                password_hash=hash_password(demo_password), password_changed_at=utcnow())
                    db.add(user)
                    db.flush()
                    faculty.user_id = user.id
                    accounts.append(f"faculty {faculty.email}")
            first_student = student_rows[0]
            if first_student.user_id is None and db.scalar(select(User.id).where(User.email == first_student.email)) is None:
                user = User(email=first_student.email, full_name=first_student.full_name,
                            role_id=ROLE_IDS[ROLE_STUDENT], password_hash=hash_password(demo_password),
                            password_changed_at=utcnow())
                db.add(user)
                db.flush()
                first_student.user_id = user.id
                accounts.append(f"student {first_student.email}")
            audit_service.record(db, actor=admin, action="demo.seed_accounts", entity_type="user",
                                 after={"accounts": accounts})
            db.commit()

        if db.scalar(select(AttendanceSession.id).limit(1)) is None:
            tz = settings.tz
            now = datetime.now(tz)
            today = now.date()
            yesterday = today - timedelta(days=1)
            by_reg = {s.registration_number: s for s in student_rows}

            def at(day, hour: int, minute: int = 0) -> datetime:
                return datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)

            closed = session_service.create_session(
                db, SessionIn(course_id=courses["CS301"].id, title="Lecture 3 - Normalisation",
                              scheduled_start=at(yesterday, 9), scheduled_end=at(yesterday, 10)), admin)
            session_service.start(db, closed.id, admin)
            for reg in ("CS21-001", "CS21-002", "CS21-004", "CS21-005", "CS21-007"):
                attendance_service.mark_manual(db, closed.id, by_reg[reg].id, "present", "Demo seed", admin)
            attendance_service.mark_manual(db, closed.id, by_reg["CS21-003"].id, "late", "Demo seed", admin)
            session_service.close(db, closed.id, admin)
            session_service.finalize(db, closed.id, admin)

            live = session_service.create_session(
                db, SessionIn(course_id=courses["CS301"].id, title="Lecture 4 - Indexing",
                              scheduled_start=now - timedelta(minutes=10),
                              scheduled_end=now + timedelta(minutes=50)), admin)
            session_service.start(db, live.id, admin)
            for reg in ("CS21-001", "CS21-006", "CS21-009"):
                attendance_service.mark_manual(db, live.id, by_reg[reg].id, "present", "Demo seed", admin)
            attendance_service.mark_manual(db, live.id, by_reg["CS21-010"].id, "late", "Demo seed", admin)

            session_service.create_session(
                db, SessionIn(course_id=courses["CS301"].id, title="Lecture 5 - Transactions",
                              scheduled_start=at(today + timedelta(days=1), 11),
                              scheduled_end=at(today + timedelta(days=1), 12)), admin)
            session_service.create_session(
                db, SessionIn(course_id=courses["CS302"].id, title="Process Scheduling",
                              scheduled_start=at(today + timedelta(days=1), 14),
                              scheduled_end=at(today + timedelta(days=1), 15)), admin)

    print("Demo data ready: 2 faculty, 10 students, 3 courses, 4 sessions.")
    if demo_password:
        print("Portal accounts use the SEED_ADMIN_PASSWORD value from .env:")
        print("  faculty meera.iyer@niet.edu, arun.verma@niet.edu; student asha.rao@niet.edu")
    else:
        print("SEED_ADMIN_PASSWORD is not set, so no demo portal accounts were created.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-admin", help="create the development admin from SEED_ADMIN_* settings").set_defaults(func=seed_admin)
    sub.add_parser("seed-demo", help="create demo faculty, students, courses and sessions").set_defaults(func=seed_demo)
    create = sub.add_parser("create-admin", help="create an administrator interactively (works in production)")
    create.add_argument("--email", required=True)
    create.add_argument("--name", default="Administrator")
    create.set_defaults(func=create_admin)
    purge = sub.add_parser("purge-biometrics", help="delete templates past the post-deactivation retention period")
    purge.add_argument("--retention-days", type=int)
    purge.add_argument("--dry-run", action="store_true")
    purge.add_argument("--yes", action="store_true", help="required to perform deletion")
    purge.set_defaults(func=purge_biometrics)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
