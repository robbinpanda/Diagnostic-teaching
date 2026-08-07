from __future__ import annotations

import json
import sqlite3

from app.storage.database import with_sqlite_busy_retry
from app.storage.repository_utils import new_id, now_iso


class DuplicateMistakeSetCardError(ValueError):
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
        card_ids: list[str],
    ) -> tuple[sqlite3.Row, list[sqlite3.Row]]:
        normalized_name = normalize_mistake_set_name(name)
        if not card_ids:
            raise ValueError("请至少选择一道题目")
        if len(set(card_ids)) != len(card_ids):
            raise DuplicateMistakeSetCardError

        mistake_set_id = new_id("mistake_set")
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            sources: list[tuple[sqlite3.Row, dict]] = []
            for card_id in card_ids:
                source = conn.execute(
                    """
                    SELECT c.id AS card_id, c.live_session_id, c.title AS card_title,
                           c.content_json AS problem_card_json,
                           f.name AS folder_name, f.managed_kind,
                           s.problem_image_data_url
                    FROM study_cards c
                    LEFT JOIN card_folders f ON f.id = c.folder_id
                    LEFT JOIN sessions s ON s.id = c.live_session_id
                    WHERE c.id = ?
                      AND c.card_type = 'problem_card'
                      AND c.saved_at IS NOT NULL
                    """,
                    (card_id,),
                ).fetchone()
                if source is None:
                    raise MistakeSetSourceNotFoundError(card_id)
                try:
                    content = json.loads(source["problem_card_json"])
                except (TypeError, json.JSONDecodeError) as exc:
                    raise MistakeSetSourceNotFoundError(card_id) from exc
                if not isinstance(content, dict) or content.get("type") != "problem_card":
                    raise MistakeSetSourceNotFoundError(card_id)
                sources.append((source, content))

            conn.execute(
                """
                INSERT INTO mistake_sets (id, name, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (mistake_set_id, normalized_name, ts, ts),
            )
            for position, (source, content) in enumerate(sources):
                problem_text = str(content.get("problem_summary") or "").strip()
                title = str(content.get("title") or source["card_title"] or problem_text or "未命名题目").strip()
                paper_name = source["folder_name"] if source["managed_kind"] == "paper_archive" else "其他题目卡片"
                conn.execute(
                    """
                    INSERT INTO mistake_set_items (
                      id, mistake_set_id, source_session_id, source_paper_name,
                      title, problem_text, problem_image_data_url, problem_card_json,
                      position, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id("mistake_item"),
                        mistake_set_id,
                        source["live_session_id"],
                        paper_name,
                        title,
                        problem_text,
                        source["problem_image_data_url"],
                        source["problem_card_json"],
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
