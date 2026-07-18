"""Add durable chat run lifecycle state.

Revision ID: 0004_session_runs
Revises: 0003_session_events
Create Date: 2026-07-18
"""

from __future__ import annotations

from alembic import op


revision = "0004_session_runs"
down_revision = "0003_session_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # IF NOT EXISTS preserves databases that briefly used the standalone
    # pre-integration migration while Alembic remains the sole owner going forward.
    bind.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS session_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          attempt INTEGER NOT NULL CHECK (attempt > 0),
          status TEXT NOT NULL CHECK (
            status IN ('queued', 'running', 'completed', 'failed', 'interrupted')
          ),
          queued_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          updated_at TEXT NOT NULL,
          error_json TEXT,
          last_committed_action_index INTEGER NOT NULL DEFAULT -1
            CHECK (last_committed_action_index >= -1),
          UNIQUE(session_id, attempt),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
            ON UPDATE CASCADE ON DELETE CASCADE
        )
        """
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_session_runs_session_attempt "
        "ON session_runs(session_id, attempt DESC)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_session_runs_active "
        "ON session_runs(status, session_id) "
        "WHERE status IN ('queued', 'running')"
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DROP TABLE session_runs")
