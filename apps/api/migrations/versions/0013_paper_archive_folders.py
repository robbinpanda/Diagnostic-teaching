"""Add durable managed folders for exam-paper card archives.

Revision ID: 0013_paper_archive_folders
Revises: 0012_merge_exam_run_heads
Create Date: 2026-08-06
"""

from __future__ import annotations

import json
import uuid

from alembic import op
from sqlalchemy.engine import Connection


revision = "0013_paper_archive_folders"
down_revision = "0012_merge_exam_run_heads"
branch_labels = None
depends_on = None


PAPER_ARCHIVE_ROOT_NAME = "按试卷归档"
PAPER_ARCHIVE_ROOT_MANAGED_KEY = "paper-archive-root:v1"
PAPER_ARCHIVE_KEY_PREFIX = "paper-archive:v1:"
ASCII_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
ASCII_LOWER = "abcdefghijklmnopqrstuvwxyz"


def _execute(bind: Connection, statement: str, parameters: tuple = ()):
    return bind.exec_driver_sql(statement, parameters)


def _new_folder_id() -> str:
    return f"folder_{uuid.uuid4().hex[:12]}"


def _clean_paper_name(name: str) -> str:
    clean = name.strip()
    if not clean:
        raise RuntimeError("exam paper name cannot be empty during archive migration")
    return clean


def _paper_archive_managed_key(name: str) -> str:
    clean = _clean_paper_name(name)
    return PAPER_ARCHIVE_KEY_PREFIX + clean.translate(str.maketrans(ASCII_UPPER, ASCII_LOWER))


def _create_card_folders_table(bind: Connection, table_name: str, *, managed: bool) -> None:
    managed_columns = ""
    managed_checks = ""
    if managed:
        managed_columns = """
          managed_kind TEXT
            CHECK (managed_kind IS NULL OR managed_kind IN ('paper_archive_root', 'paper_archive')),
          managed_key TEXT CHECK (managed_key IS NULL OR LENGTH(TRIM(managed_key)) > 0),
        """
        managed_checks = """
          CHECK (
            (managed_kind IS NULL AND managed_key IS NULL)
            OR
            (managed_kind IS NOT NULL AND managed_key IS NOT NULL)
          ),
        """
    _execute(
        bind,
        f"""
        CREATE TABLE "{table_name}" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 80),
          parent_id TEXT,
          is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
          default_card_type TEXT UNIQUE
            CHECK (default_card_type IS NULL OR default_card_type IN ('knowledge_card', 'problem_card')),
          {managed_columns}
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES "{table_name}"(id)
            ON UPDATE CASCADE ON DELETE RESTRICT,
          {managed_checks}
          CHECK (parent_id IS NULL OR parent_id <> id)
        )
        """,
    )


def _create_card_folder_indexes(bind: Connection, *, managed: bool) -> None:
    _execute(
        bind,
        """
        CREATE UNIQUE INDEX uq_card_folders_root_name
        ON card_folders(name COLLATE NOCASE)
        WHERE parent_id IS NULL
        """,
    )
    _execute(
        bind,
        """
        CREATE UNIQUE INDEX uq_card_folders_child_name
        ON card_folders(parent_id, name COLLATE NOCASE)
        WHERE parent_id IS NOT NULL
        """,
    )
    _execute(
        bind,
        "CREATE INDEX idx_card_folders_parent "
        "ON card_folders(parent_id, name COLLATE NOCASE)",
    )
    if managed:
        _execute(
            bind,
            """
            CREATE UNIQUE INDEX uq_card_folders_managed_key
            ON card_folders(managed_key COLLATE NOCASE)
            WHERE managed_key IS NOT NULL
            """,
        )


def _upgrade_card_folders(bind: Connection) -> None:
    _execute(bind, 'DROP TABLE IF EXISTS "alembic_new_card_folders"')
    _create_card_folders_table(bind, "alembic_new_card_folders", managed=True)
    _execute(
        bind,
        """
        INSERT INTO alembic_new_card_folders (
          id, name, parent_id, is_system, default_card_type,
          managed_kind, managed_key, created_at, updated_at
        )
        SELECT id, name, parent_id, is_system, default_card_type,
               NULL, NULL, created_at, updated_at
        FROM card_folders
        """,
    )
    _execute(bind, "DROP TABLE card_folders")
    _execute(bind, "ALTER TABLE alembic_new_card_folders RENAME TO card_folders")
    _create_card_folder_indexes(bind, managed=True)


def _ensure_archive_root(bind: Connection) -> str:
    row = _execute(
        bind,
        "SELECT * FROM card_folders WHERE managed_key = ? COLLATE NOCASE",
        (PAPER_ARCHIVE_ROOT_MANAGED_KEY,),
    ).mappings().fetchone()
    if row is None:
        row = _execute(
            bind,
            """
            SELECT * FROM card_folders
            WHERE parent_id IS NULL AND name = ? COLLATE NOCASE
            """,
            (PAPER_ARCHIVE_ROOT_NAME,),
        ).mappings().fetchone()
    if row is None:
        folder_id = _new_folder_id()
        _execute(
            bind,
            """
            INSERT INTO card_folders (
              id, name, parent_id, is_system, default_card_type,
              managed_kind, managed_key, created_at, updated_at
            ) VALUES (?, ?, NULL, 0, NULL, 'paper_archive_root', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (folder_id, PAPER_ARCHIVE_ROOT_NAME, PAPER_ARCHIVE_ROOT_MANAGED_KEY),
        )
        return folder_id
    if row["parent_id"] is not None or row["managed_kind"] not in {None, "paper_archive_root"}:
        raise RuntimeError("existing paper archive root has incompatible managed metadata")
    _execute(
        bind,
        """
        UPDATE card_folders
        SET name = ?, managed_kind = 'paper_archive_root', managed_key = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (PAPER_ARCHIVE_ROOT_NAME, PAPER_ARCHIVE_ROOT_MANAGED_KEY, row["id"]),
    )
    return row["id"]


def _ensure_archive_child(bind: Connection, root_id: str, paper_name: str) -> str:
    clean_name = _clean_paper_name(paper_name)
    managed_key = _paper_archive_managed_key(clean_name)
    row = _execute(
        bind,
        "SELECT * FROM card_folders WHERE managed_key = ? COLLATE NOCASE",
        (managed_key,),
    ).mappings().fetchone()
    if row is None:
        row = _execute(
            bind,
            """
            SELECT * FROM card_folders
            WHERE parent_id = ? AND name = ? COLLATE NOCASE
            """,
            (root_id, clean_name),
        ).mappings().fetchone()
    if row is None:
        folder_id = _new_folder_id()
        _execute(
            bind,
            """
            INSERT INTO card_folders (
              id, name, parent_id, is_system, default_card_type,
              managed_kind, managed_key, created_at, updated_at
            ) VALUES (?, ?, ?, 0, NULL, 'paper_archive', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (folder_id, clean_name, root_id, managed_key),
        )
        return folder_id
    if row["parent_id"] != root_id or row["managed_kind"] not in {None, "paper_archive"}:
        raise RuntimeError(f"paper archive folder conflict for {clean_name!r}")
    _execute(
        bind,
        """
        UPDATE card_folders
        SET name = ?, managed_kind = 'paper_archive', managed_key = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (clean_name, managed_key, row["id"]),
    )
    return row["id"]


def _upgrade_exam_papers(bind: Connection, paper_folders: dict[str, str]) -> None:
    rows = _execute(
        bind,
        "SELECT id, name, created_at, updated_at FROM exam_papers ORDER BY rowid",
    ).mappings().fetchall()
    _execute(bind, 'DROP TABLE IF EXISTS "alembic_new_exam_papers"')
    _execute(
        bind,
        """
        CREATE TABLE alembic_new_exam_papers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 80),
          card_folder_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (card_folder_id) REFERENCES card_folders(id)
            ON UPDATE CASCADE ON DELETE RESTRICT
        )
        """,
    )
    for row in rows:
        _execute(
            bind,
            """
            INSERT INTO alembic_new_exam_papers (
              id, name, card_folder_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                _clean_paper_name(row["name"]),
                paper_folders[row["id"]],
                row["created_at"],
                row["updated_at"],
            ),
        )
    _execute(bind, "DROP TABLE exam_papers")
    _execute(bind, "ALTER TABLE alembic_new_exam_papers RENAME TO exam_papers")
    _execute(
        bind,
        "CREATE UNIQUE INDEX uq_exam_papers_name ON exam_papers(name COLLATE NOCASE)",
    )
    _execute(
        bind,
        "CREATE UNIQUE INDEX uq_exam_papers_card_folder ON exam_papers(card_folder_id)",
    )


def _backfill_cards_and_events(bind: Connection) -> None:
    default_rows = _execute(
        bind,
        """
        SELECT default_card_type, id
        FROM card_folders
        WHERE default_card_type IN ('knowledge_card', 'problem_card')
        """,
    ).mappings().fetchall()
    defaults = {row["default_card_type"]: row["id"] for row in default_rows}
    if set(defaults) != {"knowledge_card", "problem_card"}:
        raise RuntimeError("card defaults are incomplete during paper archive migration")
    cards = _execute(
        bind,
        """
        SELECT c.id, c.live_session_id, c.saved_at, c.card_type,
               c.folder_id, p.card_folder_id
        FROM study_cards c
        JOIN sessions s ON s.id = c.live_session_id
        JOIN exam_papers p ON p.id = s.paper_id
        WHERE (c.card_type = 'knowledge_card' AND c.folder_id = ?)
           OR (c.card_type = 'problem_card' AND c.folder_id = ?)
        ORDER BY c.rowid
        """,
        (defaults["knowledge_card"], defaults["problem_card"]),
    ).mappings().fetchall()

    prepared_event_updates: list[tuple[str, str]] = []
    for card in cards:
        event_rows = _execute(
            bind,
            """
            SELECT id, data_json
            FROM session_events
            WHERE session_id = ? AND type = 'card.ready'
            ORDER BY seq
            """,
            (card["live_session_id"],),
        ).mappings().fetchall()
        matches: list[tuple[str, dict]] = []
        for event in event_rows:
            try:
                data = json.loads(event["data_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("card_id") == card["id"]:
                matches.append((event["id"], data))
        if card["saved_at"] is None and not matches:
            raise RuntimeError(
                f"pending card {card['id']} has no matching card.ready event"
            )
        for event_id, data in matches:
            data["folder_id"] = card["card_folder_id"]
            prepared_event_updates.append(
                (
                    json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    event_id,
                )
            )

    for card in cards:
        _execute(
            bind,
            "UPDATE study_cards SET folder_id = ? WHERE id = ?",
            (card["card_folder_id"], card["id"]),
        )
    for data_json, event_id in prepared_event_updates:
        _execute(
            bind,
            "UPDATE session_events SET data_json = ? WHERE id = ?",
            (data_json, event_id),
        )


def _downgrade_exam_papers(bind: Connection) -> None:
    _execute(bind, 'DROP TABLE IF EXISTS "alembic_old_exam_papers"')
    _execute(
        bind,
        """
        CREATE TABLE alembic_old_exam_papers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 80),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """,
    )
    _execute(
        bind,
        """
        INSERT INTO alembic_old_exam_papers (id, name, created_at, updated_at)
        SELECT id, name, created_at, updated_at FROM exam_papers
        """,
    )
    _execute(bind, "DROP TABLE exam_papers")
    _execute(bind, "ALTER TABLE alembic_old_exam_papers RENAME TO exam_papers")
    _execute(
        bind,
        "CREATE UNIQUE INDEX uq_exam_papers_name ON exam_papers(name COLLATE NOCASE)",
    )


def _downgrade_card_folders(bind: Connection) -> None:
    _execute(bind, 'DROP TABLE IF EXISTS "alembic_old_card_folders"')
    _create_card_folders_table(bind, "alembic_old_card_folders", managed=False)
    _execute(
        bind,
        """
        INSERT INTO alembic_old_card_folders (
          id, name, parent_id, is_system, default_card_type, created_at, updated_at
        )
        SELECT id, name, parent_id, is_system, default_card_type, created_at, updated_at
        FROM card_folders
        """,
    )
    _execute(bind, "DROP TABLE card_folders")
    _execute(bind, "ALTER TABLE alembic_old_card_folders RENAME TO card_folders")
    _create_card_folder_indexes(bind, managed=False)


def _assert_foreign_keys(bind: Connection, stage: str) -> None:
    violations = _execute(bind, "PRAGMA foreign_key_check").fetchall()
    if violations:
        summary = ", ".join(
            f"{row[0]} rowid={row[1]} parent={row[2]}" for row in violations[:10]
        )
        raise RuntimeError(f"{stage} contains invalid foreign keys: {summary}")


def upgrade() -> None:
    bind = op.get_bind()
    _upgrade_card_folders(bind)
    root_id = _ensure_archive_root(bind)
    papers = _execute(
        bind, "SELECT id, name FROM exam_papers ORDER BY rowid"
    ).mappings().fetchall()
    paper_folders = {
        paper["id"]: _ensure_archive_child(bind, root_id, paper["name"])
        for paper in papers
    }
    _upgrade_exam_papers(bind, paper_folders)
    _backfill_cards_and_events(bind)
    _assert_foreign_keys(bind, "paper archive upgrade")


def downgrade() -> None:
    bind = op.get_bind()
    _downgrade_exam_papers(bind)
    _downgrade_card_folders(bind)
    _assert_foreign_keys(bind, "paper archive downgrade")
