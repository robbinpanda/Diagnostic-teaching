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
                  max_output_tokens INTEGER NOT NULL DEFAULT 1200,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
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

                CREATE TABLE IF NOT EXISTS messages (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  role TEXT NOT NULL,
                  content TEXT NOT NULL,
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
                  selected_option_id TEXT,
                  is_correct INTEGER,
                  elapsed_ms INTEGER,
                  created_at TEXT NOT NULL,
                  answered_at TEXT
                );
                """
            )
