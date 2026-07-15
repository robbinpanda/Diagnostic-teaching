from __future__ import annotations

import sqlite3
from pathlib import Path


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS model_profiles (
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
                  max_output_tokens INTEGER NOT NULL DEFAULT 8000,
                  is_multimodal INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
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
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS messages (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  role TEXT NOT NULL,
                  content TEXT NOT NULL,
                  action_id TEXT,
                  action TEXT NOT NULL DEFAULT 'LEGACY_MESSAGE',
                  in_reply_to_action_id TEXT,
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS checkpoints (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  question TEXT NOT NULL,
                  options_json TEXT NOT NULL,
                  correct_option_id TEXT NOT NULL,
                  tested_point TEXT NOT NULL,
                  source_action_id TEXT,
                  selected_option_id TEXT,
                  is_correct INTEGER,
                  elapsed_ms INTEGER,
                  created_at TEXT NOT NULL,
                  answered_at TEXT
                );

                CREATE TABLE IF NOT EXISTS study_cards (
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

                CREATE INDEX IF NOT EXISTS idx_study_cards_session_saved
                ON study_cards(session_id, saved_at, created_at);

                CREATE INDEX IF NOT EXISTS idx_study_cards_global_saved
                ON study_cards(saved_at, created_at);
                """
            )
            added_multimodal_column = self._ensure_column(
                conn,
                "model_profiles",
                "is_multimodal",
                "INTEGER NOT NULL DEFAULT 0",
            )
            if added_multimodal_column:
                conn.execute(
                    """
                    UPDATE model_profiles
                    SET max_output_tokens = 8000
                    WHERE max_output_tokens = 1200
                    """
                )
            self._ensure_column(
                conn,
                "sessions",
                "problem_image_data_url",
                "TEXT",
            )
            self._ensure_column(conn, "sessions", "restored_from", "TEXT")
            self._ensure_column(conn, "messages", "action_id", "TEXT")
            self._ensure_column(
                conn,
                "messages",
                "action",
                "TEXT NOT NULL DEFAULT 'LEGACY_MESSAGE'",
            )
            self._ensure_column(conn, "messages", "in_reply_to_action_id", "TEXT")
            self._ensure_column(conn, "checkpoints", "source_action_id", "TEXT")

    def _ensure_column(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        column_name: str,
        definition: str,
    ) -> bool:
        columns = {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        if column_name not in columns:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
            return True
        return False
