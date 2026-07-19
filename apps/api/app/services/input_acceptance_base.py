from __future__ import annotations

from app.services.input_acceptance_models import (
    IdempotencyConflictError,
)
from app.storage.repositories import SessionRepository


class InputAcceptanceBase:
    def __init__(self, sessions: SessionRepository):
        self.sessions = sessions
        self.db = sessions.db

    @staticmethod
    def _existing_by_key(conn, session_id: str, idempotency_key: str):
        return conn.execute(
            """
            SELECT * FROM session_inputs
            WHERE session_id = ? AND idempotency_key = ?
            """,
            (session_id, idempotency_key),
        ).fetchone()

    @staticmethod
    def _assert_same_input(existing, *, kind: str, payload_json: str) -> None:
        if existing["kind"] != kind or existing["payload_json"] != payload_json:
            raise IdempotencyConflictError(existing["idempotency_key"])

    @staticmethod
    def _latest_blocking_action_id(conn, session_id: str) -> str | None:
        row = conn.execute(
            """
            SELECT action_id FROM messages
            WHERE session_id = ? AND role = 'assistant'
              AND action IN ('ASK_OPEN_QUESTION', 'ASK_MULTIPLE_CHOICE')
            ORDER BY created_at DESC, rowid DESC
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()
        if not row or not row["action_id"]:
            return None
        answered = conn.execute(
            """
            SELECT 1 FROM messages
            WHERE session_id = ? AND role = 'student' AND in_reply_to_action_id = ?
            LIMIT 1
            """,
            (session_id, row["action_id"]),
        ).fetchone()
        return None if answered else row["action_id"]
