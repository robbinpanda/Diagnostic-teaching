from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from app.storage.database import (
    ALEMBIC_INI,
    MIGRATIONS_DIR,
    SQLITE_BUSY_RETRY_DELAYS_SECONDS,
    SQLITE_BUSY_TIMEOUT_MS,
    Database,
)


def _alembic_config(path: Path) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["database_path"] = path
    return config


def _upgrade_database(path: Path, revision: str) -> None:
    command.upgrade(_alembic_config(path), revision)


def _downgrade_database(path: Path, revision: str) -> None:
    command.downgrade(_alembic_config(path), revision)


def _create_0012_archive_fixture(path: Path, *, include_pending_event: bool = True) -> None:
    _upgrade_database(path, "0012_merge_exam_run_heads")
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(
        """
        INSERT INTO model_profiles (
          id, display_name, provider, base_url, model, api_key_ciphertext,
          api_key_mask, created_at, updated_at
        ) VALUES (
          'prof_archive', 'Archive fixture', 'local_demo', 'https://local.demo/v1',
          'local-demo', 'ciphertext', '****text', 'now', 'now'
        );

        INSERT INTO card_folders (
          id, name, parent_id, is_system, default_card_type, created_at, updated_at
        ) VALUES
          ('folder_existing_archive_root', '按试卷归档', NULL, 0, NULL, 'now', 'now'),
          ('folder_existing_exam', '期中 A 卷', 'folder_existing_archive_root', 0, NULL, 'now', 'now'),
          ('folder_custom', '我的整理', NULL, 0, NULL, 'now', 'now');

        INSERT INTO exam_papers (id, name, created_at, updated_at) VALUES
          ('paper_fixture_a', '期中 A 卷', 'now', 'now'),
          ('paper_fixture_b', '  期末 B 卷  ', 'now', 'now');

        INSERT INTO sessions (
          id, grade_band, subject, model_profile_id, paper_id, problem_text,
          student_initial_thought, phase, context_status, created_at, updated_at
        ) VALUES
          ('sess_fixture_a', 'junior', 'math', 'prof_archive', 'paper_fixture_a',
           'problem a', '', 'diagnosing', 'ready', 'now', 'now'),
          ('sess_fixture_b', 'junior', 'math', 'prof_archive', 'paper_fixture_b',
           'problem b', '', 'diagnosing', 'ready', 'now', 'now');

        INSERT INTO study_cards (
          id, session_id, live_session_id, card_type, title, content_json,
          source_action_id, source_message_id, created_at, saved_at, folder_id
        ) VALUES
          ('card_saved_default', 'sess_fixture_a', 'sess_fixture_a', 'knowledge_card',
           'saved default', '{}', 'act_saved', 'msg_saved', 'now', 'now',
           'folder_default_knowledge'),
          ('card_pending_default', 'sess_fixture_a', 'sess_fixture_a', 'knowledge_card',
           'pending default', '{}', 'act_pending', 'msg_pending', 'now', NULL,
           'folder_default_knowledge'),
          ('card_custom', 'sess_fixture_a', 'sess_fixture_a', 'knowledge_card',
           'custom', '{}', 'act_custom', 'msg_custom', 'now', 'now', 'folder_custom'),
          ('card_no_live_session', 'sess_fixture_a', NULL, 'knowledge_card',
           'no live session', '{}', 'act_no_live', 'msg_no_live', 'now', 'now',
           'folder_default_knowledge'),
          ('card_problem_default', 'sess_fixture_b', 'sess_fixture_b', 'problem_card',
           'problem default', '{}', 'act_problem', 'msg_problem', 'now', 'now',
           'folder_default_problem');

        INSERT INTO session_events (
          id, session_id, seq, type, data_json, created_at
        ) VALUES
          ('evt_saved', 'sess_fixture_a', 1, 'card.ready',
           '{"card_id":"card_saved_default","folder_id":"folder_default_knowledge","other":"kept"}',
           'now'),
          ('evt_problem', 'sess_fixture_b', 1, 'card.ready',
           '{"card_id":"card_problem_default","folder_id":"folder_default_problem"}',
           'now');
        """
    )
    if include_pending_event:
        conn.execute(
            """
            INSERT INTO session_events (
              id, session_id, seq, type, data_json, created_at
            ) VALUES (
              'evt_pending', 'sess_fixture_a', 2, 'card.ready', ?, 'now'
            )
            """,
            (
                '{"card_id":"card_pending_default",'
                '"folder_id":"folder_default_knowledge","other":"kept"}',
            ),
        )
    conn.commit()
    conn.close()


def _create_legacy_database(path: Path) -> None:
    """Create a representative pre-Alembic database with historical columns."""
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE model_profiles (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          provider TEXT NOT NULL,
          base_url TEXT NOT NULL,
          model TEXT NOT NULL,
          api_key_ciphertext TEXT NOT NULL,
          api_key_mask TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 1,
          deleted_at TEXT,
          last_test_status TEXT,
          last_test_latency_ms INTEGER,
          timeout_ms INTEGER NOT NULL DEFAULT 30000,
          temperature REAL NOT NULL DEFAULT 0.2,
          max_output_tokens INTEGER NOT NULL DEFAULT 1200,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          grade_band TEXT NOT NULL,
          subject TEXT NOT NULL,
          model_profile_id TEXT NOT NULL,
          problem_text TEXT NOT NULL,
          student_initial_thought TEXT NOT NULL DEFAULT '',
          phase TEXT NOT NULL,
          breakpoint_description TEXT,
          breakpoint_confidence REAL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        CREATE TABLE checkpoints (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          question TEXT NOT NULL,
          options_json TEXT NOT NULL,
          correct_option_id TEXT NOT NULL,
          tested_point TEXT NOT NULL,
          selected_option_id TEXT,
          is_correct INTEGER,
          elapsed_ms INTEGER,
          created_at TEXT NOT NULL,
          answered_at TEXT
        );

        CREATE TABLE study_cards (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          card_type TEXT NOT NULL,
          title TEXT NOT NULL,
          content_json TEXT NOT NULL,
          source_action_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          saved_at TEXT
        );

        INSERT INTO model_profiles VALUES (
          'prof_legacy', 'Legacy', 'openai_compatible', 'https://example.com/v1',
          'legacy-model', 'ciphertext', '****key', '[]', 1, NULL, NULL, NULL,
          30000, 0.2, 1200, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'
        );
        INSERT INTO sessions VALUES (
          'sess_active', 'junior', 'math', 'prof_legacy', 'legacy problem',
          'legacy thought', 'diagnosing', NULL, NULL,
          '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'
        );
        INSERT INTO messages VALUES (
          'msg_legacy', 'sess_active', 'student', 'legacy answer', '{}',
          '2026-07-01T00:00:01Z'
        );
        INSERT INTO checkpoints VALUES (
          'chk_legacy', 'sess_active', 'legacy question', '{}', 'A', 'legacy point',
          NULL, NULL, NULL, '2026-07-01T00:00:02Z', NULL
        );
        INSERT INTO study_cards VALUES (
          'card_saved_active', 'sess_active', 'knowledge_card', 'saved active', '{}',
          'act_legacy', 'msg_legacy', '2026-07-01T00:00:03Z', '2026-07-01T00:00:04Z'
        );
        INSERT INTO study_cards VALUES (
          'card_pending', 'sess_active', 'knowledge_card', 'pending', '{}',
          'act_legacy', 'msg_legacy', '2026-07-01T00:00:05Z', NULL
        );
        INSERT INTO study_cards VALUES (
          'card_saved_orphan', 'sess_deleted', 'problem_card', 'saved orphan', '{}',
          'act_deleted', 'msg_deleted', '2026-07-01T00:00:06Z', '2026-07-01T00:00:07Z'
        );
        """
    )
    conn.commit()
    conn.close()


def _insert_reliability_fixture(db: Database) -> None:
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO model_profiles (
              id, display_name, provider, base_url, model, api_key_ciphertext,
              api_key_mask, created_at, updated_at
            ) VALUES ('prof_1', 'Profile', 'local_demo', 'https://local.demo/v1',
                      'local-demo', 'ciphertext', '****text', 'now', 'now')
            """
        )
        conn.execute(
            """
            INSERT INTO sessions (
              id, grade_band, subject, model_profile_id, problem_text,
              student_initial_thought, phase, created_at, updated_at
            ) VALUES ('sess_1', 'junior', 'math', 'prof_1', 'problem', '',
                      'diagnosing', 'now', 'now')
            """
        )
        conn.execute(
            """
            INSERT INTO messages (
              id, session_id, role, content, action, metadata_json, created_at
            ) VALUES ('msg_1', 'sess_1', 'student', 'answer', 'STUDENT_RESPONSE',
                      '{}', 'now')
            """
        )
        conn.execute(
            """
            INSERT INTO checkpoints (
              id, session_id, question, options_json, correct_option_id,
              tested_point, created_at
            ) VALUES ('chk_1', 'sess_1', 'question', '{}', 'A', 'point', 'now')
            """
        )
        for card_id, saved_at in (("card_pending", None), ("card_saved", "now")):
            conn.execute(
                """
                INSERT INTO study_cards (
                  id, session_id, live_session_id, card_type, title, content_json,
                  source_action_id, source_message_id, created_at, saved_at
                ) VALUES (?, 'sess_1', 'sess_1', 'knowledge_card', ?, '{}',
                          'act_1', 'msg_1', 'now', ?)
                """,
                (card_id, card_id, saved_at),
            )


def test_fresh_database_uses_alembic_and_sqlite_reliability_pragmas(tmp_path: Path):
    db = Database(tmp_path / "app.db")

    with db.connect() as conn:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == SQLITE_BUSY_TIMEOUT_MS
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0015_mistake_set_problem_cards"
        )
        run_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(session_runs)")
        }
        run_indexes = {
            row["name"] for row in conn.execute("PRAGMA index_list(session_runs)")
        }
        assert "client_run_id" in run_columns
        assert "uq_session_runs_client_run" in run_indexes

        session_fks = {
            (row["from"], row["table"], row["on_delete"])
            for row in conn.execute("PRAGMA foreign_key_list(sessions)")
        }
        message_fks = {
            (row["from"], row["table"], row["on_delete"])
            for row in conn.execute("PRAGMA foreign_key_list(messages)")
        }
        checkpoint_fks = {
            (row["from"], row["table"], row["on_delete"])
            for row in conn.execute("PRAGMA foreign_key_list(checkpoints)")
        }
        card_fks = {
            (row["from"], row["table"], row["on_delete"])
            for row in conn.execute("PRAGMA foreign_key_list(study_cards)")
        }
        assert ("model_profile_id", "model_profiles", "RESTRICT") in session_fks
        assert ("paper_id", "exam_papers", "SET NULL") in session_fks
        assert ("session_id", "sessions", "CASCADE") in message_fks
        assert ("session_id", "sessions", "CASCADE") in checkpoint_fks
        assert ("live_session_id", "sessions", "SET NULL") in card_fks
        assert ("folder_id", "card_folders", "RESTRICT") in card_fks
        checkpoint_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(checkpoints)")
        }
        assert "free_text_response" in checkpoint_columns
        card_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(study_cards)")
        }
        assert "deferred_at" in card_columns
        mistake_item_fks = {
            (row["from"], row["table"], row["on_delete"])
            for row in conn.execute("PRAGMA foreign_key_list(mistake_set_items)")
        }
        assert ("mistake_set_id", "mistake_sets", "CASCADE") in mistake_item_fks
        assert ("source_session_id", "sessions", "SET NULL") in mistake_item_fks
        mistake_item_indexes = {
            row["name"] for row in conn.execute("PRAGMA index_list(mistake_set_items)")
        }
        assert "idx_mistake_set_items_set" in mistake_item_indexes
        assert "idx_mistake_set_items_source" in mistake_item_indexes
        mistake_item_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(mistake_set_items)")
        }
        assert "problem_card_json" in mistake_item_columns
        defaults = conn.execute(
            """
            SELECT name, default_card_type FROM card_folders
            WHERE default_card_type IS NOT NULL
            ORDER BY default_card_type
            """
        ).fetchall()
        assert [tuple(row) for row in defaults] == [
            ("默认知识卡片", "knowledge_card"),
            ("默认题目卡片", "problem_card"),
        ]

        message_indexes = {
            row["name"] for row in conn.execute("PRAGMA index_list(messages)")
        }
        assert "idx_messages_session_created" in message_indexes
        assert "idx_messages_session_reply" in message_indexes


def test_paper_archive_migration_adopts_folders_and_backfills_cards_and_events(
    tmp_path: Path,
):
    path = tmp_path / "paper-archive-upgrade.db"
    _create_0012_archive_fixture(path)

    _upgrade_database(path, "head")
    Database(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0015_mistake_set_problem_cards"
        )
        folder_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(card_folders)")
        }
        assert {"managed_kind", "managed_key"} <= folder_columns

        root = conn.execute(
            "SELECT * FROM card_folders WHERE managed_key = ? COLLATE NOCASE",
            ("paper-archive-root:v1",),
        ).fetchone()
        assert root is not None
        assert root["id"] == "folder_existing_archive_root"
        assert root["managed_kind"] == "paper_archive_root"
        existing_child = conn.execute(
            "SELECT * FROM card_folders WHERE id = 'folder_existing_exam'"
        ).fetchone()
        assert existing_child["parent_id"] == root["id"]
        assert existing_child["managed_kind"] == "paper_archive"
        assert existing_child["managed_key"] == "paper-archive:v1:期中 a 卷"

        papers = {
            row["id"]: row
            for row in conn.execute("SELECT * FROM exam_papers ORDER BY id")
        }
        assert papers["paper_fixture_a"]["card_folder_id"] == existing_child["id"]
        paper_b_folder = conn.execute(
            "SELECT * FROM card_folders WHERE id = ?",
            (papers["paper_fixture_b"]["card_folder_id"],),
        ).fetchone()
        assert papers["paper_fixture_b"]["name"] == "期末 B 卷"
        assert paper_b_folder["name"] == "期末 B 卷"
        assert paper_b_folder["parent_id"] == root["id"]
        assert paper_b_folder["managed_kind"] == "paper_archive"

        cards = {
            row["id"]: row["folder_id"]
            for row in conn.execute("SELECT id, folder_id FROM study_cards")
        }
        assert cards["card_saved_default"] == existing_child["id"]
        assert cards["card_pending_default"] == existing_child["id"]
        assert cards["card_problem_default"] == paper_b_folder["id"]
        assert cards["card_custom"] == "folder_custom"
        assert cards["card_no_live_session"] == "folder_default_knowledge"

        events = {
            row["id"]: json.loads(row["data_json"])
            for row in conn.execute(
                "SELECT id, data_json FROM session_events WHERE type = 'card.ready'"
            )
        }
        assert events["evt_saved"] == {
            "card_id": "card_saved_default",
            "folder_id": existing_child["id"],
            "other": "kept",
        }
        assert events["evt_pending"] == {
            "card_id": "card_pending_default",
            "folder_id": existing_child["id"],
            "other": "kept",
        }
        assert events["evt_problem"]["folder_id"] == paper_b_folder["id"]

        paper_fks = {
            (row["from"], row["table"], row["on_delete"])
            for row in conn.execute("PRAGMA foreign_key_list(exam_papers)")
        }
        assert ("card_folder_id", "card_folders", "RESTRICT") in paper_fks
        paper_indexes = {
            row["name"] for row in conn.execute("PRAGMA index_list(exam_papers)")
        }
        assert {"uq_exam_papers_name", "uq_exam_papers_card_folder"} <= paper_indexes
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO card_folders (
                  id, name, parent_id, is_system, default_card_type,
                  managed_kind, managed_key, created_at, updated_at
                ) VALUES (
                  'folder_duplicate_key', 'duplicate', NULL, 0, NULL,
                  'paper_archive_root', 'PAPER-ARCHIVE-ROOT:V1', 'now', 'now'
                )
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO card_folders (
                  id, name, parent_id, is_system, default_card_type,
                  managed_kind, managed_key, created_at, updated_at
                ) VALUES (
                  'folder_invalid_managed_pair', 'invalid', NULL, 0, NULL,
                  'paper_archive', NULL, 'now', 'now'
                )
                """
            )
    finally:
        conn.close()


def test_paper_archive_migration_rolls_back_if_pending_card_has_no_ready_event(
    tmp_path: Path,
):
    path = tmp_path / "paper-archive-missing-event.db"
    _create_0012_archive_fixture(path, include_pending_event=False)

    with pytest.raises(RuntimeError, match="pending.*card.ready"):
        _upgrade_database(path, "head")

    conn = sqlite3.connect(path)
    try:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0012_merge_exam_run_heads"
        )
        assert "managed_kind" not in {
            row[1] for row in conn.execute("PRAGMA table_info(card_folders)")
        }
        assert "card_folder_id" not in {
            row[1] for row in conn.execute("PRAGMA table_info(exam_papers)")
        }
    finally:
        conn.close()


def test_paper_archive_migration_downgrade_preserves_folders_and_cards(tmp_path: Path):
    path = tmp_path / "paper-archive-downgrade.db"
    _create_0012_archive_fixture(path)
    _upgrade_database(path, "head")

    with sqlite3.connect(path) as conn:
        paper_folder_id = conn.execute(
            "SELECT card_folder_id FROM exam_papers WHERE id = 'paper_fixture_a'"
        ).fetchone()[0]

    _downgrade_database(path, "0012_merge_exam_run_heads")

    conn = sqlite3.connect(path)
    try:
        assert "managed_kind" not in {
            row[1] for row in conn.execute("PRAGMA table_info(card_folders)")
        }
        assert "card_folder_id" not in {
            row[1] for row in conn.execute("PRAGMA table_info(exam_papers)")
        }
        assert conn.execute(
            "SELECT COUNT(*) FROM card_folders WHERE id = ?", (paper_folder_id,)
        ).fetchone()[0] == 1
        assert conn.execute(
            "SELECT folder_id FROM study_cards WHERE id = 'card_saved_default'"
        ).fetchone()[0] == paper_folder_id
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()


def test_legacy_database_upgrades_repeatably_without_losing_rows(tmp_path: Path):
    path = tmp_path / "legacy.db"
    _create_legacy_database(path)

    db = Database(path)
    Database(path)

    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM model_profiles").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM checkpoints").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM study_cards").fetchone()[0] == 3
        assert conn.execute(
            "SELECT COUNT(*) FROM study_cards WHERE deferred_at IS NOT NULL"
        ).fetchone()[0] == 0
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        profile = conn.execute(
            """
            SELECT max_output_tokens, is_multimodal, reasoning_effort,
                   reasoning_effort_options_json
            FROM model_profiles
            """
        ).fetchone()
        assert tuple(profile) == (8000, 0, "low", '["none","low","high"]')
        message = conn.execute(
            "SELECT action_id, action, in_reply_to_action_id FROM messages"
        ).fetchone()
        assert tuple(message) == (None, "LEGACY_MESSAGE", None)
        session = conn.execute(
            "SELECT problem_image_data_url, restored_from FROM sessions"
        ).fetchone()
        assert tuple(session) == (None, None)

        cards = {
            row["id"]: row
            for row in conn.execute(
                "SELECT id, session_id, live_session_id, saved_at, folder_id FROM study_cards"
            )
        }
        assert cards["card_saved_active"]["live_session_id"] == "sess_active"
        assert cards["card_pending"]["live_session_id"] == "sess_active"
        assert cards["card_saved_orphan"]["session_id"] == "sess_deleted"
        assert cards["card_saved_orphan"]["live_session_id"] is None
        assert cards["card_saved_active"]["folder_id"] == "folder_default_knowledge"
        assert cards["card_pending"]["folder_id"] == "folder_default_knowledge"
        assert cards["card_saved_orphan"]["folder_id"] == "folder_default_problem"


def test_database_constraints_cascade_and_preserve_archived_cards(tmp_path: Path):
    db = Database(tmp_path / "app.db")
    _insert_reliability_fixture(db)

    with db.connect() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO messages (
                  id, session_id, role, content, action, metadata_json, created_at
                ) VALUES ('msg_orphan', 'missing', 'student', 'answer',
                          'STUDENT_RESPONSE', '{}', 'now')
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM model_profiles WHERE id = 'prof_1'")

        conn.execute("DELETE FROM sessions WHERE id = 'sess_1'")

        assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM checkpoints").fetchone()[0] == 0
        cards = conn.execute(
            "SELECT id, session_id, live_session_id FROM study_cards"
        ).fetchall()
        assert [row["id"] for row in cards] == ["card_saved"]
        assert cards[0]["session_id"] == "sess_1"
        assert cards[0]["live_session_id"] is None

        conn.execute("DELETE FROM model_profiles WHERE id = 'prof_1'")


def test_sqlite_busy_retry_replays_the_whole_rolled_back_transaction(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    db = Database(tmp_path / "busy-retry.db")
    with db.connect() as conn:
        conn.execute("CREATE TABLE retry_probe (value TEXT NOT NULL)")

    attempts = 0
    slept: list[float] = []

    def operation() -> str:
        nonlocal attempts
        attempts += 1
        with db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("INSERT INTO retry_probe (value) VALUES ('once')")
            if attempts < 3:
                raise sqlite3.OperationalError("database is locked")
        return "committed"

    monkeypatch.setattr("app.storage.database.time.sleep", slept.append)

    assert db.retry_busy(operation) == "committed"
    assert attempts == 3
    assert slept == list(SQLITE_BUSY_RETRY_DELAYS_SECONDS)
    with db.connect() as conn:
        rows = conn.execute("SELECT value FROM retry_probe").fetchall()
        assert [tuple(row) for row in rows] == [("once",)]


def test_sqlite_busy_retry_is_bounded_and_does_not_retry_other_errors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    db = Database(tmp_path / "bounded-retry.db")
    attempts = 0
    monkeypatch.setattr("app.storage.database.time.sleep", lambda _: None)

    def always_busy() -> None:
        nonlocal attempts
        attempts += 1
        raise sqlite3.OperationalError("database table is locked")

    with pytest.raises(sqlite3.OperationalError, match="locked"):
        db.retry_busy(always_busy)
    assert attempts == len(SQLITE_BUSY_RETRY_DELAYS_SECONDS) + 1

    attempts = 0

    def invalid_sql() -> None:
        nonlocal attempts
        attempts += 1
        raise sqlite3.OperationalError("no such table: missing")

    with pytest.raises(sqlite3.OperationalError, match="no such table"):
        db.retry_busy(invalid_sql)
    assert attempts == 1
