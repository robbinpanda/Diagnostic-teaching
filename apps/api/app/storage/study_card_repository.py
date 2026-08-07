from __future__ import annotations

import json
import sqlite3

from app.storage.card_folder_repository import resolve_card_folder
from app.storage.database import with_sqlite_busy_retry
from app.storage.repository_utils import new_id, now_iso


class CardDeleteConflictError(RuntimeError):
    """A durable run still owns card-producing session work."""


class StudyCardRepositoryMixin:
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

    def list_pending_cards(self, session_id: str) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM study_cards
                WHERE session_id = ? AND saved_at IS NULL
                ORDER BY created_at ASC, rowid ASC
                """,
                (session_id,),
            ).fetchall()

    def save_card(
        self,
        card_id: str,
        *,
        session_id: str,
        folder_id: str | None = None,
    ) -> sqlite3.Row:
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
            resolved_folder_id = resolve_card_folder(
                conn,
                folder_id,
                row["card_type"],
                preferred_folder_id=row["folder_id"],
            )
            if row["saved_at"] is None:
                conn.execute(
                    "UPDATE study_cards SET saved_at = ?, folder_id = ? WHERE id = ?",
                    (ts, resolved_folder_id, card_id),
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
                                "folder_id": resolved_folder_id,
                            },
                        )
                    ],
                )
            return conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()

    def move_card(self, card_id: str, *, folder_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?", (card_id,)
            ).fetchone()
            if row is None:
                raise KeyError(card_id)
            if row["saved_at"] is None:
                raise PermissionError(card_id)
            resolved_folder_id = resolve_card_folder(conn, folder_id, row["card_type"])
            conn.execute(
                "UPDATE study_cards SET folder_id = ? WHERE id = ?",
                (resolved_folder_id, card_id),
            )
            return conn.execute(
                "SELECT * FROM study_cards WHERE id = ?", (card_id,)
            ).fetchone()

    def copy_card(self, card_id: str, *, folder_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?", (card_id,)
            ).fetchone()
            if row is None:
                raise KeyError(card_id)
            if row["saved_at"] is None:
                raise PermissionError(card_id)
            resolved_folder_id = resolve_card_folder(conn, folder_id, row["card_type"])
            copied_card_id = new_id("card")
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO study_cards (
                  id, session_id, live_session_id, card_type, title, content_json,
                  source_action_id, source_message_id, created_at, saved_at, folder_id
                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    copied_card_id,
                    row["session_id"],
                    row["card_type"],
                    row["title"],
                    row["content_json"],
                    row["source_action_id"],
                    row["source_message_id"],
                    ts,
                    ts,
                    resolved_folder_id,
                ),
            )
            return conn.execute(
                "SELECT * FROM study_cards WHERE id = ?", (copied_card_id,)
            ).fetchone()

    def update_saved_knowledge_card(self, card_id: str, *, content: dict) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
            if row is None:
                raise KeyError(card_id)
            if row["saved_at"] is None:
                raise PermissionError(card_id)
            if row["card_type"] != "knowledge_card":
                raise ValueError(card_id)
            conn.execute(
                "UPDATE study_cards SET title = ?, content_json = ? WHERE id = ?",
                (
                    content["title"],
                    json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    card_id,
                ),
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

    @with_sqlite_busy_retry
    def delete_all_cards(self) -> None:
        """Atomically delete cards only while no durable run is active."""

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            active_run = conn.execute(
                """
                SELECT 1 FROM session_runs
                WHERE status IN ('queued', 'running')
                LIMIT 1
                """
            ).fetchone()
            if active_run is not None:
                raise CardDeleteConflictError("all")
            conn.execute("DELETE FROM study_cards")
