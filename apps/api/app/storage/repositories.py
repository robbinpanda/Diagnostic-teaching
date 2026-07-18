from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from app.core.schemas import (
    ModelProfileCreate,
    ModelProfileUpdate,
    SessionCreate,
    TutorCheckpoint,
    TutorTurn,
)
from app.llm.opencode_free_models import (
    OPENCODE_FREE_TAG,
    OPENCODE_PUBLIC_API_KEY,
    OpenCodeFreeModel,
)
from app.storage.database import Database
from app.storage.security import SecretBox, mask_api_key
from app.storage.session_events import SessionEventRepository


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def host_from_url(value: str) -> str:
    return urlparse(value).netloc or value


class RunStateConflict(RuntimeError):
    """Raised when work tries to commit after its durable run stopped running."""

    def __init__(self, run_id: str, status: str):
        super().__init__(f"run {run_id} is {status}")
        self.run_id = run_id
        self.status = status


class ModelProfileRepository:
    def __init__(self, db: Database, secrets: SecretBox):
        self.db = db
        self.secrets = secrets

    def create(self, payload: ModelProfileCreate) -> sqlite3.Row:
        return self.create_many([payload])[0]

    def create_many(self, payloads: list[ModelProfileCreate]) -> list[sqlite3.Row]:
        if not payloads:
            return []
        ts = now_iso()
        profile_ids: list[str] = []
        with self.db.connect() as conn:
            for payload in payloads:
                profile_id = new_id("prof")
                profile_ids.append(profile_id)
                api_key = payload.api_key.strip()
                conn.execute(
                    """
                    INSERT INTO model_profiles (
                      id, display_name, provider, base_url, model, api_key_ciphertext,
                      api_key_mask, tags_json, enabled, timeout_ms, temperature,
                      max_output_tokens, is_multimodal, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        profile_id,
                        payload.display_name.strip(),
                        payload.provider,
                        normalize_base_url(str(payload.base_url)),
                        payload.model.strip(),
                        self.secrets.encrypt(api_key),
                        mask_api_key(api_key),
                        json.dumps(payload.tags, ensure_ascii=False),
                        payload.timeout_ms,
                        payload.temperature,
                        payload.max_output_tokens,
                        int(payload.is_multimodal),
                        ts,
                        ts,
                    ),
                )
        return [self.get(profile_id) for profile_id in profile_ids]

    def list_public(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM model_profiles
                WHERE deleted_at IS NULL AND enabled = 1
                ORDER BY
                  CASE WHEN tags_json LIKE '%"opencodefree"%' THEN 1 ELSE 0 END ASC,
                  CASE WHEN tags_json LIKE '%"opencodefree"%' THEN display_name END ASC,
                  created_at DESC
                """
            ).fetchall()

    def sync_opencode_free_models(self, models: tuple[OpenCodeFreeModel, ...]) -> list[sqlite3.Row]:
        ts = now_iso()
        desired_models = {model.model for model in models}
        synced_ids: list[str] = []
        encrypted_public_key = self.secrets.encrypt(OPENCODE_PUBLIC_API_KEY)
        public_key_mask = mask_api_key(OPENCODE_PUBLIC_API_KEY)
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            managed_rows = conn.execute(
                "SELECT * FROM model_profiles WHERE tags_json LIKE ?",
                (f'%"{OPENCODE_FREE_TAG}"%',),
            ).fetchall()
            by_model = {row["model"]: row for row in managed_rows}
            for model in models:
                existing = by_model.get(model.model)
                tags_json = json.dumps(["math", OPENCODE_FREE_TAG], ensure_ascii=False)
                if existing is None:
                    profile_id = new_id("prof")
                    conn.execute(
                        """
                        INSERT INTO model_profiles (
                          id, display_name, provider, base_url, model, api_key_ciphertext,
                          api_key_mask, tags_json, enabled, deleted_at, timeout_ms,
                          temperature, max_output_tokens, is_multimodal, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 30000, 0.2, 8000, ?, ?, ?)
                        """,
                        (
                            profile_id,
                            model.display_name,
                            model.provider,
                            normalize_base_url(model.base_url),
                            model.model,
                            encrypted_public_key,
                            public_key_mask,
                            tags_json,
                            int(model.is_multimodal),
                            ts,
                            ts,
                        ),
                    )
                    synced_ids.append(profile_id)
                    continue
                profile_id = existing["id"]
                conn.execute(
                    """
                    UPDATE model_profiles
                    SET display_name = ?, provider = ?, base_url = ?, api_key_ciphertext = ?,
                        api_key_mask = ?, tags_json = ?, enabled = 1, deleted_at = NULL,
                        is_multimodal = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        model.display_name,
                        model.provider,
                        normalize_base_url(model.base_url),
                        encrypted_public_key,
                        public_key_mask,
                        tags_json,
                        int(model.is_multimodal),
                        ts,
                        profile_id,
                    ),
                )
                synced_ids.append(profile_id)

            for row in managed_rows:
                if row["model"] in desired_models:
                    continue
                conn.execute(
                    "UPDATE model_profiles SET enabled = 0, updated_at = ? WHERE id = ?",
                    (ts, row["id"]),
                )
        return [self.get(profile_id) for profile_id in synced_ids]

    def get(self, profile_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM model_profiles WHERE id = ? AND deleted_at IS NULL",
                (profile_id,),
            ).fetchone()
        if row is None:
            raise KeyError(profile_id)
        return row

    def decrypt_api_key(self, row: sqlite3.Row) -> str:
        return self.secrets.decrypt(row["api_key_ciphertext"])

    def update(self, profile_id: str, payload: ModelProfileUpdate) -> sqlite3.Row:
        if self.is_managed(self.get(profile_id)):
            raise PermissionError(profile_id)
        changes = payload.model_dump(exclude_unset=True)
        assignments: list[str] = []
        values: list[object] = []

        if "display_name" in changes and changes["display_name"] is not None:
            assignments.append("display_name = ?")
            values.append(changes["display_name"].strip())
        if "provider" in changes and changes["provider"] is not None:
            assignments.append("provider = ?")
            values.append(changes["provider"])
        if "base_url" in changes and changes["base_url"] is not None:
            assignments.append("base_url = ?")
            values.append(normalize_base_url(str(changes["base_url"])))
        if "model" in changes and changes["model"] is not None:
            assignments.append("model = ?")
            values.append(changes["model"].strip())
        if "tags" in changes and changes["tags"] is not None:
            assignments.append("tags_json = ?")
            values.append(json.dumps(changes["tags"], ensure_ascii=False))
        if "timeout_ms" in changes and changes["timeout_ms"] is not None:
            assignments.append("timeout_ms = ?")
            values.append(changes["timeout_ms"])
        if "temperature" in changes and changes["temperature"] is not None:
            assignments.append("temperature = ?")
            values.append(changes["temperature"])
        if "max_output_tokens" in changes and changes["max_output_tokens"] is not None:
            assignments.append("max_output_tokens = ?")
            values.append(changes["max_output_tokens"])
        if "is_multimodal" in changes and changes["is_multimodal"] is not None:
            assignments.append("is_multimodal = ?")
            values.append(int(changes["is_multimodal"]))
        if "api_key" in changes and changes["api_key"]:
            api_key = changes["api_key"].strip()
            assignments.append("api_key_ciphertext = ?")
            values.append(self.secrets.encrypt(api_key))
            assignments.append("api_key_mask = ?")
            values.append(mask_api_key(api_key))

        if not assignments:
            return self.get(profile_id)

        assignments.append("updated_at = ?")
        values.append(now_iso())
        values.append(profile_id)
        with self.db.connect() as conn:
            cursor = conn.execute(
                f"""
                UPDATE model_profiles
                SET {", ".join(assignments)}
                WHERE id = ? AND deleted_at IS NULL
                """,
                tuple(values),
            )
        if cursor.rowcount == 0:
            raise KeyError(profile_id)
        return self.get(profile_id)

    def update_test_status(self, profile_id: str, status: str, latency_ms: int | None) -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE model_profiles
                SET last_test_status = ?, last_test_latency_ms = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, latency_ms, now_iso(), profile_id),
            )

    def soft_delete(self, profile_id: str) -> None:
        if self.is_managed(self.get(profile_id)):
            raise PermissionError(profile_id)
        ts = now_iso()
        with self.db.connect() as conn:
            cursor = conn.execute(
                """
                UPDATE model_profiles
                SET enabled = 0, deleted_at = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """,
                (ts, ts, profile_id),
            )
        if cursor.rowcount == 0:
            raise KeyError(profile_id)

    @staticmethod
    def is_managed(row: sqlite3.Row) -> bool:
        try:
            tags = json.loads(row["tags_json"])
        except (TypeError, json.JSONDecodeError):
            return False
        return isinstance(tags, list) and OPENCODE_FREE_TAG in tags


class SessionRepository:
    def __init__(self, db: Database):
        self.db = db
        self.events = SessionEventRepository(db)

    def create(self, payload: SessionCreate) -> sqlite3.Row:
        session_id = new_id("sess")
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (
                  id, grade_band, subject, model_profile_id, problem_text,
                  problem_image_data_url, student_initial_thought, phase, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'diagnosing', ?, ?)
                """,
                (
                    session_id,
                    payload.grade_band,
                    payload.subject,
                    payload.model_profile_id,
                    payload.problem_text.strip(),
                    payload.problem_image_data_url,
                    payload.student_initial_thought.strip(),
                    ts,
                    ts,
                ),
            )
            self.events.append_in_transaction(
                conn,
                session_id,
                [
                    (
                        "session.created",
                        {
                            "model_profile_id": payload.model_profile_id,
                            "grade_band": payload.grade_band,
                            "subject": payload.subject,
                            "state_hint": "diagnosing",
                            "restored_from": None,
                        },
                    )
                ],
            )
        return self.get(session_id)

    def get(self, session_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise KeyError(session_id)
        return row

    def create_run(self, session_id: str) -> sqlite3.Row:
        """Atomically allocate the next per-session attempt in queued state."""
        run_id = new_id("run")
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            exists = conn.execute(
                "SELECT 1 FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if exists is None:
                raise KeyError(session_id)
            attempt = conn.execute(
                "SELECT COALESCE(MAX(attempt), 0) + 1 FROM session_runs WHERE session_id = ?",
                (session_id,),
            ).fetchone()[0]
            conn.execute(
                """
                INSERT INTO session_runs (
                  id, session_id, attempt, status, queued_at, updated_at
                ) VALUES (?, ?, ?, 'queued', ?, ?)
                """,
                (run_id, session_id, attempt, ts, ts),
            )
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM session_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
        if row is None:
            raise KeyError(run_id)
        return row

    def list_runs(self, session_id: str) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_runs
                WHERE session_id = ?
                ORDER BY attempt ASC
                """,
                (session_id,),
            ).fetchall()

    def latest_active_run(self, session_id: str) -> sqlite3.Row | None:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_runs
                WHERE session_id = ? AND status IN ('queued', 'running')
                ORDER BY attempt ASC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()

    def latest_run(self, session_id: str) -> sqlite3.Row | None:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_runs
                WHERE session_id = ?
                ORDER BY attempt DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()

    def mark_run_running(self, run_id: str) -> sqlite3.Row:
        ts = now_iso()
        with self.db.connect() as conn:
            cursor = conn.execute(
                """
                UPDATE session_runs
                SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (ts, ts, run_id),
            )
            row = conn.execute(
                "SELECT * FROM session_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise KeyError(run_id)
            if cursor.rowcount == 0 and row["status"] != "running":
                raise RunStateConflict(run_id, row["status"])
            if cursor.rowcount == 1:
                self.events.append_in_transaction(
                    conn,
                    row["session_id"],
                    [
                        (
                            "run.started",
                            {
                                "run_id": row["id"],
                                "attempt": row["attempt"],
                                "status": "running",
                                "queued_at": row["queued_at"],
                                "started_at": row["started_at"],
                            },
                        )
                    ],
                )
        return self.get_run(run_id)

    def mark_run_completed(self, run_id: str) -> sqlite3.Row:
        return self._finish_run(run_id, "completed", error=None)

    def mark_run_failed(self, run_id: str, error: dict) -> sqlite3.Row:
        return self._finish_run(run_id, "failed", error=error)

    def mark_run_interrupted(self, run_id: str, error: dict) -> sqlite3.Row:
        return self._finish_run(run_id, "interrupted", error=error)

    def _finish_run(self, run_id: str, status: str, *, error: dict | None) -> sqlite3.Row:
        ts = now_iso()
        error_json = json.dumps(error, ensure_ascii=False) if error is not None else None
        with self.db.connect() as conn:
            cursor = conn.execute(
                """
                UPDATE session_runs
                SET status = ?, finished_at = COALESCE(finished_at, ?),
                    updated_at = ?, error_json = ?
                WHERE id = ? AND status IN ('queued', 'running')
                """,
                (status, ts, ts, error_json, run_id),
            )
            row = conn.execute(
                "SELECT * FROM session_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise KeyError(run_id)
            # Terminal transitions are idempotent for cleanup and repeated interrupts.
            if cursor.rowcount == 0 and row["status"] != status:
                return row
            if cursor.rowcount == 1:
                stop_reason = (error or {}).get("code") or "completed"
                event_status = {
                    "completed": "succeeded",
                    "failed": "failed",
                    "interrupted": "cancelled",
                }[status]
                events: list[tuple[str, dict]] = []
                if error is not None:
                    events.append(
                        (
                            "error.occurred",
                            {
                                "run_id": run_id,
                                "code": error.get("code", status),
                                "message": error.get("message", status),
                                "error_type": error.get("type"),
                                "retryable": bool(error.get("retryable", False)),
                            },
                        )
                    )
                events.extend(
                    [
                        (
                            "run.completed",
                            {
                                "run_id": run_id,
                                "status": event_status,
                                "stop_reason": stop_reason,
                                "action_count": max(
                                    0,
                                    int(row["last_committed_action_index"]) + 1,
                                ),
                            },
                        ),
                        ("session.idle", {"run_id": run_id, "reason": stop_reason}),
                    ]
                )
                self.events.append_in_transaction(conn, row["session_id"], events)
        return self.get_run(run_id)

    def recover_orphaned_runs(self) -> list[sqlite3.Row]:
        """Fail work left active by a previous process; provider calls are never resumed."""
        ts = now_iso()
        recovered_ids: list[str] = []
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """
                SELECT id, session_id, status, last_committed_action_index
                FROM session_runs
                WHERE status IN ('queued', 'running')
                ORDER BY queued_at ASC
                """
            ).fetchall()
            for row in rows:
                error = {
                    "code": "process_restarted",
                    "message": "服务进程重启，未完成的生成不会自动恢复，以避免重复调用模型。",
                    "type": "RunRecoveryError",
                    "retryable": True,
                    "previous_status": row["status"],
                }
                conn.execute(
                    """
                    UPDATE session_runs
                    SET status = 'failed', finished_at = ?, updated_at = ?, error_json = ?
                    WHERE id = ? AND status IN ('queued', 'running')
                    """,
                    (ts, ts, json.dumps(error, ensure_ascii=False), row["id"]),
                )
                self.events.append_in_transaction(
                    conn,
                    row["session_id"],
                    [
                        (
                            "error.occurred",
                            {
                                "run_id": row["id"],
                                "code": error["code"],
                                "message": error["message"],
                                "error_type": error["type"],
                                "retryable": error["retryable"],
                            },
                        ),
                        (
                            "run.completed",
                            {
                                "run_id": row["id"],
                                "status": "failed",
                                "stop_reason": error["code"],
                                "action_count": max(
                                    0,
                                    int(row["last_committed_action_index"]) + 1,
                                ),
                            },
                        ),
                        (
                            "session.idle",
                            {"run_id": row["id"], "reason": error["code"]},
                        ),
                    ],
                )
                recovered_ids.append(row["id"])
        return [self.get_run(run_id) for run_id in recovered_ids]

    def delete(self, session_id: str) -> None:
        """Delete a session using database-level child/card deletion semantics."""
        with self.db.connect() as conn:
            cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            if cursor.rowcount == 0:
                raise KeyError(session_id)

    def delete_all_sessions(self) -> None:
        """Delete sessions; database constraints preserve only archived global cards."""
        with self.db.connect() as conn:
            conn.execute("DELETE FROM sessions")

    def update_phase(
        self,
        session_id: str,
        phase: str,
        breakpoint_description: str | None,
        breakpoint_confidence: float | None,
    ) -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE sessions
                SET phase = ?, breakpoint_description = ?, breakpoint_confidence = ?, updated_at = ?
                WHERE id = ?
                """,
                (phase, breakpoint_description, breakpoint_confidence, now_iso(), session_id),
            )

    def record_tutor_action(
        self,
        session_id: str,
        turn: TutorTurn,
        *,
        action_index: int,
        run_id: str | None = None,
    ) -> tuple[sqlite3.Row, sqlite3.Row | None, sqlite3.Row | None]:
        """Atomically save session state, assistant action, checkpoint, and pending card."""
        message_id = new_id("msg")
        action_id = new_id("act")
        checkpoint_id = new_id("chk") if turn.checkpoint else None
        card_content = turn.knowledge_card or turn.problem_card
        card_id = new_id("card") if card_content else None
        ts = now_iso()
        metadata = {
            "state_hint": turn.state_hint,
            "action": turn.action,
            "wait_for_student": turn.wait_for_student,
            "breakpoint": turn.breakpoint_description,
            "action_index": action_index,
            "checkpoint_id": checkpoint_id,
            "checkpoint": turn.checkpoint.model_dump() if turn.checkpoint else None,
            "card_id": card_id,
            "knowledge_card": turn.knowledge_card.model_dump() if turn.knowledge_card else None,
            "problem_card": turn.problem_card.model_dump() if turn.problem_card else None,
        }

        with self.db.connect() as conn:
            # Serialize explicit interruption against the complete action commit.
            # Whichever obtains the write lock first wins: an already committed full
            # action is preserved; an interrupted run cannot commit a partial step.
            if run_id is not None:
                guard = conn.execute(
                    """
                    UPDATE session_runs
                    SET updated_at = updated_at
                    WHERE id = ? AND session_id = ? AND status = 'running'
                    """,
                    (run_id, session_id),
                )
                run_row = conn.execute(
                    "SELECT status, session_id FROM session_runs WHERE id = ?",
                    (run_id,),
                ).fetchone()
                if run_row is None:
                    raise KeyError(run_id)
                if run_row["session_id"] != session_id:
                    raise PermissionError(run_id)
                if guard.rowcount == 0 or run_row["status"] != "running":
                    raise RunStateConflict(run_id, run_row["status"])
            cursor = conn.execute(
                """
                UPDATE sessions
                SET phase = ?, breakpoint_description = ?,
                    breakpoint_confidence = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    turn.state_hint,
                    turn.breakpoint_description,
                    turn.breakpoint_confidence,
                    ts,
                    session_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(session_id)

            conn.execute(
                """
                INSERT INTO messages (
                  id, session_id, role, content, action_id, action,
                  in_reply_to_action_id, metadata_json, created_at
                ) VALUES (?, ?, 'assistant', ?, ?, ?, NULL, ?, ?)
                """,
                (
                    message_id,
                    session_id,
                    turn.message,
                    action_id,
                    turn.action,
                    json.dumps(metadata, ensure_ascii=False),
                    ts,
                ),
            )

            checkpoint_row = None
            if turn.checkpoint and checkpoint_id:
                correct = [option for option in turn.checkpoint.options if option.is_correct]
                conn.execute(
                    """
                    INSERT INTO checkpoints (
                      id, session_id, question, options_json, correct_option_id,
                      tested_point, source_action_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        checkpoint_id,
                        session_id,
                        turn.checkpoint.question,
                        turn.checkpoint.model_dump_json(),
                        correct[0].id,
                        turn.checkpoint.tested_point,
                        action_id,
                        ts,
                    ),
                )
                checkpoint_row = conn.execute(
                    "SELECT * FROM checkpoints WHERE id = ?",
                    (checkpoint_id,),
                ).fetchone()

            card_row = None
            if card_content and card_id:
                conn.execute(
                    """
                    INSERT INTO study_cards (
                      id, session_id, live_session_id, card_type, title, content_json,
                      source_action_id, source_message_id, created_at, saved_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        card_id,
                        session_id,
                        session_id,
                        card_content.type,
                        card_content.title,
                        card_content.model_dump_json(),
                        action_id,
                        message_id,
                        ts,
                    ),
                )
                card_row = conn.execute(
                    "SELECT * FROM study_cards WHERE id = ?",
                    (card_id,),
                ).fetchone()

            assistant_row = conn.execute(
                "SELECT * FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()
            if run_id is not None:
                conn.execute(
                    """
                    UPDATE session_runs
                    SET last_committed_action_index = ?, updated_at = ?
                    WHERE id = ? AND status = 'running'
                    """,
                    (action_index, ts, run_id),
                )

            durable_events: list[tuple[str, dict]] = [
                (
                    "message.completed",
                    {
                        "run_id": run_id,
                        "message_id": message_id,
                        "role": "assistant",
                        "content": turn.message,
                        "action_id": action_id,
                        "action": turn.action,
                        "in_reply_to_action_id": None,
                    },
                ),
                (
                    "action.completed",
                    {
                        "run_id": run_id,
                        "action_index": action_index,
                        "action_id": action_id,
                        "message_id": message_id,
                        "action": turn.action,
                        "state_hint": turn.state_hint,
                        "wait_for_student": turn.wait_for_student,
                        "message": turn.message,
                        "breakpoint": turn.breakpoint_description,
                        "confidence": turn.breakpoint_confidence,
                        "checkpoint_id": checkpoint_id,
                        "card_id": card_id,
                    },
                ),
            ]
            if turn.checkpoint and checkpoint_id:
                checkpoint_data = turn.checkpoint.model_dump()
                for option in checkpoint_data["options"]:
                    option.pop("is_correct", None)
                    option.pop("misconception", None)
                durable_events.append(
                    (
                        "checkpoint.ready",
                        {
                            "run_id": run_id,
                            "checkpoint_id": checkpoint_id,
                            "source_action_id": action_id,
                            "checkpoint": checkpoint_data,
                        },
                    )
                )
            if card_content and card_id:
                durable_events.append(
                    (
                        "card.ready",
                        {
                            "run_id": run_id,
                            "card_id": card_id,
                            "card_type": card_content.type,
                            "source_action_id": action_id,
                            "source_message_id": message_id,
                            "content": card_content.model_dump(),
                        },
                    )
                )
            self.events.append_in_transaction(conn, session_id, durable_events)

        return assistant_row, checkpoint_row, card_row

    def get_card(self, card_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
        if row is None:
            raise KeyError(card_id)
        return row

    def list_cards(
        self,
        session_id: str | None = None,
        *,
        include_pending: bool = False,
    ) -> list[sqlite3.Row]:
        clauses: list[str] = []
        params: list[str] = []
        if session_id is not None:
            clauses.append("live_session_id = ?")
            params.append(session_id)
        if not include_pending:
            clauses.append("saved_at IS NOT NULL")
        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.db.connect() as conn:
            return conn.execute(
                f"""
                SELECT * FROM study_cards
                {where_clause}
                ORDER BY created_at DESC, rowid DESC
                """,
                params,
            ).fetchall()

    def latest_pending_card(self, session_id: str) -> sqlite3.Row | None:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM study_cards
                WHERE session_id = ? AND saved_at IS NULL
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()

    def save_card(self, card_id: str, *, session_id: str) -> sqlite3.Row:
        ts = now_iso()
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
            if row is None:
                raise KeyError(card_id)
            if row["live_session_id"] != session_id:
                raise PermissionError(card_id)
            if row["saved_at"] is None:
                conn.execute(
                    "UPDATE study_cards SET saved_at = ? WHERE id = ?",
                    (ts, card_id),
                )
                conn.execute(
                    "UPDATE sessions SET updated_at = ? WHERE id = ?",
                    (ts, session_id),
                )
                self.events.append_in_transaction(
                    conn,
                    session_id,
                    [
                        (
                            "card.saved",
                            {
                                "card_id": card_id,
                                "card_type": row["card_type"],
                                "source_action_id": row["source_action_id"],
                                "source_message_id": row["source_message_id"],
                                "saved_at": ts,
                            },
                        )
                    ],
                )
            return conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()

    def delete_card(self, card_id: str) -> None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT saved_at FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
            if row is None:
                raise KeyError(card_id)
            if row["saved_at"] is None:
                raise PermissionError(card_id)
            conn.execute("DELETE FROM study_cards WHERE id = ?", (card_id,))

    def delete_all_cards(self) -> None:
        """Delete saved and pending study cards without deleting sessions."""
        with self.db.connect() as conn:
            conn.execute("DELETE FROM study_cards")

    def list_messages(self, session_id: str, limit: int | None = None) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            if limit is None:
                return conn.execute(
                    """
                    SELECT m.*, si.idempotency_key AS client_message_id
                    FROM messages m
                    LEFT JOIN session_inputs si
                      ON si.message_id = m.id AND si.kind = 'STUDENT_MESSAGE'
                    WHERE m.session_id = ?
                    ORDER BY m.created_at ASC, m.rowid ASC
                    """,
                    (session_id,),
                ).fetchall()
            rows = conn.execute(
                """
                SELECT m.*, si.idempotency_key AS client_message_id
                FROM messages m
                LEFT JOIN session_inputs si
                  ON si.message_id = m.id AND si.kind = 'STUDENT_MESSAGE'
                WHERE m.session_id = ?
                ORDER BY m.created_at DESC, m.rowid DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
        return list(reversed(rows))

    def list_inputs(self, session_id: str) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_inputs
                WHERE session_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (session_id,),
            ).fetchall()

    def latest_blocking_action_id(self, session_id: str) -> str | None:
        with self.db.connect() as conn:
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

    def create_checkpoint(
        self,
        session_id: str,
        checkpoint: TutorCheckpoint,
        *,
        source_action_id: str,
    ) -> sqlite3.Row:
        correct = [opt for opt in checkpoint.options if opt.is_correct]
        checkpoint_id = new_id("chk")
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO checkpoints (
                  id, session_id, question, options_json, correct_option_id,
                  tested_point, source_action_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    checkpoint_id,
                    session_id,
                    checkpoint.question,
                    checkpoint.model_dump_json(),
                    correct[0].id,
                    checkpoint.tested_point,
                    source_action_id,
                    now_iso(),
                ),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (now_iso(), session_id),
            )
        return self.get_checkpoint(checkpoint_id)

    def get_checkpoint(self, checkpoint_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM checkpoints WHERE id = ?", (checkpoint_id,)).fetchone()
        if row is None:
            raise KeyError(checkpoint_id)
        return row

    def list_checkpoints(self, session_id: str) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM checkpoints
                WHERE session_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (session_id,),
            ).fetchall()

    def list_history(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT s.*,
                       CASE
                         WHEN mp.id IS NULL THEN '已删除的模型'
                         ELSE mp.display_name || ' · ' || mp.model
                       END AS model_display_name,
                       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
                       (SELECT COUNT(*) FROM checkpoints c WHERE c.session_id = s.id) AS checkpoint_count
                FROM sessions s
                LEFT JOIN model_profiles mp ON mp.id = s.model_profile_id
                ORDER BY s.updated_at DESC
                """
            ).fetchall()

    def restore(self, source_session_id: str, model_profile_id: str) -> sqlite3.Row:
        """Copy one SQLite session into a new resumable session."""
        source = self.get(source_session_id)
        messages = self.list_messages(source_session_id)
        inputs = self.list_inputs(source_session_id)
        checkpoints = self.list_checkpoints(source_session_id)
        cards = [
            card
            for card in self.list_cards(source_session_id, include_pending=True)
            if card["saved_at"] is None
        ]
        new_session_id = new_id("sess")
        ts = now_iso()
        action_ids = {
            message["action_id"]
            for message in messages
            if message["action_id"]
        }
        action_map = {action_id: new_id("act") for action_id in action_ids}
        checkpoint_map = {checkpoint["id"]: new_id("chk") for checkpoint in checkpoints}
        message_map = {message["id"]: new_id("msg") for message in messages}
        card_map = {card["id"]: new_id("card") for card in cards}

        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (
                  id, grade_band, subject, model_profile_id, problem_text,
                  problem_image_data_url, student_initial_thought, phase,
                  breakpoint_description, breakpoint_confidence, restored_from,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_session_id,
                    source["grade_band"],
                    source["subject"],
                    model_profile_id,
                    source["problem_text"],
                    source["problem_image_data_url"],
                    source["student_initial_thought"],
                    source["phase"],
                    source["breakpoint_description"],
                    source["breakpoint_confidence"],
                    source["id"],
                    ts,
                    ts,
                ),
            )

            for checkpoint in checkpoints:
                conn.execute(
                    """
                    INSERT INTO checkpoints (
                      id, session_id, question, options_json, correct_option_id,
                      tested_point, source_action_id, selected_option_id,
                      is_correct, elapsed_ms, created_at, answered_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        checkpoint_map[checkpoint["id"]],
                        new_session_id,
                        checkpoint["question"],
                        checkpoint["options_json"],
                        checkpoint["correct_option_id"],
                        checkpoint["tested_point"],
                        action_map.get(checkpoint["source_action_id"], checkpoint["source_action_id"]),
                        checkpoint["selected_option_id"],
                        checkpoint["is_correct"],
                        checkpoint["elapsed_ms"],
                        checkpoint["created_at"],
                        checkpoint["answered_at"],
                    ),
                )

            for message in messages:
                try:
                    metadata = json.loads(message["metadata_json"] or "{}")
                except json.JSONDecodeError:
                    metadata = {}
                if metadata.get("checkpoint_id") in checkpoint_map:
                    metadata["checkpoint_id"] = checkpoint_map[metadata["checkpoint_id"]]
                if metadata.get("card_id") in card_map:
                    metadata["card_id"] = card_map[metadata["card_id"]]
                elif metadata.get("card_id"):
                    # A card deleted from the library still remains as structured
                    # teaching history, but its old database id must not leak into
                    # the restored branch.
                    metadata["card_id"] = None
                result = metadata.get("checkpoint_result") or metadata.get("checkpoint_answer")
                if isinstance(result, dict) and result.get("checkpoint_id") in checkpoint_map:
                    result["checkpoint_id"] = checkpoint_map[result["checkpoint_id"]]
                conn.execute(
                    """
                    INSERT INTO messages (
                      id, session_id, role, content, action_id, action,
                      in_reply_to_action_id, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        message_map[message["id"]],
                        new_session_id,
                        message["role"],
                        message["content"],
                        action_map.get(message["action_id"], new_id("act")),
                        message["action"],
                        action_map.get(message["in_reply_to_action_id"], message["in_reply_to_action_id"]),
                        json.dumps(metadata, ensure_ascii=False),
                        message["created_at"],
                    ),
                )

            # Preserve ordinary-message idempotency in the explicit restored
            # branch. Checkpoint inputs are lazily backfilled from their copied
            # CHECKPOINT_RESPONSE message if an old answer is retried.
            for input_row in inputs:
                if input_row["kind"] != "STUDENT_MESSAGE":
                    continue
                if input_row["message_id"] not in message_map:
                    continue
                try:
                    result = json.loads(input_row["result_json"] or "{}")
                except json.JSONDecodeError:
                    result = {}
                if result.get("message_id") in message_map:
                    result["message_id"] = message_map[result["message_id"]]
                if result.get("action_id") in action_map:
                    result["action_id"] = action_map[result["action_id"]]
                if result.get("in_reply_to_action_id") in action_map:
                    result["in_reply_to_action_id"] = action_map[result["in_reply_to_action_id"]]
                conn.execute(
                    """
                    INSERT INTO session_inputs (
                      id, session_id, kind, idempotency_key, payload_json,
                      result_json, message_id, checkpoint_id, card_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
                    """,
                    (
                        new_id("inp"),
                        new_session_id,
                        input_row["kind"],
                        input_row["idempotency_key"],
                        input_row["payload_json"],
                        json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                        message_map[input_row["message_id"]],
                        input_row["created_at"],
                    ),
                )

            for card in cards:
                conn.execute(
                    """
                    INSERT INTO study_cards (
                      id, session_id, live_session_id, card_type, title, content_json,
                      source_action_id, source_message_id, created_at, saved_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        card_map[card["id"]],
                        new_session_id,
                        new_session_id,
                        card["card_type"],
                        card["title"],
                        card["content_json"],
                        action_map.get(card["source_action_id"], card["source_action_id"]),
                        message_map.get(card["source_message_id"], card["source_message_id"]),
                        card["created_at"],
                        card["saved_at"],
                    ),
                )

            self.events.append_in_transaction(
                conn,
                new_session_id,
                [
                    (
                        "session.created",
                        {
                            "model_profile_id": model_profile_id,
                            "grade_band": source["grade_band"],
                            "subject": source["subject"],
                            "state_hint": source["phase"],
                            "restored_from": source["id"],
                            "baseline_message_count": len(messages),
                            "baseline_checkpoint_count": len(checkpoints),
                            "baseline_pending_card_count": len(cards),
                        },
                    )
                ],
            )

        return self.get(new_session_id)
