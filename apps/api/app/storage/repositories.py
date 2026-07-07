from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from app.core.schemas import ModelProfileCreate, SessionCreate, TutorCheckpoint
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
                  max_output_tokens, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
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
                  student_initial_thought, phase, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'diagnosing', ?, ?)
                """,
                (
                    session_id,
                    payload.grade_band,
                    payload.subject,
                    payload.model_profile_id,
                    payload.problem_text.strip(),
                    payload.student_initial_thought.strip(),
                    ts,
                    ts,
                ),
            )
            if payload.student_initial_thought.strip():
                conn.execute(
                    """
                    INSERT INTO messages (id, session_id, role, content, metadata_json, created_at)
                    VALUES (?, ?, 'student', ?, '{}', ?)
                    """,
                    (new_id("msg"), session_id, payload.student_initial_thought.strip(), ts),
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
        metadata: dict | None = None,
    ) -> sqlite3.Row:
        message_id = new_id("msg")
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, content, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    session_id,
                    role,
                    content,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    now_iso(),
                ),
            )
        with self.db.connect() as conn:
            return conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()

    def list_messages(self, session_id: str, limit: int = 20) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM messages
                WHERE session_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
        return list(reversed(rows))

    def create_checkpoint(self, session_id: str, checkpoint: TutorCheckpoint) -> sqlite3.Row:
        correct = [opt for opt in checkpoint.options if opt.is_correct]
        checkpoint_id = new_id("chk")
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO checkpoints (
                  id, session_id, question, options_json, correct_option_id,
                  tested_point, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    checkpoint_id,
                    session_id,
                    checkpoint.question,
                    checkpoint.model_dump_json(),
                    correct[0].id,
                    checkpoint.tested_point,
                    now_iso(),
                ),
            )
        return self.get_checkpoint(checkpoint_id)

    def get_checkpoint(self, checkpoint_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM checkpoints WHERE id = ?", (checkpoint_id,)).fetchone()
        if row is None:
            raise KeyError(checkpoint_id)
        return row

    def answer_checkpoint(
        self,
        checkpoint_id: str,
        selected_option_id: str,
        elapsed_ms: int,
    ) -> tuple[sqlite3.Row, bool]:
        row = self.get_checkpoint(checkpoint_id)
        is_correct = selected_option_id == row["correct_option_id"]
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE checkpoints
                SET selected_option_id = ?, is_correct = ?, elapsed_ms = ?, answered_at = ?
                WHERE id = ?
                """,
                (selected_option_id, int(is_correct), elapsed_ms, now_iso(), checkpoint_id),
            )
        return self.get_checkpoint(checkpoint_id), is_correct
