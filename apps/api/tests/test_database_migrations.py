from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.storage.database import Database, SQLITE_BUSY_TIMEOUT_MS


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
            "0004_session_runs"
        )

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
        assert ("session_id", "sessions", "CASCADE") in message_fks
        assert ("session_id", "sessions", "CASCADE") in checkpoint_fks
        assert ("live_session_id", "sessions", "SET NULL") in card_fks

        message_indexes = {
            row["name"] for row in conn.execute("PRAGMA index_list(messages)")
        }
        assert "idx_messages_session_created" in message_indexes
        assert "idx_messages_session_reply" in message_indexes


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
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        profile = conn.execute(
            "SELECT max_output_tokens, is_multimodal FROM model_profiles"
        ).fetchone()
        assert tuple(profile) == (8000, 0)
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
                "SELECT id, session_id, live_session_id, saved_at FROM study_cards"
            )
        }
        assert cards["card_saved_active"]["live_session_id"] == "sess_active"
        assert cards["card_pending"]["live_session_id"] == "sess_active"
        assert cards["card_saved_orphan"]["session_id"] == "sess_deleted"
        assert cards["card_saved_orphan"]["live_session_id"] is None


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
