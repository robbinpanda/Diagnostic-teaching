from __future__ import annotations

import sqlite3

from app.storage.repository_utils import new_id, now_iso

DEFAULT_KNOWLEDGE_FOLDER_ID = "folder_default_knowledge"
DEFAULT_PROBLEM_FOLDER_ID = "folder_default_problem"


class CardFolderConflictError(ValueError):
    pass


class CardFolderNotEmptyError(ValueError):
    pass


class CardFolderProtectedError(PermissionError):
    pass


def is_protected_card_folder(folder: sqlite3.Row) -> bool:
    return bool(folder["is_system"]) or folder["managed_kind"] is not None


def default_folder_id(card_type: str) -> str:
    if card_type == "knowledge_card":
        return DEFAULT_KNOWLEDGE_FOLDER_ID
    if card_type == "problem_card":
        return DEFAULT_PROBLEM_FOLDER_ID
    raise ValueError(f"不支持的卡片类型：{card_type}")


def resolve_card_folder(
    conn: sqlite3.Connection,
    folder_id: str | None,
    card_type: str,
    *,
    preferred_folder_id: str | None = None,
) -> str:
    resolved = folder_id or preferred_folder_id or default_folder_id(card_type)
    if conn.execute("SELECT 1 FROM card_folders WHERE id = ?", (resolved,)).fetchone() is None:
        raise KeyError(resolved)
    return resolved


def session_card_folder_id(
    conn: sqlite3.Connection,
    session_id: str,
    card_type: str,
) -> str:
    row = conn.execute(
        """
        SELECT s.paper_id, p.card_folder_id
        FROM sessions s
        LEFT JOIN exam_papers p ON p.id = s.paper_id
        WHERE s.id = ?
        """,
        (session_id,),
    ).fetchone()
    if row is None:
        raise KeyError(session_id)
    if row["paper_id"] is not None and row["card_folder_id"] is None:
        raise KeyError(row["paper_id"])
    return resolve_card_folder(
        conn,
        None,
        card_type,
        preferred_folder_id=row["card_folder_id"],
    )


class CardFolderRepositoryMixin:
    def list_card_folders(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM card_folders
                ORDER BY is_system DESC, name COLLATE NOCASE, created_at, id
                """
            ).fetchall()

    def create_card_folder(self, *, name: str, parent_id: str | None) -> sqlite3.Row:
        clean_name = name.strip()
        if not clean_name:
            raise CardFolderConflictError("文件夹名称不能为空")
        ts = now_iso()
        folder_id = new_id("folder")
        with self.db.connect() as conn:
            if parent_id is not None:
                parent = conn.execute(
                    "SELECT * FROM card_folders WHERE id = ?", (parent_id,)
                ).fetchone()
                if parent is None:
                    raise KeyError(parent_id)
                if parent["managed_kind"] == "paper_archive_root":
                    raise CardFolderProtectedError(parent_id)
            try:
                conn.execute(
                    """
                    INSERT INTO card_folders (
                      id, name, parent_id, is_system, default_card_type, created_at, updated_at
                    ) VALUES (?, ?, ?, 0, NULL, ?, ?)
                    """,
                    (folder_id, clean_name, parent_id, ts, ts),
                )
            except sqlite3.IntegrityError as exc:
                raise CardFolderConflictError("同一位置已存在同名文件夹") from exc
            return conn.execute(
                "SELECT * FROM card_folders WHERE id = ?", (folder_id,)
            ).fetchone()

    def update_card_folder(
        self,
        folder_id: str,
        *,
        name: str | None,
        parent_id: str | None,
        update_parent: bool,
    ) -> sqlite3.Row:
        with self.db.connect() as conn:
            folder = conn.execute(
                "SELECT * FROM card_folders WHERE id = ?", (folder_id,)
            ).fetchone()
            if folder is None:
                raise KeyError(folder_id)
            if is_protected_card_folder(folder):
                raise CardFolderProtectedError(folder_id)

            next_name = name.strip() if name is not None else folder["name"]
            if not next_name:
                raise CardFolderConflictError("文件夹名称不能为空")
            next_parent = parent_id if update_parent else folder["parent_id"]
            if next_parent == folder_id:
                raise CardFolderConflictError("文件夹不能放进自己")
            if next_parent is not None:
                parent = conn.execute(
                    "SELECT * FROM card_folders WHERE id = ?", (next_parent,)
                ).fetchone()
                if parent is None:
                    raise KeyError(next_parent)
                if parent["managed_kind"] == "paper_archive_root":
                    raise CardFolderProtectedError(next_parent)
                visited = {folder_id}
                cursor_id: str | None = next_parent
                while cursor_id is not None:
                    if cursor_id in visited:
                        raise CardFolderConflictError("文件夹不能移动到自己的子文件夹中")
                    visited.add(cursor_id)
                    cursor = conn.execute(
                        "SELECT parent_id FROM card_folders WHERE id = ?", (cursor_id,)
                    ).fetchone()
                    cursor_id = cursor["parent_id"] if cursor is not None else None
            try:
                conn.execute(
                    """
                    UPDATE card_folders
                    SET name = ?, parent_id = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (next_name, next_parent, now_iso(), folder_id),
                )
            except sqlite3.IntegrityError as exc:
                raise CardFolderConflictError("同一位置已存在同名文件夹") from exc
            return conn.execute(
                "SELECT * FROM card_folders WHERE id = ?", (folder_id,)
            ).fetchone()

    def delete_card_folder(self, folder_id: str) -> None:
        with self.db.connect() as conn:
            folder = conn.execute(
                "SELECT * FROM card_folders WHERE id = ?", (folder_id,)
            ).fetchone()
            if folder is None:
                raise KeyError(folder_id)
            if is_protected_card_folder(folder):
                raise CardFolderProtectedError(folder_id)
            child = conn.execute(
                "SELECT 1 FROM card_folders WHERE parent_id = ? LIMIT 1", (folder_id,)
            ).fetchone()
            card = conn.execute(
                "SELECT 1 FROM study_cards WHERE folder_id = ? LIMIT 1", (folder_id,)
            ).fetchone()
            if child is not None or card is not None:
                raise CardFolderNotEmptyError("只能删除空文件夹")
            conn.execute("DELETE FROM card_folders WHERE id = ?", (folder_id,))
