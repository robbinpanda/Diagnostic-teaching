from __future__ import annotations

import sqlite3

from app.storage.repository_utils import new_id, now_iso


class ExamPaperRepositoryMixin:
    def list_exam_papers(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT p.*, COUNT(s.id) AS session_count
                FROM exam_papers p
                LEFT JOIN sessions s ON s.paper_id = p.id
                GROUP BY p.id
                ORDER BY p.updated_at DESC, p.name COLLATE NOCASE ASC
                """
            ).fetchall()

    def get_exam_paper(self, paper_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM exam_papers WHERE id = ?", (paper_id,)).fetchone()
        if row is None:
            raise KeyError(paper_id)
        return row

    def create_exam_paper(self, name: str) -> sqlite3.Row:
        normalized = name.strip()
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                "SELECT * FROM exam_papers WHERE name = ? COLLATE NOCASE",
                (normalized,),
            ).fetchone()
            if existing is None:
                paper_id = new_id("paper")
                conn.execute(
                    "INSERT INTO exam_papers (id, name, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?)",
                    (paper_id, normalized, ts, ts),
                )
            else:
                paper_id = existing["id"]
            paper = conn.execute(
                """
                SELECT p.*, COUNT(s.id) AS session_count
                FROM exam_papers p
                LEFT JOIN sessions s ON s.paper_id = p.id
                WHERE p.id = ?
                GROUP BY p.id
                """,
                (paper_id,),
            ).fetchone()
            if paper is None:
                raise KeyError(paper_id)
            return paper
