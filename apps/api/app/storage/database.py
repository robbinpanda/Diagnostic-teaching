from __future__ import annotations

import functools
import logging
import sqlite3
import time
from collections.abc import Callable
from pathlib import Path
from typing import ParamSpec, TypeVar

from alembic import command
from alembic.config import Config

SQLITE_BUSY_TIMEOUT_MS = 5_000
SQLITE_BUSY_RETRY_DELAYS_SECONDS = (0.05, 0.15)
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"
LOGGER = logging.getLogger(__name__)
P = ParamSpec("P")
T = TypeVar("T")


def is_sqlite_busy_error(error: BaseException) -> bool:
    if not isinstance(error, sqlite3.OperationalError):
        return False
    code = getattr(error, "sqlite_errorcode", None)
    if code in {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED}:
        return True
    message = str(error).lower()
    return "database is locked" in message or "database table is locked" in message


def with_sqlite_busy_retry(operation: Callable[P, T]) -> Callable[P, T]:
    """Replay an entire repository operation after its transaction rolls back."""

    @functools.wraps(operation)
    def wrapped(owner, *args: P.args, **kwargs: P.kwargs) -> T:
        database = owner if isinstance(owner, Database) else owner.db
        return database.retry_busy(lambda: operation(owner, *args, **kwargs))

    return wrapped


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

    def retry_busy(self, operation: Callable[[], T]) -> T:
        """Retry a complete transaction boundary on transient SQLite contention.

        Callers must let their connection context roll back before the busy error
        escapes. The callback is then invoked from its beginning with the same
        request-level ids, preserving atomicity and idempotency.
        """

        for retry_index in range(len(SQLITE_BUSY_RETRY_DELAYS_SECONDS) + 1):
            try:
                return operation()
            except sqlite3.OperationalError as error:
                if not is_sqlite_busy_error(error):
                    raise
                if retry_index >= len(SQLITE_BUSY_RETRY_DELAYS_SECONDS):
                    raise
                delay = SQLITE_BUSY_RETRY_DELAYS_SECONDS[retry_index]
                LOGGER.warning(
                    "SQLite write contention; replaying transaction (retry=%s, delay_ms=%s)",
                    retry_index + 1,
                    round(delay * 1_000),
                )
                time.sleep(delay)
        raise RuntimeError("SQLite busy retry loop exhausted unexpectedly")

    def upgrade_schema(self) -> None:
        """Upgrade fresh and legacy databases through the Alembic revision chain."""
        config = Config(str(ALEMBIC_INI))
        config.set_main_option("script_location", str(MIGRATIONS_DIR))
        config.attributes["database_path"] = self.path
        command.upgrade(config, "head")
