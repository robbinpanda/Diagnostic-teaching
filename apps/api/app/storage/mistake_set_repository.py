from __future__ import annotations

import sqlite3

from app.storage.database import with_sqlite_busy_retry
from app.storage.repository_utils import new_id, now_iso


class DuplicateMistakeSetSessionError(ValueError):
    pass


class MistakeSetSourceNotFoundError(LookupError):
    pass


def normalize_mistake_set_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise ValueError("错题集名称不能为空")
    if len(normalized) > 80:
        raise ValueError("错题集名称不能超过 80 个字符")
    return normalized


def _list_items(conn: sqlite3.Connection, mistake_set_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT * FROM mistake_set_items
        WHERE mistake_set_id = ?
        ORDER BY position ASC
        """,
        (mistake_set_id,),
    ).fetchall()


class MistakeSetRepositoryMixin:
    def list_mistake_sets(self) -> list[tuple[sqlite3.Row, list[sqlite3.Row]]]:
        with self.db.connect() as conn:
            sets = conn.execute(
                """
                SELECT * FROM mistake_sets
                ORDER BY updated_at DESC, created_at DESC, rowid DESC
                """
            ).fetchall()
            return [(row, _list_items(conn, row["id"])) for row in sets]

    def get_mistake_set(self, mistake_set_id: str) -> tuple[sqlite3.Row, list[sqlite3.Row]]:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM mistake_sets WHERE id = ?",
                (mistake_set_id,),
            ).fetchone()
            if row is None:
                raise KeyError(mistake_set_id)
            return row, _list_items(conn, mistake_set_id)

    @with_sqlite_busy_retry
    def create_mistake_set(
        self,
        name: str,
        session_ids: list[str],
    ) -> tuple[sqlite3.Row, list[sqlite3.Row]]:
        normalized_name = normalize_mistake_set_name(name)
        if not session_ids:
            raise ValueError("请至少选择一道题目")
        if len(set(session_ids)) != len(session_ids):
            raise DuplicateMistakeSetSessionError

        mistake_set_id = new_id("mistake_set")
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            sources: list[sqlite3.Row] = []
            for session_id in session_ids:
                source = conn.execute(
                    """
                    SELECT s.*,
                           p.name AS paper_name,
                           (SELECT m.content FROM messages m
                            WHERE m.session_id = s.id AND m.role = 'student'
                            ORDER BY m.created_at ASC, m.rowid ASC LIMIT 1)
                             AS first_student_message
                    FROM sessions s
                    LEFT JOIN exam_papers p ON p.id = s.paper_id
                    WHERE s.id = ?
                    """,
                    (session_id,),
                ).fetchone()
                if source is None:
                    raise MistakeSetSourceNotFoundError(session_id)
                sources.append(source)

            conn.execute(
                """
                INSERT INTO mistake_sets (id, name, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (mistake_set_id, normalized_name, ts, ts),
            )
            for position, source in enumerate(sources):
                problem_text = source["problem_text"].strip()
                title = (
                    problem_text
                    or (source["first_student_message"] or "").strip()
                    or "未命名题目"
                ).replace("\n", " ")
                conn.execute(
                    """
                    INSERT INTO mistake_set_items (
                      id, mistake_set_id, source_session_id, source_paper_name,
                      title, problem_text, problem_image_data_url, position, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id("mistake_item"),
                        mistake_set_id,
                        source["id"],
                        source["paper_name"],
                        title,
                        problem_text,
                        source["problem_image_data_url"],
                        position,
                        ts,
                    ),
                )

            row = conn.execute(
                "SELECT * FROM mistake_sets WHERE id = ?",
                (mistake_set_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("mistake set insert returned no row")
            return row, _list_items(conn, mistake_set_id)
