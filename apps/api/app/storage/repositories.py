from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from app.core.schemas import ModelProfileCreate, ModelProfileUpdate, SessionCreate, TutorCheckpoint
from app.storage.database import Database
from app.storage.security import SecretBox, mask_api_key


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def host_from_url(value: str) -> str:
    return urlparse(value).netloc or value


class ModelProfileRepository:
    def __init__(self, db: Database, secrets: SecretBox):
        self.db = db
        self.secrets = secrets

    def create(self, payload: ModelProfileCreate) -> sqlite3.Row:
        profile_id = new_id("prof")
        api_key = payload.api_key.strip()
        ts = now_iso()
        with self.db.connect() as conn:
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
        return self.get(profile_id)

    def list_public(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM model_profiles
                WHERE deleted_at IS NULL AND enabled = 1
                ORDER BY created_at DESC
                """
            ).fetchall()

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


class SessionRepository:
    def __init__(self, db: Database):
        self.db = db

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
        return self.get(session_id)

    def get(self, session_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise KeyError(session_id)
        return row

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

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        *,
        action: str,
        action_id: str | None = None,
        in_reply_to_action_id: str | None = None,
        metadata: dict | None = None,
    ) -> sqlite3.Row:
        message_id = new_id("msg")
        action_id = action_id or new_id("act")
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (
                  id, session_id, role, content, action_id, action,
                  in_reply_to_action_id, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    session_id,
                    role,
                    content,
                    action_id,
                    action,
                    in_reply_to_action_id,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    now_iso(),
                ),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (now_iso(), session_id),
            )
        with self.db.connect() as conn:
            return conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()

    def list_messages(self, session_id: str, limit: int | None = None) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            if limit is None:
                return conn.execute(
                    """
                    SELECT * FROM messages
                    WHERE session_id = ?
                    ORDER BY created_at ASC, rowid ASC
                    """,
                    (session_id,),
                ).fetchall()
            rows = conn.execute(
                """
                SELECT * FROM messages
                WHERE session_id = ?
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
        return list(reversed(rows))

    def latest_blocking_action_id(self, session_id: str) -> str | None:
        with self.db.connect() as conn:
            row = conn.execute(
                """
                SELECT action_id FROM messages
                WHERE session_id = ? AND role = 'assistant'
                  AND action IN ('ASK_OPEN_QUESTION', 'SHOW_CHECKPOINT_MC')
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

    def record_checkpoint_response(
        self,
        checkpoint_id: str,
        selected_option_id: str,
        elapsed_ms: int,
        *,
        session_id: str,
        student_message: str,
        checkpoint_result: dict,
        next_state_hint: str,
    ) -> tuple[sqlite3.Row, bool, sqlite3.Row]:
        """Atomically save the student's checkpoint result and conversation message."""
        message_id = new_id("msg")
        action_id = new_id("act")
        ts = now_iso()
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM checkpoints WHERE id = ?",
                (checkpoint_id,),
            ).fetchone()
            if row is None:
                raise KeyError(checkpoint_id)
            if row["session_id"] != session_id:
                raise PermissionError(checkpoint_id)
            if row["answered_at"] is not None:
                raise FileExistsError(checkpoint_id)

            is_correct = selected_option_id == row["correct_option_id"]
            conn.execute(
                """
                UPDATE checkpoints
                SET selected_option_id = ?, is_correct = ?, elapsed_ms = ?, answered_at = ?
                WHERE id = ?
                """,
                (selected_option_id, int(is_correct), elapsed_ms, ts, checkpoint_id),
            )
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
                    row["source_action_id"],
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
            updated = conn.execute(
                "SELECT * FROM checkpoints WHERE id = ?",
                (checkpoint_id,),
            ).fetchone()
            student_row = conn.execute(
                "SELECT * FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()
        return updated, is_correct, student_row

    def list_history(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT s.*,
                       COALESCE(mp.display_name, '已删除的模型') AS model_display_name,
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
        checkpoints = self.list_checkpoints(source_session_id)
        new_session_id = new_id("sess")
        ts = now_iso()
        action_ids = {
            message["action_id"]
            for message in messages
            if message["action_id"]
        }
        action_map = {action_id: new_id("act") for action_id in action_ids}
        checkpoint_map = {checkpoint["id"]: new_id("chk") for checkpoint in checkpoints}

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
                        new_id("msg"),
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

        return self.get(new_session_id)
