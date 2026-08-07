from __future__ import annotations

from app.storage.database import with_sqlite_busy_retry

MISSING_SESSION_PAPER_DETAIL = "所选试卷已不存在，请重新选择"


class SessionDeleteConflictError(RuntimeError):
    """A queued or running durable run still owns the session lifecycle."""


class SessionDeletionRepositoryMixin:
    @with_sqlite_busy_retry
    def delete(self, session_id: str) -> None:
        """Delete one idle session and prune its now-empty paper atomically."""

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            session = conn.execute(
                "SELECT paper_id FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if session is None:
                raise KeyError(session_id)
            active_run = conn.execute(
                """
                SELECT 1 FROM session_runs
                WHERE session_id = ? AND status IN ('queued', 'running')
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
            if active_run is not None:
                raise SessionDeleteConflictError(session_id)

            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            paper_id = session["paper_id"]
            if paper_id is not None:
                conn.execute(
                    """
                    DELETE FROM exam_papers
                    WHERE id = ?
                      AND NOT EXISTS (
                        SELECT 1 FROM sessions WHERE paper_id = ?
                      )
                    """,
                    (paper_id, paper_id),
                )

    @with_sqlite_busy_retry
    def delete_all_sessions(self) -> None:
        """Delete every idle session and paper in one authoritative transaction."""

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
                raise SessionDeleteConflictError("all")
            conn.execute("DELETE FROM sessions")
            conn.execute("DELETE FROM exam_papers")
