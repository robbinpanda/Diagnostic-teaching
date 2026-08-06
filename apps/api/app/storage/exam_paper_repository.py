from __future__ import annotations

import sqlite3

from app.storage.database import with_sqlite_busy_retry
from app.storage.repository_utils import new_id, now_iso

PAPER_ARCHIVE_ROOT_NAME = "按试卷归档"
PAPER_ARCHIVE_ROOT_MANAGED_KEY = "paper-archive-root:v1"
PAPER_ARCHIVE_KEY_PREFIX = "paper-archive:v1:"
ASCII_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
ASCII_LOWER = "abcdefghijklmnopqrstuvwxyz"


class ExamPaperNotFoundError(LookupError):
    pass


class ManagedPaperFolderConflictError(ValueError):
    pass


def normalize_exam_paper_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise ManagedPaperFolderConflictError("试卷名称不能为空")
    if len(normalized) > 80:
        raise ManagedPaperFolderConflictError("试卷名称不能超过 80 个字符")
    return normalized


def paper_archive_managed_key(name: str) -> str:
    normalized = normalize_exam_paper_name(name)
    ascii_lowered = normalized.translate(str.maketrans(ASCII_UPPER, ASCII_LOWER))
    return f"{PAPER_ARCHIVE_KEY_PREFIX}{ascii_lowered}"


def require_exam_paper(
    conn: sqlite3.Connection,
    paper_id: str | None,
) -> sqlite3.Row | None:
    if paper_id is None:
        return None
    row = conn.execute("SELECT * FROM exam_papers WHERE id = ?", (paper_id,)).fetchone()
    if row is None:
        raise ExamPaperNotFoundError(paper_id)
    return row


def _ensure_archive_root(conn: sqlite3.Connection) -> sqlite3.Row:
    root = conn.execute(
        "SELECT * FROM card_folders WHERE managed_key = ? COLLATE NOCASE",
        (PAPER_ARCHIVE_ROOT_MANAGED_KEY,),
    ).fetchone()
    if root is None:
        root = conn.execute(
            """
            SELECT * FROM card_folders
            WHERE parent_id IS NULL AND name = ? COLLATE NOCASE
            """,
            (PAPER_ARCHIVE_ROOT_NAME,),
        ).fetchone()
    if root is None:
        folder_id = new_id("folder")
        ts = now_iso()
        conn.execute(
            """
            INSERT INTO card_folders (
              id, name, parent_id, is_system, default_card_type,
              managed_kind, managed_key, created_at, updated_at
            ) VALUES (?, ?, NULL, 0, NULL, 'paper_archive_root', ?, ?, ?)
            """,
            (
                folder_id,
                PAPER_ARCHIVE_ROOT_NAME,
                PAPER_ARCHIVE_ROOT_MANAGED_KEY,
                ts,
                ts,
            ),
        )
        return conn.execute(
            "SELECT * FROM card_folders WHERE id = ?", (folder_id,)
        ).fetchone()
    if root["parent_id"] is not None or root["managed_kind"] not in {
        None,
        "paper_archive_root",
    }:
        raise ManagedPaperFolderConflictError("按试卷归档目录状态冲突")
    try:
        conn.execute(
            """
            UPDATE card_folders
            SET name = ?, managed_kind = 'paper_archive_root', managed_key = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                PAPER_ARCHIVE_ROOT_NAME,
                PAPER_ARCHIVE_ROOT_MANAGED_KEY,
                now_iso(),
                root["id"],
            ),
        )
    except sqlite3.IntegrityError as exc:
        raise ManagedPaperFolderConflictError("按试卷归档目录状态冲突") from exc
    return conn.execute(
        "SELECT * FROM card_folders WHERE id = ?", (root["id"],)
    ).fetchone()


def ensure_paper_archive_folder(
    conn: sqlite3.Connection,
    paper_name: str,
) -> sqlite3.Row:
    clean_name = normalize_exam_paper_name(paper_name)
    managed_key = paper_archive_managed_key(clean_name)
    root = _ensure_archive_root(conn)
    folder = conn.execute(
        "SELECT * FROM card_folders WHERE managed_key = ? COLLATE NOCASE",
        (managed_key,),
    ).fetchone()
    if folder is None:
        folder = conn.execute(
            """
            SELECT * FROM card_folders
            WHERE parent_id = ? AND name = ? COLLATE NOCASE
            """,
            (root["id"], clean_name),
        ).fetchone()
    if folder is None:
        folder_id = new_id("folder")
        ts = now_iso()
        try:
            conn.execute(
                """
                INSERT INTO card_folders (
                  id, name, parent_id, is_system, default_card_type,
                  managed_kind, managed_key, created_at, updated_at
                ) VALUES (?, ?, ?, 0, NULL, 'paper_archive', ?, ?, ?)
                """,
                (folder_id, clean_name, root["id"], managed_key, ts, ts),
            )
        except sqlite3.IntegrityError as exc:
            raise ManagedPaperFolderConflictError("试卷归档目录名称或标识冲突") from exc
        return conn.execute(
            "SELECT * FROM card_folders WHERE id = ?", (folder_id,)
        ).fetchone()
    if folder["parent_id"] != root["id"] or folder["managed_kind"] not in {
        None,
        "paper_archive",
    }:
        raise ManagedPaperFolderConflictError("试卷归档目录名称或标识冲突")
    try:
        conn.execute(
            """
            UPDATE card_folders
            SET name = ?, managed_kind = 'paper_archive', managed_key = ?, updated_at = ?
            WHERE id = ?
            """,
            (clean_name, managed_key, now_iso(), folder["id"]),
        )
    except sqlite3.IntegrityError as exc:
        raise ManagedPaperFolderConflictError("试卷归档目录名称或标识冲突") from exc
    return conn.execute(
        "SELECT * FROM card_folders WHERE id = ?", (folder["id"],)
    ).fetchone()


def _validate_paper_archive_folder(
    conn: sqlite3.Connection,
    folder_id: str,
) -> None:
    row = conn.execute(
        """
        SELECT child.managed_kind AS child_kind,
               parent.managed_kind AS parent_kind,
               parent.managed_key AS parent_key
        FROM card_folders child
        LEFT JOIN card_folders parent ON parent.id = child.parent_id
        WHERE child.id = ?
        """,
        (folder_id,),
    ).fetchone()
    if (
        row is None
        or row["child_kind"] != "paper_archive"
        or row["parent_kind"] != "paper_archive_root"
        or row["parent_key"].lower() != PAPER_ARCHIVE_ROOT_MANAGED_KEY
    ):
        raise ManagedPaperFolderConflictError("试卷绑定的归档目录状态冲突")


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

    @with_sqlite_busy_retry
    def create_exam_paper(self, name: str) -> sqlite3.Row:
        normalized = normalize_exam_paper_name(name)
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                "SELECT * FROM exam_papers WHERE name = ? COLLATE NOCASE",
                (normalized,),
            ).fetchone()
            if existing is None:
                folder = ensure_paper_archive_folder(conn, normalized)
                paper_id = new_id("paper")
                try:
                    conn.execute(
                        """
                        INSERT INTO exam_papers (
                          id, name, card_folder_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (paper_id, normalized, folder["id"], ts, ts),
                    )
                except sqlite3.IntegrityError as exc:
                    raise ManagedPaperFolderConflictError(
                        "试卷名称或归档目录已被占用"
                    ) from exc
            else:
                paper_id = existing["id"]
                _validate_paper_archive_folder(conn, existing["card_folder_id"])
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
