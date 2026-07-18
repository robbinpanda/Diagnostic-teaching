from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config


SQLITE_BUSY_TIMEOUT_MS = 5_000
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


class Database:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.upgrade_schema()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            self.path,
            timeout=SQLITE_BUSY_TIMEOUT_MS / 1_000,
        )
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
        except Exception:
            conn.close()
            raise
        return conn

    def upgrade_schema(self) -> None:
        """Upgrade fresh and legacy databases through the Alembic revision chain."""
        config = Config(str(ALEMBIC_INI))
        config.set_main_option("script_location", str(MIGRATIONS_DIR))
        config.attributes["database_path"] = self.path
        command.upgrade(config, "head")
