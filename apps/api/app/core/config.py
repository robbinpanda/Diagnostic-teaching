from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def workspace_root() -> Path:
    return Path(__file__).resolve().parents[4]


@dataclass(frozen=True)
class Settings:
    root: Path
    database_path: Path
    secret_path: Path
    log_path: Path
    session_log_dir: Path
    show_debug_panel: bool


def _sqlite_path_from_url(value: str | None, root: Path) -> Path:
    if not value:
        return root / "data" / "app.db"
    if value.startswith("sqlite:///"):
        raw_path = value.removeprefix("sqlite:///")
        path = Path(raw_path)
        return path if path.is_absolute() else root / path
    return root / value


def load_settings() -> Settings:
    root = workspace_root()
    database_path = _sqlite_path_from_url(os.getenv("DATABASE_URL"), root)
    secret_path = Path(os.getenv("APP_SECRET_PATH", root / "data" / "app-secret.key"))
    if not secret_path.is_absolute():
        secret_path = root / secret_path
    log_path = Path(os.getenv("LOG_PATH", root / "logs" / "events.jsonl"))
    if not log_path.is_absolute():
        log_path = root / log_path
    session_log_dir = Path(os.getenv("SESSION_LOG_DIR", root / "logs" / "sessions"))
    if not session_log_dir.is_absolute():
        session_log_dir = root / session_log_dir
    return Settings(
        root=root,
        database_path=database_path,
        secret_path=secret_path,
        log_path=log_path,
        session_log_dir=session_log_dir,
        show_debug_panel=os.getenv("SHOW_DEBUG_PANEL", "true").lower() == "true",
    )
