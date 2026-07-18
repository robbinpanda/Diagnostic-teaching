"""Establish the SQLite reliability and constraint baseline.

Revision ID: 0001_sqlite_reliability
Revises:
Create Date: 2026-07-18
"""

from __future__ import annotations

from collections.abc import Iterable

from alembic import op
from sqlalchemy.engine import Connection


revision = "0001_sqlite_reliability"
down_revision = None
branch_labels = None
depends_on = None


TABLES = (
    "model_profiles",
    "sessions",
    "messages",
    "checkpoints",
    "study_cards",
)
NEW_PREFIX = "alembic_new_"


def _execute(bind: Connection, statement: str) -> None:
    bind.exec_driver_sql(statement)


def _columns(bind: Connection, table_name: str) -> set[str]:
    return {
        row[1]
        for row in bind.exec_driver_sql(f'PRAGMA table_info("{table_name}")').fetchall()
    }


def _table_exists(bind: Connection, table_name: str) -> bool:
    row = bind.exec_driver_sql(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _legacy_expr(columns: set[str], column: str, default: str) -> str:
    return f'old."{column}"' if column in columns else default


def _copy_rows(
    bind: Connection,
    table_name: str,
    target_columns: Iterable[str],
    expressions: Iterable[str],
) -> None:
    targets = ", ".join(f'"{column}"' for column in target_columns)
    select_list = ", ".join(expressions)
    _execute(
        bind,
        f'INSERT INTO "{NEW_PREFIX}{table_name}" ({targets}) '
        f'SELECT {select_list} FROM "{table_name}" AS old',
    )


def _create_new_tables(bind: Connection) -> None:
    for table_name in reversed(TABLES):
        _execute(bind, f'DROP TABLE IF EXISTS "{NEW_PREFIX}{table_name}"')

    _execute(
        bind,
        f"""
        CREATE TABLE "{NEW_PREFIX}model_profiles" (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          provider TEXT NOT NULL,
          base_url TEXT NOT NULL,
          model TEXT NOT NULL,
          api_key_ciphertext TEXT NOT NULL,
          api_key_mask TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          deleted_at TEXT,
          last_test_status TEXT,
          last_test_latency_ms INTEGER,
          timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms > 0),
          temperature REAL NOT NULL DEFAULT 0.2,
          max_output_tokens INTEGER NOT NULL DEFAULT 8000 CHECK (max_output_tokens > 0),
          is_multimodal INTEGER NOT NULL DEFAULT 0 CHECK (is_multimodal IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """,
    )
    _execute(
        bind,
        f"""
        CREATE TABLE "{NEW_PREFIX}sessions" (
          id TEXT PRIMARY KEY,
          grade_band TEXT NOT NULL,
          subject TEXT NOT NULL,
          model_profile_id TEXT NOT NULL,
          problem_text TEXT NOT NULL,
          problem_image_data_url TEXT,
          student_initial_thought TEXT NOT NULL DEFAULT '',
          phase TEXT NOT NULL,
          breakpoint_description TEXT,
          breakpoint_confidence REAL,
          restored_from TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id)
            ON UPDATE CASCADE ON DELETE RESTRICT
        )
        """,
    )
    _execute(
        bind,
        f"""
        CREATE TABLE "{NEW_PREFIX}messages" (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          action_id TEXT,
          action TEXT NOT NULL DEFAULT 'LEGACY_MESSAGE',
          in_reply_to_action_id TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{{}}',
          created_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
            ON UPDATE CASCADE ON DELETE CASCADE
        )
        """,
    )
    _execute(
        bind,
        f"""
        CREATE TABLE "{NEW_PREFIX}checkpoints" (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          question TEXT NOT NULL,
          options_json TEXT NOT NULL,
          correct_option_id TEXT NOT NULL,
          tested_point TEXT NOT NULL,
          source_action_id TEXT,
          selected_option_id TEXT,
          is_correct INTEGER CHECK (is_correct IS NULL OR is_correct IN (0, 1)),
          elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
          created_at TEXT NOT NULL,
          answered_at TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
            ON UPDATE CASCADE ON DELETE CASCADE
        )
        """,
    )
    _execute(
        bind,
        f"""
        CREATE TABLE "{NEW_PREFIX}study_cards" (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          live_session_id TEXT,
          card_type TEXT NOT NULL CHECK (card_type IN ('knowledge_card', 'problem_card')),
          title TEXT NOT NULL,
          content_json TEXT NOT NULL,
          source_action_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          saved_at TEXT,
          FOREIGN KEY (live_session_id) REFERENCES sessions(id)
            ON UPDATE CASCADE ON DELETE SET NULL
        )
        """,
    )


def _copy_legacy_data(bind: Connection, existing_tables: set[str]) -> None:
    if "model_profiles" in existing_tables:
        columns = _columns(bind, "model_profiles")
        max_tokens = _legacy_expr(columns, "max_output_tokens", "8000")
        if "is_multimodal" not in columns and "max_output_tokens" in columns:
            max_tokens = (
                "CASE WHEN old.\"max_output_tokens\" = 1200 "
                "THEN 8000 ELSE old.\"max_output_tokens\" END"
            )
        target = (
            "id", "display_name", "provider", "base_url", "model",
            "api_key_ciphertext", "api_key_mask", "tags_json", "enabled",
            "deleted_at", "last_test_status", "last_test_latency_ms", "timeout_ms",
            "temperature", "max_output_tokens", "is_multimodal", "created_at",
            "updated_at",
        )
        expressions = (
            _legacy_expr(columns, "id", "''"),
            _legacy_expr(columns, "display_name", "''"),
            _legacy_expr(columns, "provider", "'openai_compatible'"),
            _legacy_expr(columns, "base_url", "''"),
            _legacy_expr(columns, "model", "''"),
            _legacy_expr(columns, "api_key_ciphertext", "''"),
            _legacy_expr(columns, "api_key_mask", "''"),
            _legacy_expr(columns, "tags_json", "'[]'"),
            _legacy_expr(columns, "enabled", "1"),
            _legacy_expr(columns, "deleted_at", "NULL"),
            _legacy_expr(columns, "last_test_status", "NULL"),
            _legacy_expr(columns, "last_test_latency_ms", "NULL"),
            _legacy_expr(columns, "timeout_ms", "30000"),
            _legacy_expr(columns, "temperature", "0.2"),
            max_tokens,
            _legacy_expr(columns, "is_multimodal", "0"),
            _legacy_expr(columns, "created_at", "CURRENT_TIMESTAMP"),
            _legacy_expr(columns, "updated_at", "CURRENT_TIMESTAMP"),
        )
        _copy_rows(bind, "model_profiles", target, expressions)

    if "sessions" in existing_tables:
        columns = _columns(bind, "sessions")
        target = (
            "id", "grade_band", "subject", "model_profile_id", "problem_text",
            "problem_image_data_url", "student_initial_thought", "phase",
            "breakpoint_description", "breakpoint_confidence", "restored_from",
            "created_at", "updated_at",
        )
        expressions = tuple(
            _legacy_expr(columns, column, default)
            for column, default in (
                ("id", "''"), ("grade_band", "''"), ("subject", "'math'"),
                ("model_profile_id", "''"), ("problem_text", "''"),
                ("problem_image_data_url", "NULL"), ("student_initial_thought", "''"),
                ("phase", "'diagnosing'"), ("breakpoint_description", "NULL"),
                ("breakpoint_confidence", "NULL"), ("restored_from", "NULL"),
                ("created_at", "CURRENT_TIMESTAMP"), ("updated_at", "CURRENT_TIMESTAMP"),
            )
        )
        _copy_rows(bind, "sessions", target, expressions)

    if "messages" in existing_tables:
        columns = _columns(bind, "messages")
        target = (
            "id", "session_id", "role", "content", "action_id", "action",
            "in_reply_to_action_id", "metadata_json", "created_at",
        )
        expressions = tuple(
            _legacy_expr(columns, column, default)
            for column, default in (
                ("id", "''"), ("session_id", "''"), ("role", "'student'"),
                ("content", "''"), ("action_id", "NULL"),
                ("action", "'LEGACY_MESSAGE'"), ("in_reply_to_action_id", "NULL"),
                ("metadata_json", "'{}'"), ("created_at", "CURRENT_TIMESTAMP"),
            )
        )
        _copy_rows(bind, "messages", target, expressions)

    if "checkpoints" in existing_tables:
        columns = _columns(bind, "checkpoints")
        target = (
            "id", "session_id", "question", "options_json", "correct_option_id",
            "tested_point", "source_action_id", "selected_option_id", "is_correct",
            "elapsed_ms", "created_at", "answered_at",
        )
        expressions = tuple(
            _legacy_expr(columns, column, default)
            for column, default in (
                ("id", "''"), ("session_id", "''"), ("question", "''"),
                ("options_json", "'{}'"), ("correct_option_id", "''"),
                ("tested_point", "''"), ("source_action_id", "NULL"),
                ("selected_option_id", "NULL"), ("is_correct", "NULL"),
                ("elapsed_ms", "NULL"), ("created_at", "CURRENT_TIMESTAMP"),
                ("answered_at", "NULL"),
            )
        )
        _copy_rows(bind, "checkpoints", target, expressions)

    if "study_cards" in existing_tables:
        columns = _columns(bind, "study_cards")
        live_column = "live_session_id" if "live_session_id" in columns else "session_id"
        if "sessions" in existing_tables and live_column in columns:
            live_session = (
                f'CASE WHEN old."{live_column}" IS NOT NULL AND EXISTS '
                f'(SELECT 1 FROM "sessions" AS live WHERE live.id = old."{live_column}") '
                f'THEN old."{live_column}" ELSE NULL END'
            )
        else:
            live_session = "NULL"
        target = (
            "id", "session_id", "live_session_id", "card_type", "title",
            "content_json", "source_action_id", "source_message_id", "created_at",
            "saved_at",
        )
        expressions = (
            _legacy_expr(columns, "id", "''"),
            _legacy_expr(columns, "session_id", "''"),
            live_session,
            _legacy_expr(columns, "card_type", "'knowledge_card'"),
            _legacy_expr(columns, "title", "''"),
            _legacy_expr(columns, "content_json", "'{}'"),
            _legacy_expr(columns, "source_action_id", "''"),
            _legacy_expr(columns, "source_message_id", "''"),
            _legacy_expr(columns, "created_at", "CURRENT_TIMESTAMP"),
            _legacy_expr(columns, "saved_at", "NULL"),
        )
        _copy_rows(bind, "study_cards", target, expressions)


def _replace_tables(bind: Connection, existing_tables: set[str]) -> None:
    for table_name in reversed(TABLES):
        if table_name in existing_tables:
            _execute(bind, f'DROP TABLE "{table_name}"')
    for table_name in TABLES:
        _execute(
            bind,
            f'ALTER TABLE "{NEW_PREFIX}{table_name}" RENAME TO "{table_name}"',
        )


def _create_indexes_and_triggers(bind: Connection) -> None:
    statements = (
        "CREATE INDEX idx_model_profiles_active "
        "ON model_profiles(deleted_at, enabled, created_at DESC)",
        "CREATE INDEX idx_sessions_model_profile ON sessions(model_profile_id)",
        "CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC)",
        "CREATE INDEX idx_sessions_restored_from ON sessions(restored_from)",
        "CREATE INDEX idx_messages_session_created "
        "ON messages(session_id, created_at)",
        "CREATE INDEX idx_messages_session_action "
        "ON messages(session_id, action_id)",
        "CREATE INDEX idx_messages_session_reply "
        "ON messages(session_id, in_reply_to_action_id)",
        "CREATE INDEX idx_checkpoints_session_created "
        "ON checkpoints(session_id, created_at)",
        "CREATE INDEX idx_checkpoints_session_answered "
        "ON checkpoints(session_id, answered_at, created_at)",
        "CREATE INDEX idx_study_cards_live_session_saved "
        "ON study_cards(live_session_id, saved_at, created_at)",
        "CREATE INDEX idx_study_cards_session_saved "
        "ON study_cards(session_id, saved_at, created_at)",
        "CREATE INDEX idx_study_cards_global_saved "
        "ON study_cards(saved_at, created_at)",
        """
        CREATE TRIGGER trg_sessions_delete_pending_cards
        BEFORE DELETE ON sessions
        FOR EACH ROW
        BEGIN
          DELETE FROM study_cards
          WHERE live_session_id = OLD.id AND saved_at IS NULL;
        END
        """,
    )
    for statement in statements:
        _execute(bind, statement)


def upgrade() -> None:
    bind = op.get_bind()
    existing_tables = {table for table in TABLES if _table_exists(bind, table)}
    _create_new_tables(bind)
    _copy_legacy_data(bind, existing_tables)
    _replace_tables(bind, existing_tables)
    _create_indexes_and_triggers(bind)

    violations = bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
    if violations:
        summary = ", ".join(
            f"{row[0]} rowid={row[1]} parent={row[2]}" for row in violations[:10]
        )
        raise RuntimeError(f"legacy database contains invalid foreign keys: {summary}")


def downgrade() -> None:
    raise RuntimeError(
        "The SQLite reliability baseline cannot be downgraded safely; restore a backup instead."
    )
