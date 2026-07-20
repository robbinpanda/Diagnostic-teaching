from __future__ import annotations

import sqlite3

from app.core.schemas import SessionCreate, TutorTurn
from app.storage.database import Database
from app.storage.model_profiles import ModelProfileRepository
from app.storage.repository_utils import (
    host_from_url,
    initial_context_status,
    new_id,
    normalize_base_url,
    now_iso,
)
from app.storage.run_state import RunStateConflict
from app.storage.session_events import SessionEventRepository
from app.storage.session_history_repository import SessionHistoryRepositoryMixin
from app.storage.session_run_repository import SessionRunRepositoryMixin
from app.storage.study_card_repository import StudyCardRepositoryMixin
from app.storage.tutor_actions import record_tutor_action as persist_tutor_action

__all__ = [
    "ModelProfileRepository",
    "RunStateConflict",
    "SessionRepository",
    "host_from_url",
    "initial_context_status",
    "new_id",
    "normalize_base_url",
    "now_iso",
]


class SessionRepository(
    SessionRunRepositoryMixin,
    StudyCardRepositoryMixin,
    SessionHistoryRepositoryMixin,
):
    def __init__(self, db: Database):
        self.db = db
        self.events = SessionEventRepository(db)

    def create(self, payload: SessionCreate) -> sqlite3.Row:
        session_id = new_id("sess")
        ts = now_iso()
        context_status = initial_context_status(
            payload.problem_text,
            payload.student_initial_thought,
        )
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (
                  id, grade_band, subject, model_profile_id, problem_text,
                  problem_image_data_url, student_initial_thought, phase,
                  context_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'diagnosing', ?, ?, ?)
                """,
                (
                    session_id,
                    payload.grade_band,
                    payload.subject,
                    payload.model_profile_id,
                    payload.problem_text.strip(),
                    payload.problem_image_data_url,
                    payload.student_initial_thought.strip(),
                    context_status,
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
                            "context_status": context_status,
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
        return persist_tutor_action(
            self.db,
            self.events,
            session_id,
            turn,
            action_index=action_index,
            run_id=run_id,
        )
