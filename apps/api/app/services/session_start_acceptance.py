from __future__ import annotations

import hashlib

from app.core.schemas import SessionStartRequest
from app.services.input_acceptance_models import (
    STUDENT_MESSAGE,
    IdempotencyConflictError,
    InputStateConflictError,
    InputValidationError,
    StartedSession,
)
from app.services.input_acceptance_models import (
    canonical_json as _canonical_json,
)
from app.services.input_acceptance_models import (
    load_json as _load_json,
)
from app.storage.database import with_sqlite_busy_retry
from app.storage.exam_paper_repository import require_exam_paper
from app.storage.repository_utils import initial_context_status, new_id, now_iso


class SessionStartAcceptanceMixin:
    def start_session(self, payload: SessionStartRequest) -> StartedSession:
        """Create a session and accept its first message in one transaction.

        The browser supplies the session id and message idempotency key so a
        response-loss retry returns the original durable result instead of
        creating a second conversation.
        """

        return self.start_sessions([payload])[0]

    @with_sqlite_busy_retry
    def start_sessions(self, payloads: list[SessionStartRequest]) -> list[StartedSession]:
        """Create an idempotent group of sessions in one SQLite transaction."""

        if not payloads:
            raise InputValidationError("批量会话不能为空")
        session_ids = [payload.session_id for payload in payloads]
        if len(session_ids) != len(set(session_ids)):
            raise InputValidationError("同一批次中的 session_id 不能重复")
        for payload in payloads:
            if not payload.message.strip():
                raise InputValidationError("学生消息不能为空")
            if not payload.client_message_id.strip():
                raise InputValidationError("client_message_id 不能为空")

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return [self._start_session_in_transaction(conn, payload) for payload in payloads]

    def _start_session_in_transaction(self, conn, payload: SessionStartRequest) -> StartedSession:
        text = payload.message.strip()
        key = payload.client_message_id.strip()

        problem_text = payload.problem_text.strip()
        student_thought = payload.student_initial_thought.strip()
        context_status = initial_context_status(problem_text, student_thought)
        payload_json = _canonical_json({"message": text})
        start_fingerprint_payload = {
            "grade_band": payload.grade_band,
            "subject": payload.subject,
            "model_profile_id": payload.model_profile_id,
            "problem_text": problem_text,
            "student_initial_thought": student_thought,
            "problem_image_sha256": hashlib.sha256(
                (payload.problem_image_data_url or "").encode("utf-8")
            ).hexdigest(),
        }
        # Keep paper-less starts compatible with fingerprints accepted before 0011.
        if payload.paper_id is not None:
            start_fingerprint_payload["paper_id"] = payload.paper_id
        start_fingerprint = hashlib.sha256(
            _canonical_json(start_fingerprint_payload).encode("utf-8")
        ).hexdigest()

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

        require_exam_paper(conn, payload.paper_id)
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
              id, grade_band, subject, model_profile_id, paper_id, problem_text,
              problem_image_data_url, student_initial_thought, phase,
              context_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'diagnosing', ?, ?, ?)
            """,
            (
                payload.session_id,
                payload.grade_band,
                payload.subject,
                payload.model_profile_id,
                payload.paper_id,
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
