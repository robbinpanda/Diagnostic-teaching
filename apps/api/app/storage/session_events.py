from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import Any

from app.storage.database import Database, with_sqlite_busy_retry

SESSION_EVENT_SCHEMA_VERSION = 1
DEFAULT_EVENT_HISTORY_LIMIT = 100
MAX_EVENT_HISTORY_LIMIT = 200


def append_session_event(
    conn: sqlite3.Connection,
    session_id: str,
    event_type: str,
    data: dict[str, Any],
) -> sqlite3.Row:
    """Append one event using the caller's transaction.

    The INSERT ... SELECT is a single SQLite write statement. SQLite serializes
    writers before evaluating it, while the UNIQUE(session_id, seq) constraint
    remains the final guard against duplicate sequence numbers.
    """

    event_id = f"evt_{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO session_events (id, session_id, seq, type, data_json, created_at)
        SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
        FROM session_events
        WHERE session_id = ?
        """,
        (
            event_id,
            session_id,
            event_type,
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            datetime.now(UTC).isoformat(),
            session_id,
        ),
    )
    row = conn.execute(
        "SELECT * FROM session_events WHERE id = ?",
        (event_id,),
    ).fetchone()
    if row is None:  # pragma: no cover - defensive guard around SQLite
        raise RuntimeError("session event append returned no row")
    return row


def event_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "schema_version": SESSION_EVENT_SCHEMA_VERSION,
        "id": row["id"],
        "session_id": row["session_id"],
        "seq": row["seq"],
        "type": row["type"],
        "data": json.loads(row["data_json"]),
        "created_at": row["created_at"],
    }


class SessionEventRepository:
    def __init__(self, db: Database):
        self.db = db

    def append(
        self,
        session_id: str,
        event_type: str,
        data: dict[str, Any],
    ) -> sqlite3.Row:
        return self.append_many(session_id, [(event_type, data)])[0]

    @with_sqlite_busy_retry
    def append_many(
        self,
        session_id: str,
        events: Iterable[tuple[str, dict[str, Any]]],
    ) -> list[sqlite3.Row]:
        pending = list(events)
        if not pending:
            return []
        with self.db.connect() as conn:
            # Acquire the writer lock before reading MAX(seq). This makes seq
            # allocation deterministic under concurrent threads/processes.
            conn.execute("BEGIN IMMEDIATE")
            exists = conn.execute(
                "SELECT 1 FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if exists is None:
                raise KeyError(session_id)
            return [
                append_session_event(conn, session_id, event_type, data)
                for event_type, data in pending
            ]

    def list(
        self,
        session_id: str,
        *,
        after_seq: int = 0,
        limit: int = DEFAULT_EVENT_HISTORY_LIMIT,
    ) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_events
                WHERE session_id = ? AND seq > ?
                ORDER BY seq ASC
                LIMIT ?
                """,
                (session_id, after_seq, limit),
            ).fetchall()

    def latest_seq(self, session_id: str) -> int:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS latest_seq FROM session_events WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        return int(row["latest_seq"])

    def append_in_transaction(
        self,
        conn: sqlite3.Connection,
        session_id: str,
        events: Sequence[tuple[str, dict[str, Any]]],
    ) -> list[sqlite3.Row]:
        return [
            append_session_event(conn, session_id, event_type, data)
            for event_type, data in events
        ]
