"""student self marking

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-26 12:15:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "attendance_sessions",
        sa.Column("self_marking_enabled", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "session_participants",
        sa.Column("self_marking_locked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "session_participants",
        sa.Column("self_marking_locked_by_user_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "session_participants",
        sa.Column("self_marking_lock_reason", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_session_participants_self_marking_locked_by_user_id_users"),
        "session_participants",
        "users",
        ["self_marking_locked_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_constraint(op.f("ck_attendance_records_source"), "attendance_records", type_="check")
    op.alter_column("attendance_records", "source", type_=sa.String(length=16),
                    existing_type=sa.String(length=10))
    op.create_check_constraint(
        op.f("ck_attendance_records_source"),
        "attendance_records",
        "source IN ('automated', 'manual', 'system', 'self_reported')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_attendance_records_source"), "attendance_records", type_="check")
    op.create_check_constraint(
        op.f("ck_attendance_records_source"),
        "attendance_records",
        "source IN ('automated', 'manual', 'system')",
    )
    op.alter_column("attendance_records", "source", type_=sa.String(length=10),
                    existing_type=sa.String(length=16))
    op.drop_constraint(
        op.f("fk_session_participants_self_marking_locked_by_user_id_users"),
        "session_participants",
        type_="foreignkey",
    )
    op.drop_column("session_participants", "self_marking_lock_reason")
    op.drop_column("session_participants", "self_marking_locked_by_user_id")
    op.drop_column("session_participants", "self_marking_locked_at")
    op.drop_column("attendance_sessions", "self_marking_enabled")
