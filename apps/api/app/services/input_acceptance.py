from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass

from app.core.schemas import SessionStartRequest
from app.storage.repositories import (
    SessionRepository,
    initial_context_status,
    new_id,
    now_iso,
)

STUDENT_MESSAGE = "STUDENT_MESSAGE"
CHECKPOINT_ANSWER = "CHECKPOINT_ANSWER"
CARD_DISMISSED_CONTINUE = "CARD_DISMISSED_CONTINUE"


class IdempotencyConflictError(Exception):
    """The same client key was reused for a different durable input."""


class InputStateConflictError(Exception):
    """A one-shot workflow input was already accepted in another form."""


class InputValidationError(Exception):
    """The submitted input does not satisfy the current workflow contract."""


class InputWorkflowConflictError(Exception):
    """The input is valid in isolation but blocked by current session state."""


@dataclass(frozen=True)
class AcceptedSessionInput:
    input_row: sqlite3.Row
    accepted: bool
    result: dict
    message_row: sqlite3.Row | None = None
    card_row: sqlite3.Row | None = None
    checkpoint_row: sqlite3.Row | None = None


@dataclass(frozen=True)
class StartedSession:
    session_row: sqlite3.Row
    input_row: sqlite3.Row
    message_row: sqlite3.Row
    accepted: bool


def _canonical_json(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _load_json(value: str | None) -> dict:
    if not value:
        return {}
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


class InputAcceptanceService:
    """Durably accepts user inputs before any model generation begins.

    Each public method owns one SQLite transaction containing both the durable
    ``session_inputs`` record and the business mutation caused by that input.
    Model generation deliberately lives outside this service.
    """

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

    def start_session(self, payload: SessionStartRequest) -> StartedSession:
        """Create a session and accept its first message in one transaction.

        The browser supplies the session id and message idempotency key so a
        response-loss retry returns the original durable result instead of
        creating a second conversation.
        """

        text = payload.message.strip()
        key = payload.client_message_id.strip()
        if not text:
            raise InputValidationError("学生消息不能为空")
        if not key:
            raise InputValidationError("client_message_id 不能为空")

        problem_text = payload.problem_text.strip()
        student_thought = payload.student_initial_thought.strip()
        context_status = initial_context_status(problem_text, student_thought)
        payload_json = _canonical_json({"message": text})
        start_fingerprint = hashlib.sha256(
            _canonical_json(
                {
                    "grade_band": payload.grade_band,
                    "subject": payload.subject,
                    "model_profile_id": payload.model_profile_id,
                    "problem_text": problem_text,
                    "student_initial_thought": student_thought,
                    "problem_image_sha256": hashlib.sha256(
                        (payload.problem_image_data_url or "").encode("utf-8")
                    ).hexdigest(),
                }
            ).encode("utf-8")
        ).hexdigest()

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing_session = conn.execute(
                "SELECT * FROM sessions WHERE id = ?",
                (payload.session_id,),
            ).fetchone()
            if existing_session is not None:
                existing_input = self._existing_by_key(conn, payload.session_id, key)
                existing_result = _load_json(existing_input["result_json"]) if existing_input else {}
                if (
                    existing_input is None
                    or existing_result.get("start_fingerprint") != start_fingerprint
                ):
                    raise IdempotencyConflictError(payload.session_id)
                self._assert_same_input(
                    existing_input,
                    kind=STUDENT_MESSAGE,
                    payload_json=payload_json,
                )
                message_row = conn.execute(
                    "SELECT * FROM messages WHERE id = ?",
                    (existing_input["message_id"],),
                ).fetchone()
                if message_row is None:
                    raise InputStateConflictError(payload.session_id)
                return StartedSession(
                    session_row=existing_session,
                    input_row=existing_input,
                    message_row=message_row,
                    accepted=False,
                )

            ts = now_iso()
            input_id = new_id("inp")
            message_id = new_id("msg")
            action_id = new_id("act")
            result = {
                "message_id": message_id,
                "action_id": action_id,
                "in_reply_to_action_id": None,
                "start_fingerprint": start_fingerprint,
            }
            conn.execute(
                """
                INSERT INTO sessions (
                  id, grade_band, subject, model_profile_id, problem_text,
                  problem_image_data_url, student_initial_thought, phase,
                  context_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'diagnosing', ?, ?, ?)
                """,
                (
                    payload.session_id,
                    payload.grade_band,
                    payload.subject,
                    payload.model_profile_id,
                    problem_text,
                    payload.problem_image_data_url,
                    student_thought,
                    context_status,
                    ts,
                    ts,
                ),
            )
            conn.execute(
                """
                INSERT INTO session_inputs (
                  id, session_id, kind, idempotency_key, payload_json,
                  result_json, message_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    input_id,
                    payload.session_id,
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
                ) VALUES (?, ?, 'student', ?, ?, 'STUDENT_RESPONSE', NULL, '{}', ?)
                """,
                (message_id, payload.session_id, text, action_id, ts),
            )
            self.sessions.events.append_in_transaction(
                conn,
                payload.session_id,
                [
                    (
                        "session.created",
                        {
                            "model_profile_id": payload.model_profile_id,
                            "grade_band": payload.grade_band,
                            "subject": payload.subject,
                            "state_hint": "diagnosing",
                            "context_status": context_status,
                            "restored_from": None,
                        },
                    ),
                    (
                        "message.completed",
                        {
                            "run_id": None,
                            "input_id": input_id,
                            "client_message_id": key,
                            "message_id": message_id,
                            "role": "student",
                            "content": text,
                            "action_id": action_id,
                            "action": "STUDENT_RESPONSE",
                            "in_reply_to_action_id": None,
                        },
                    ),
                ],
            )
            session_row = conn.execute(
                "SELECT * FROM sessions WHERE id = ?",
                (payload.session_id,),
            ).fetchone()
            input_row = conn.execute(
                "SELECT * FROM session_inputs WHERE id = ?",
                (input_id,),
            ).fetchone()
            message_row = conn.execute(
                "SELECT * FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()

        return StartedSession(
            session_row=session_row,
            input_row=input_row,
            message_row=message_row,
            accepted=True,
        )

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

    def accept_card_dismissed_continue(
        self,
        session_id: str,
        *,
        client_command_id: str,
        card_id: str,
    ) -> AcceptedSessionInput:
        key = client_command_id.strip()
        if not key:
            raise InputValidationError("client_command_id 不能为空")
        payload_json = _canonical_json({"card_id": card_id})

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
                raise KeyError(session_id)
            existing = self._existing_by_key(conn, session_id, key)
            if existing is not None:
                self._assert_same_input(
                    existing,
                    kind=CARD_DISMISSED_CONTINUE,
                    payload_json=payload_json,
                )
                card_row = conn.execute(
                    "SELECT * FROM study_cards WHERE id = ?",
                    (existing["card_id"],),
                ).fetchone()
                return AcceptedSessionInput(
                    input_row=existing,
                    accepted=False,
                    result=_load_json(existing["result_json"]),
                    card_row=card_row,
                )

            prior_card_input = conn.execute(
                "SELECT * FROM session_inputs WHERE card_id = ?",
                (card_id,),
            ).fetchone()
            if prior_card_input is not None:
                raise InputStateConflictError(card_id)
            card_row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
            if card_row is None:
                raise KeyError(card_id)
            if card_row["session_id"] != session_id:
                raise PermissionError(card_id)
            if card_row["card_type"] != "knowledge_card":
                raise InputValidationError("只有知识卡片关闭后需要继续生成")

            input_id = new_id("inp")
            ts = card_row["saved_at"] or now_iso()
            newly_saved = card_row["saved_at"] is None
            if newly_saved:
                conn.execute(
                    "UPDATE study_cards SET saved_at = ? WHERE id = ?",
                    (ts, card_id),
                )
            result = {"card_id": card_id, "card_saved_at": ts}
            conn.execute(
                """
                INSERT INTO session_inputs (
                  id, session_id, kind, idempotency_key, payload_json,
                  result_json, card_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    input_id,
                    session_id,
                    CARD_DISMISSED_CONTINUE,
                    key,
                    payload_json,
                    _canonical_json(result),
                    card_id,
                    ts,
                ),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (ts, session_id),
            )
            if newly_saved:
                self.sessions.events.append_in_transaction(
                    conn,
                    session_id,
                    [
                        (
                            "card.saved",
                            {
                                "input_id": input_id,
                                "card_id": card_id,
                                "card_type": card_row["card_type"],
                                "source_action_id": card_row["source_action_id"],
                                "source_message_id": card_row["source_message_id"],
                                "saved_at": ts,
                            },
                        )
                    ],
                )
            input_row = conn.execute(
                "SELECT * FROM session_inputs WHERE id = ?",
                (input_id,),
            ).fetchone()
            card_row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
        return AcceptedSessionInput(
            input_row=input_row,
            accepted=True,
            result=result,
            card_row=card_row,
        )

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
