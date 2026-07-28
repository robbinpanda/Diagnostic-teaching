from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def workspace_root() -> Path:
    return Path(__file__).resolve().parents[4]


@dataclass(frozen=True)
class Settings:
    root: Path
    database_path: Path
    secret_path: Path
    session_log_dir: Path
    sensevoice_model: str
    sensevoice_vad_model: str
    sensevoice_device: str
    sensevoice_max_audio_seconds: int
    sensevoice_commit_silence_ms: int


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
    load_dotenv(root / ".env")
    database_path = _sqlite_path_from_url(os.getenv("DATABASE_URL"), root)
    secret_path = Path(os.getenv("APP_SECRET_PATH", root / "data" / "app-secret.key"))
    if not secret_path.is_absolute():
        secret_path = root / secret_path
    session_log_dir = Path(os.getenv("SESSION_LOG_DIR", root / "logs" / "sessions"))
    if not session_log_dir.is_absolute():
        session_log_dir = root / session_log_dir
    try:
        sensevoice_max_audio_seconds = int(os.getenv("SENSEVOICE_MAX_AUDIO_SECONDS", "60"))
    except ValueError:
        sensevoice_max_audio_seconds = 60
    sensevoice_max_audio_seconds = max(5, min(sensevoice_max_audio_seconds, 300))
    try:
        sensevoice_commit_silence_ms = int(
            os.getenv("SENSEVOICE_COMMIT_SILENCE_MS", "2500")
        )
    except ValueError:
        sensevoice_commit_silence_ms = 2500
    sensevoice_commit_silence_ms = max(1000, min(sensevoice_commit_silence_ms, 10_000))
    return Settings(
        root=root,
        database_path=database_path,
        secret_path=secret_path,
        session_log_dir=session_log_dir,
        sensevoice_model=os.getenv("SENSEVOICE_MODEL", "iic/SenseVoiceSmall"),
        sensevoice_vad_model=os.getenv("SENSEVOICE_VAD_MODEL", "fsmn-vad"),
        sensevoice_device=os.getenv("SENSEVOICE_DEVICE", "cpu"),
        sensevoice_max_audio_seconds=sensevoice_max_audio_seconds,
        sensevoice_commit_silence_ms=sensevoice_commit_silence_ms,
    )
