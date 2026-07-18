from __future__ import annotations

import sqlite3


MIGRATION_ID = "20260718_01_session_runs"


def apply_session_runs_migration(conn: sqlite3.Connection) -> None:
    """Add durable chat-run lifecycle state without rewriting existing tables.

    This migration is intentionally idempotent so an existing local database can
    be opened directly.  A future centralized migration runner only needs to call
    this function (or adopt the same DDL) at its normal registration point.
    """

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS session_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('queued', 'running', 'completed', 'failed', 'interrupted')
          ),
          queued_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          updated_at TEXT NOT NULL,
          error_json TEXT,
          last_committed_action_index INTEGER NOT NULL DEFAULT -1,
          UNIQUE(session_id, attempt)
        );

        CREATE INDEX IF NOT EXISTS idx_session_runs_session_attempt
        ON session_runs(session_id, attempt DESC);

        CREATE INDEX IF NOT EXISTS idx_session_runs_active
        ON session_runs(status, session_id)
        WHERE status IN ('queued', 'running');
        """
    )
