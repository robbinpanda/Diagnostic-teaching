from __future__ import annotations

import json

from app.services.input_acceptance_models import (
    CHECKPOINT_ANSWER,
    AcceptedSessionInput,
    InputStateConflictError,
    InputValidationError,
)
from app.services.input_acceptance_models import (
    canonical_json as _canonical_json,
)
from app.services.input_acceptance_models import (
    load_json as _load_json,
)
from app.storage.database import with_sqlite_busy_retry
from app.storage.repository_utils import new_id, now_iso


class CheckpointAcceptanceMixin:
    @with_sqlite_busy_retry
    def accept_checkpoint_answer(
        self,
        checkpoint_id: str,
        *,
        session_id: str,
        selected_option_id: str,
        elapsed_ms: int,
        run_id: str | None = None,
    ) -> AcceptedSessionInput:
        key = f"checkpoint:{checkpoint_id}"
        payload_json = _canonical_json(
            {
                "checkpoint_id": checkpoint_id,
                "selected_option_id": selected_option_id,
            }
        )

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            checkpoint = conn.execute(
                "SELECT * FROM checkpoints WHERE id = ?",
                (checkpoint_id,),
            ).fetchone()
            if checkpoint is None:
                raise KeyError(checkpoint_id)
            if checkpoint["session_id"] != session_id:
                raise PermissionError(checkpoint_id)

            checkpoint_payload = _load_json(checkpoint["options_json"])
            options = checkpoint_payload.get("options", [])
            unknown = checkpoint_payload.get(
                "unknown_option",
                {"id": "UNKNOWN", "text": "我不知道"},
            )
            allowed = {option.get("id") for option in options} | {unknown.get("id", "UNKNOWN")}
            if selected_option_id not in allowed:
                raise InputValidationError("选择项不存在")

            existing = self._existing_by_key(conn, session_id, key)
            if existing is None:
                existing = conn.execute(
                    "SELECT * FROM session_inputs WHERE checkpoint_id = ?",
                    (checkpoint_id,),
                ).fetchone()
            if existing is not None:
                self._assert_same_input(
                    existing,
                    kind=CHECKPOINT_ANSWER,
                    payload_json=payload_json,
                )
                message_row = conn.execute(
                    "SELECT * FROM messages WHERE id = ?",
                    (existing["message_id"],),
                ).fetchone()
                return AcceptedSessionInput(
                    input_row=existing,
                    accepted=False,
                    result=_load_json(existing["result_json"]),
                    message_row=message_row,
                    checkpoint_row=checkpoint,
                )

            if checkpoint["answered_at"] is not None:
                if checkpoint["selected_option_id"] != selected_option_id:
                    raise InputStateConflictError(checkpoint_id)
                return self._backfill_legacy_checkpoint_input(
                    conn,
                    checkpoint,
                    key=key,
                    payload_json=payload_json,
                    checkpoint_payload=checkpoint_payload,
                )

            selected = next(
                (option for option in options if option.get("id") == selected_option_id),
                None,
            )
            selected_text = selected.get("text", "") if selected else unknown.get("text", "我不知道")
            misconception = selected.get("misconception") if selected else None
            is_correct = selected_option_id == checkpoint["correct_option_id"]
            if selected_option_id == unknown.get("id", "UNKNOWN"):
                event = "CHECKPOINT_UNKNOWN"
                next_state_hint = "recovering"
            elif is_correct:
                event = "CHECKPOINT_CORRECT"
                next_state_hint = "scaffolding"
            else:
                event = "CHECKPOINT_WRONG"
                next_state_hint = "recovering"

            student_message = (
                f"我在检查点「{checkpoint['question']}」选了："
                f"{selected_option_id} {selected_text}"
            )
            checkpoint_result = {
                "checkpoint_id": checkpoint_id,
                "question": checkpoint["question"],
                "selected_option_id": selected_option_id,
                "selected_text": selected_text,
                "is_correct": bool(is_correct),
                "misconception": misconception,
                "elapsed_ms": elapsed_ms,
                "event": event,
                "next_state_hint": next_state_hint,
            }
            input_id = new_id("inp")
            message_id = new_id("msg")
            action_id = new_id("act")
            ts = now_iso()
            result = {
                "is_correct": bool(is_correct),
                "elapsed_ms": elapsed_ms,
                "event": event,
                "next_state_hint": next_state_hint,
                "student_message": student_message,
                "action_id": action_id,
            }
            conn.execute(
                """
                INSERT INTO session_inputs (
                  id, session_id, kind, idempotency_key, payload_json,
                  result_json, message_id, checkpoint_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    input_id,
                    session_id,
                    CHECKPOINT_ANSWER,
                    key,
                    payload_json,
                    _canonical_json(result),
                    message_id,
                    checkpoint_id,
                    ts,
                ),
            )
            cursor = conn.execute(
                """
                UPDATE checkpoints
                SET selected_option_id = ?, is_correct = ?, elapsed_ms = ?, answered_at = ?
                WHERE id = ? AND answered_at IS NULL
                """,
                (selected_option_id, int(is_correct), elapsed_ms, ts, checkpoint_id),
            )
            if cursor.rowcount != 1:
                raise InputStateConflictError(checkpoint_id)
            conn.execute(
                """
                INSERT INTO messages (
                  id, session_id, role, content, action_id, action,
                  in_reply_to_action_id, metadata_json, created_at
                ) VALUES (?, ?, 'student', ?, ?, 'CHECKPOINT_RESPONSE', ?, ?, ?)
                """,
                (
                    message_id,
                    session_id,
                    student_message,
                    action_id,
                    checkpoint["source_action_id"],
                    json.dumps({"checkpoint_result": checkpoint_result}, ensure_ascii=False),
                    ts,
                ),
            )
            conn.execute(
                """
                UPDATE sessions
                SET phase = ?, breakpoint_description = NULL,
                    breakpoint_confidence = NULL, updated_at = ?
                WHERE id = ?
                """,
                (next_state_hint, ts, session_id),
            )
            self.sessions.events.append_in_transaction(
                conn,
                session_id,
                [
                    (
                        "checkpoint.completed",
                        {
                            **checkpoint_result,
                            "input_id": input_id,
                            "source_action_id": checkpoint["source_action_id"],
                            "student_message_id": message_id,
                            "student_action_id": action_id,
                        },
                    ),
                    (
                        "message.completed",
                        {
                            "run_id": run_id,
                            "input_id": input_id,
                            "message_id": message_id,
                            "role": "student",
                            "content": student_message,
                            "action_id": action_id,
                            "action": "CHECKPOINT_RESPONSE",
                            "in_reply_to_action_id": checkpoint["source_action_id"],
                        },
                    ),
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
            updated_checkpoint = conn.execute(
                "SELECT * FROM checkpoints WHERE id = ?",
                (checkpoint_id,),
            ).fetchone()
        return AcceptedSessionInput(
            input_row=input_row,
            accepted=True,
            result=result,
            message_row=message_row,
            checkpoint_row=updated_checkpoint,
        )

    def _backfill_legacy_checkpoint_input(
        self,
        conn,
        checkpoint,
        *,
        key: str,
        payload_json: str,
        checkpoint_payload: dict,
    ) -> AcceptedSessionInput:
        messages = conn.execute(
            """
            SELECT * FROM messages
            WHERE session_id = ? AND action = 'CHECKPOINT_RESPONSE'
              AND in_reply_to_action_id = ?
            ORDER BY created_at ASC, rowid ASC
            """,
            (checkpoint["session_id"], checkpoint["source_action_id"]),
        ).fetchall()
        message_row = None
        checkpoint_result: dict = {}
        for candidate in messages:
            metadata = _load_json(candidate["metadata_json"])
            possible = metadata.get("checkpoint_result") or metadata.get("checkpoint_answer")
            if isinstance(possible, dict) and possible.get("checkpoint_id") == checkpoint["id"]:
                message_row = candidate
                checkpoint_result = possible
                break
        if message_row is None:
            raise InputStateConflictError(checkpoint["id"])

        event = checkpoint_result.get("event")
        if not event:
            unknown_id = checkpoint_payload.get("unknown_option", {}).get("id", "UNKNOWN")
            if checkpoint["selected_option_id"] == unknown_id:
                event = "CHECKPOINT_UNKNOWN"
            elif bool(checkpoint["is_correct"]):
                event = "CHECKPOINT_CORRECT"
            else:
                event = "CHECKPOINT_WRONG"
        next_state_hint = checkpoint_result.get("next_state_hint") or (
            "scaffolding" if event == "CHECKPOINT_CORRECT" else "recovering"
        )
        result = {
            "is_correct": bool(checkpoint["is_correct"]),
            "elapsed_ms": checkpoint["elapsed_ms"] or 0,
            "event": event,
            "next_state_hint": next_state_hint,
            "student_message": message_row["content"],
            "action_id": message_row["action_id"],
        }
        input_id = new_id("inp")
        conn.execute(
            """
            INSERT INTO session_inputs (
              id, session_id, kind, idempotency_key, payload_json,
              result_json, message_id, checkpoint_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                input_id,
                checkpoint["session_id"],
                CHECKPOINT_ANSWER,
                key,
                payload_json,
                _canonical_json(result),
                message_row["id"],
                checkpoint["id"],
                checkpoint["answered_at"],
            ),
        )
        input_row = conn.execute(
            "SELECT * FROM session_inputs WHERE id = ?",
            (input_id,),
        ).fetchone()
        return AcceptedSessionInput(
            input_row=input_row,
            accepted=False,
            result=result,
            message_row=message_row,
            checkpoint_row=checkpoint,
        )
