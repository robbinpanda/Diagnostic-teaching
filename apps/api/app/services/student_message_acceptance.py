from __future__ import annotations

from app.services.input_acceptance_models import (
    STUDENT_MESSAGE,
    AcceptedSessionInput,
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


class StudentMessageAcceptanceMixin:
    @with_sqlite_busy_retry
    def accept_student_message(
        self,
        session_id: str,
        *,
        client_message_id: str,
        message: str,
        image_data_url: str | None = None,
        run_id: str | None = None,
    ) -> AcceptedSessionInput:
        text = message.strip()
        normalized_image = (image_data_url or "").strip() or None
        if not text and not normalized_image:
            raise InputValidationError("学生消息必须包含文字或图片")
        if normalized_image and not normalized_image.startswith("data:image/"):
            raise InputValidationError("消息图片格式无效")
        display_text = text or "我上传了一张补充图片，请结合图片内容回答。"
        key = client_message_id.strip()
        if not key:
            raise InputValidationError("client_message_id 不能为空")
        payload_json = _canonical_json(
            {
                "message": text,
                **(
                    {"image_data_url": normalized_image}
                    if normalized_image
                    else {}
                ),
            }
        )

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
                SELECT * FROM study_cards
                WHERE session_id = ? AND saved_at IS NULL AND deferred_at IS NULL
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
            input_id = new_id("inp")
            message_id = new_id("msg")
            action_id = new_id("act")
            in_reply_to_action_id = self._latest_blocking_action_id(conn, session_id)
            ts = now_iso()
            pending_checkpoint = conn.execute(
                """
                SELECT * FROM checkpoints
                WHERE session_id = ? AND answered_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
            checkpoint_free_text_response = None
            if pending_checkpoint is not None:
                checkpoint_free_text_response = {
                    "checkpoint_id": pending_checkpoint["id"],
                    "response_text": display_text,
                    "response_mode": "free_text",
                }
            result = {
                "message_id": message_id,
                "action_id": action_id,
                "in_reply_to_action_id": in_reply_to_action_id,
                "checkpoint_free_text_response": checkpoint_free_text_response,
                "deferred_card_id": pending_card["id"] if pending_card is not None else None,
                "card_deferred_at": ts if pending_card is not None else None,
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
                ) VALUES (?, ?, 'student', ?, ?, 'STUDENT_RESPONSE', ?, ?, ?)
                """,
                (
                    message_id,
                    session_id,
                    display_text,
                    action_id,
                    in_reply_to_action_id,
                    _canonical_json(
                        {
                            **(
                                {"checkpoint_free_text_response": checkpoint_free_text_response}
                                if checkpoint_free_text_response
                                else {}
                            ),
                            **(
                                {"image_data_url": normalized_image}
                                if normalized_image
                                else {}
                            ),
                        }
                    ),
                    ts,
                ),
            )
            if pending_checkpoint is not None:
                conn.execute(
                    """
                    UPDATE checkpoints
                    SET free_text_response = ?, answered_at = ?
                    WHERE id = ? AND answered_at IS NULL
                    """,
                    (display_text, ts, pending_checkpoint["id"]),
                )
            if pending_card is not None:
                conn.execute(
                    """
                    UPDATE study_cards
                    SET deferred_at = COALESCE(deferred_at, ?)
                    WHERE id = ? AND saved_at IS NULL AND deferred_at IS NULL
                    """,
                    (ts, pending_card["id"]),
                )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (ts, session_id),
            )
            self.sessions.events.append_in_transaction(
                conn,
                session_id,
                ([
                    (
                        "card.deferred",
                        {
                            "run_id": run_id,
                            "card_id": pending_card["id"],
                            "card_type": pending_card["card_type"],
                            "source_action_id": pending_card["source_action_id"],
                            "deferred_at": ts,
                        },
                    )
                ] if pending_card is not None else []) + ([
                    (
                        "checkpoint.completed",
                        {
                            "run_id": run_id,
                            **checkpoint_free_text_response,
                            "source_action_id": pending_checkpoint["source_action_id"],
                        },
                    )
                ] if pending_checkpoint is not None and checkpoint_free_text_response else []) + [
                    (
                        "message.completed",
                        {
                            "run_id": run_id,
                            "input_id": input_id,
                            "client_message_id": key,
                            "message_id": message_id,
                            "role": "student",
                            "content": display_text,
                            "has_image": bool(normalized_image),
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
