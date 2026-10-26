from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, LargeBinary, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, enum_check, utcnow

CONSENT_STATUSES = ("granted", "withdrawn")
CAPTURE_METHODS = ("staff_assisted", "self_service")


class BiometricConsent(TimestampMixin, Base):
    __tablename__ = "biometric_consents"
    __table_args__ = (
        CheckConstraint(enum_check("status", CONSENT_STATUSES), name="status"),
        CheckConstraint(enum_check("capture_method", CAPTURE_METHODS), name="capture_method"),
        Index("uq_biometric_consents_one_granted", "student_id", unique=True, postgresql_where=text("status = 'granted'")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="RESTRICT"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(20), nullable=False)
    capture_method: Mapped[str] = mapped_column(String(20), nullable=False)
    recorded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawal_reason: Mapped[str | None] = mapped_column(Text)


class BiometricTemplate(Base):
    """Encrypted face embedding. Never serialised to API responses."""

    __tablename__ = "biometric_templates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    consent_id: Mapped[int] = mapped_column(ForeignKey("biometric_consents.id", ondelete="RESTRICT"), nullable=False)
    model_name: Mapped[str] = mapped_column(String(60), nullable=False)
    model_version: Mapped[str] = mapped_column(String(40), nullable=False)
    embedding_dim: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_id: Mapped[str] = mapped_column(String(20), nullable=False)
    quality: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
