"""Move problem/thought collection into the formal tutoring conversation.

Revision ID: 0005_conversational_context
Revises: 0004_session_runs
Create Date: 2026-07-19
"""

from __future__ import annotations

from alembic import op


revision = "0005_conversational_context"
down_revision = "0004_session_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        ALTER TABLE sessions
        ADD COLUMN context_status TEXT NOT NULL DEFAULT 'ready'
          CHECK (context_status IN ('need_problem', 'need_thought', 'ready'))
        """
    )


def downgrade() -> None:
    op.drop_column("sessions", "context_status")
