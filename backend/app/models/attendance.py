from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_check, utcnow
from app.models.course import Course
from app.models.people import Faculty, Student

SESSION_STATUSES = ("scheduled", "active", "paused", "closed", "finalized", "cancelled")
LIVENESS_POLICIES = ("off", "flag", "enforce")
ATTENDANCE_STATUSES = ("present", "late", "absent", "pending_review", "excused")
ATTENDANCE_SOURCES = ("automated", "manual", "system", "self_reported")
RECOGNITION_OUTCOMES = (
    "recognized",
    "unknown",
    "low_confidence",
    "poor_quality",
    "no_face",
    "multiple_faces",
    "liveness_failed",
    "duplicate",
    "not_eligible",
    "error",
)
LIVENESS_STATUSES = ("not_required", "not_enabled", "passed", "failed", "inconclusive", "error")
REVIEW_STATUSES = ("not_required", "pending", "resolved", "dismissed")
CORRECTION_TYPES = ("correction", "manual_attendance")
CORRECTION_STATUSES = ("pending", "approved", "rejected", "withdrawn")
REQUESTABLE_STATUSES = ("present", "late", "excused")


class AttendanceSession(TimestampMixin, Base):
    __tablename__ = "attendance_sessions"
    __table_args__ = (
        CheckConstraint(enum_check("status", SESSION_STATUSES), name="status"),
        CheckConstraint(enum_check("liveness_policy", LIVENESS_POLICIES), name="liveness_policy"),
        CheckConstraint("scheduled_end > scheduled_start", name="end_after_start"),
        CheckConstraint(
            "scheduled_start <= late_after AND late_after <= attendance_closes_at", name="window_order"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="RESTRICT"), nullable=False, index=True)
    faculty_id: Mapped[int] = mapped_column(ForeignKey("faculty.id", ondelete="RESTRICT"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    session_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    scheduled_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scheduled_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    late_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attendance_closes_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="scheduled", server_default="scheduled", index=True)
    liveness_policy: Mapped[str] = mapped_column(String(8), nullable=False, default="off", server_default="off")
    self_marking_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    course: Mapped[Course] = relationship(lazy="joined")
    faculty: Mapped[Faculty] = relationship(lazy="joined")


class SessionParticipant(Base):
    __tablename__ = "session_participants"
    __table_args__ = (UniqueConstraint("session_id", "student_id", name="uq_session_participants_session_student"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="RESTRICT"), nullable=False, index=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    self_marking_locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    self_marking_locked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    self_marking_lock_reason: Mapped[str | None] = mapped_column(Text)

    student: Mapped[Student] = relationship(lazy="joined")


class RecognitionEvent(Base):
    __tablename__ = "recognition_events"
    __table_args__ = (
        CheckConstraint(enum_check("outcome", RECOGNITION_OUTCOMES), name="outcome"),
        CheckConstraint(enum_check("liveness_status", LIVENESS_STATUSES), name="liveness_status"),
        CheckConstraint(enum_check("review_status", REVIEW_STATUSES), name="review_status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("attendance_sessions.id", ondelete="RESTRICT"), index=True)
    operator_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    outcome: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    matched_student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), index=True)
    candidate_student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"))
    similarity: Mapped[float | None] = mapped_column(Float)
    second_similarity: Mapped[float | None] = mapped_column(Float)
    threshold_used: Mapped[float | None] = mapped_column(Float)
    detector_score: Mapped[float | None] = mapped_column(Float)
    quality: Mapped[dict | None] = mapped_column(JSONB)
    liveness_status: Mapped[str] = mapped_column(String(14), nullable=False, default="not_required")
    liveness_score: Mapped[float | None] = mapped_column(Float)
    liveness_model: Mapped[str | None] = mapped_column(String(60))
    model_name: Mapped[str | None] = mapped_column(String(60))
    model_version: Mapped[str | None] = mapped_column(String(40))
    processing_ms: Mapped[int | None] = mapped_column(Integer)
    review_status: Mapped[str] = mapped_column(String(14), nullable=False, default="not_required", index=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(40))

    session: Mapped[AttendanceSession | None] = relationship(lazy="joined")
    matched_student: Mapped[Student | None] = relationship(foreign_keys=[matched_student_id], lazy="joined")
    candidate_student: Mapped[Student | None] = relationship(foreign_keys=[candidate_student_id], lazy="joined")


class AttendanceRecord(TimestampMixin, Base):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_attendance_records_session_student"),
        CheckConstraint(enum_check("status", ATTENDANCE_STATUSES), name="status"),
        CheckConstraint(enum_check("source", ATTENDANCE_SOURCES), name="source"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("attendance_sessions.id", ondelete="RESTRICT"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="RESTRICT"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    marked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    recognition_event_id: Mapped[int | None] = mapped_column(ForeignKey("recognition_events.id", ondelete="SET NULL"))
    marked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    correction_reason: Mapped[str | None] = mapped_column(Text)
    corrected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    session: Mapped[AttendanceSession] = relationship(lazy="joined")
    student: Mapped[Student] = relationship(lazy="joined")


class CorrectionRequest(TimestampMixin, Base):
    __tablename__ = "correction_requests"
    __table_args__ = (
        CheckConstraint(enum_check("request_type", CORRECTION_TYPES), name="request_type"),
        CheckConstraint(enum_check("status", CORRECTION_STATUSES), name="status"),
        CheckConstraint(enum_check("requested_status", REQUESTABLE_STATUSES), name="requested_status"),
        Index(
            "uq_correction_requests_one_pending",
            "student_id",
            "session_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="RESTRICT"), nullable=False, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("attendance_sessions.id", ondelete="RESTRICT"), nullable=False)
    attendance_record_id: Mapped[int | None] = mapped_column(ForeignKey("attendance_records.id", ondelete="SET NULL"))
    request_type: Mapped[str] = mapped_column(String(20), nullable=False)
    requested_status: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending", server_default="pending", index=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewer_note: Mapped[str | None] = mapped_column(Text)

    student: Mapped[Student] = relationship(lazy="joined")
    session: Mapped[AttendanceSession] = relationship(lazy="joined")
