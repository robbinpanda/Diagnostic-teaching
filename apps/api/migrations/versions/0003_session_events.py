"""Add the durable per-session event change feed.

Revision ID: 0003_session_events
Revises: 0002_durable_inputs
Create Date: 2026-07-18
"""

from __future__ import annotations

from alembic import op


revision = "0003_session_events"
down_revision = "0002_durable_inputs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # IF NOT EXISTS preserves databases that briefly used the pre-integration
    # SQL migration while moving all future schema ownership to Alembic.
    bind.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS session_events (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL CHECK (seq > 0),
          type TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (session_id, seq),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
            ON UPDATE CASCADE ON DELETE CASCADE
        )
        """
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_session_events_session_seq "
        "ON session_events(session_id, seq)"
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DROP TABLE session_events")
