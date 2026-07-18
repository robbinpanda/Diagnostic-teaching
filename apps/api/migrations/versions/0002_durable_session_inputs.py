"""Add durable, idempotent session input admission records.

Revision ID: 0002_durable_inputs
Revises: 0001_sqlite_reliability
Create Date: 2026-07-18
"""

from __future__ import annotations

from alembic import op


revision = "0002_durable_inputs"
down_revision = "0001_sqlite_reliability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        """
        CREATE TABLE session_inputs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (
            kind IN (
              'STUDENT_MESSAGE',
              'CHECKPOINT_ANSWER',
              'CARD_DISMISSED_CONTINUE'
            )
          ),
          idempotency_key TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          result_json TEXT NOT NULL DEFAULT '{}',
          message_id TEXT,
          checkpoint_id TEXT,
          card_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
            ON UPDATE CASCADE ON DELETE CASCADE,
          FOREIGN KEY (message_id) REFERENCES messages(id)
            ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
          FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id)
            ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
          FOREIGN KEY (card_id) REFERENCES study_cards(id)
            ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
        )
        """
    )
    statements = (
        "CREATE UNIQUE INDEX idx_session_inputs_session_key "
        "ON session_inputs(session_id, idempotency_key)",
        "CREATE UNIQUE INDEX idx_session_inputs_checkpoint "
        "ON session_inputs(checkpoint_id) WHERE checkpoint_id IS NOT NULL",
        "CREATE UNIQUE INDEX idx_session_inputs_message "
        "ON session_inputs(message_id) WHERE message_id IS NOT NULL",
        "CREATE UNIQUE INDEX idx_session_inputs_card "
        "ON session_inputs(card_id) WHERE card_id IS NOT NULL",
        "CREATE INDEX idx_session_inputs_session_created "
        "ON session_inputs(session_id, created_at)",
    )
    for statement in statements:
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DROP TABLE session_inputs")
