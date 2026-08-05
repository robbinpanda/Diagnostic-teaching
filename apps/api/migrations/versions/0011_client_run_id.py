"""Add idempotent client identities for chat generation runs.

Revision ID: 0011_client_run_id
Revises: 0010_merge_feature_heads
"""

from __future__ import annotations

from alembic import op


revision = "0011_client_run_id"
down_revision = "0010_merge_feature_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {
        row[1]
        for row in bind.exec_driver_sql("PRAGMA table_info(session_runs)").fetchall()
    }
    if "client_run_id" not in columns:
        bind.exec_driver_sql("ALTER TABLE session_runs ADD COLUMN client_run_id TEXT")
    bind.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_session_runs_client_run "
        "ON session_runs(session_id, client_run_id) WHERE client_run_id IS NOT NULL"
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DROP INDEX IF EXISTS uq_session_runs_client_run")
