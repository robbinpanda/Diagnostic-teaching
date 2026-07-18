"""Small, idempotent SQLite migrations kept separate from the base schema."""

from app.storage.migrations.session_runs import apply_session_runs_migration

__all__ = ["apply_session_runs_migration"]
