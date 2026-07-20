from __future__ import annotations

from app.services.input_acceptance_models import (
    STUDENT_MESSAGE,
    AcceptedSessionInput,
    InputValidationError,
    InputWorkflowConflictError,
)
from app.services.input_acceptance_models import (
    canonical_json as _canonical_json,
)
from app.services.input_acceptance_models import (
    load_json as _load_json,
)
from app.storage.repository_utils import new_id, now_iso


class StudentMessageAcceptanceMixin:
    def accept_student_message(
        self,
        session_id: str,
        *,
        client_message_id: str,
        message: str,
        run_id: str | None = None,
    ) -> AcceptedSessionInput:
        text = message.strip()
        if not text:
            raise InputValidationError("学生消息不能为空")
        key = client_message_id.strip()
        if not key:
            raise InputValidationError("client_message_id 不能为空")
        payload_json = _canonical_json({"message": text})

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
                raise KeyError(session_id)
            existing = self._existing_by_key(conn, session_id, key)
            if existing is not None:
                self._assert_same_input(existing, kind=STUDENT_MESSAGE, payload_json=payload_json)
                message_row = conn.execute(
                    "SELECT * FROM messages WHERE id = ?",
                    (existing["message_id"],),
                ).fetchone()
                return AcceptedSessionInput(
                    input_row=existing,
                    accepted=False,
                    result=_load_json(existing["result_json"]),
                    message_row=message_row,
                )
            pending_card = conn.execute(
                """
                SELECT id FROM study_cards
                WHERE session_id = ? AND saved_at IS NULL
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
            if pending_card is not None:
                raise InputWorkflowConflictError(pending_card["id"])

            input_id = new_id("inp")
            message_id = new_id("msg")
            action_id = new_id("act")
            in_reply_to_action_id = self._latest_blocking_action_id(conn, session_id)
            ts = now_iso()
            result = {
                "message_id": message_id,
                "action_id": action_id,
                "in_reply_to_action_id": in_reply_to_action_id,
            }
            conn.execute(
                """
                INSERT INTO session_inputs (
                  id, session_id, kind, idempotency_key, payload_json,
                  result_json, message_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    input_id,
                    session_id,
                    STUDENT_MESSAGE,
                    key,
                    payload_json,
                    _canonical_json(result),
                    message_id,
                    ts,
                ),
            )
            conn.execute(
                """
                INSERT INTO messages (
                  id, session_id, role, content, action_id, action,
                  in_reply_to_action_id, metadata_json, created_at
                ) VALUES (?, ?, 'student', ?, ?, 'STUDENT_RESPONSE', ?, '{}', ?)
                """,
                (message_id, session_id, text, action_id, in_reply_to_action_id, ts),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (ts, session_id),
            )
            self.sessions.events.append_in_transaction(
                conn,
                session_id,
                [
                    (
                        "message.completed",
                        {
                            "run_id": run_id,
                            "input_id": input_id,
                            "client_message_id": key,
                            "message_id": message_id,
                            "role": "student",
                            "content": text,
                            "action_id": action_id,
                            "action": "STUDENT_RESPONSE",
                            "in_reply_to_action_id": in_reply_to_action_id,
                        },
                    )
                ],
            )
            input_row = conn.execute(
                "SELECT * FROM session_inputs WHERE id = ?",
                (input_id,),
            ).fetchone()
            message_row = conn.execute(
                "SELECT * FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()
        return AcceptedSessionInput(
            input_row=input_row,
            accepted=True,
            result=result,
            message_row=message_row,
        )
