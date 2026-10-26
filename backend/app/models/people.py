from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_check

STUDENT_STATUSES = ("active", "inactive", "graduated", "suspended")
FACULTY_STATUSES = ("active", "inactive")


class Student(TimestampMixin, Base):
    __tablename__ = "students"
    __table_args__ = (
        CheckConstraint(enum_check("status", STUDENT_STATUSES), name="status"),
        CheckConstraint("enrollment_year BETWEEN 1990 AND 2100", name="enrollment_year"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), unique=True)
    registration_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    department: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    program: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    enrollment_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active", index=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user = relationship("User", back_populates="student")


class Faculty(TimestampMixin, Base):
    __tablename__ = "faculty"
    __table_args__ = (CheckConstraint(enum_check("status", FACULTY_STATUSES), name="status"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), unique=True)
    employee_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    department: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    designation: Mapped[str] = mapped_column(String(80), nullable=False, default="Lecturer", server_default="Lecturer")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active", index=True)

    user = relationship("User", back_populates="faculty")
