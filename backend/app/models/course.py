from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_check, utcnow
from app.models.people import Faculty, Student

COURSE_STATUSES = ("active", "archived")
ENROLLMENT_STATUSES = ("active", "dropped")


class Course(TimestampMixin, Base):
    __tablename__ = "courses"
    __table_args__ = (CheckConstraint(enum_check("status", COURSE_STATUSES), name="status"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    department: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    term: Mapped[str] = mapped_column(String(20), nullable=False)
    faculty_id: Mapped[int | None] = mapped_column(ForeignKey("faculty.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")

    faculty: Mapped[Faculty | None] = relationship(lazy="joined")


class CourseEnrollment(Base):
    __tablename__ = "course_enrollments"
    __table_args__ = (
        UniqueConstraint("course_id", "student_id", name="uq_course_enrollments_course_student"),
        CheckConstraint(enum_check("status", ENROLLMENT_STATUSES), name="status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="RESTRICT"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="RESTRICT"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    dropped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    student: Mapped[Student] = relationship(lazy="joined")
    course: Mapped[Course] = relationship(lazy="joined")
