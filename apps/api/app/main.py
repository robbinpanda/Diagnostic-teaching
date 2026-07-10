from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import load_settings
from app.routes import chat, checkpoints, model_profiles, problem_images, sessions
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger


def create_app() -> FastAPI:
    settings = load_settings()
    settings.log_path.parent.mkdir(parents=True, exist_ok=True)
    settings.session_log_dir.mkdir(parents=True, exist_ok=True)
    db = Database(settings.database_path)
    secrets = SecretBox(settings.secret_path)
    session_logger = SessionLogger(settings.session_log_dir)

    app = FastAPI(title="Diagnostic Math Tutor API", version="0.2.0")
    app.state.settings = settings
    app.state.db = db
    app.state.model_profiles = ModelProfileRepository(db, secrets)
    app.state.sessions = SessionRepository(db)
    app.state.session_logger = session_logger

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(model_profiles.router)
    app.include_router(problem_images.router)
    app.include_router(sessions.router)
    app.include_router(chat.router)
    app.include_router(checkpoints.router)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
