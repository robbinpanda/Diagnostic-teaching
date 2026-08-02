from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import load_settings
from app.llm.opencode_free_models import CATALOG_REFRESH_SECONDS, OpenCodeFreeModelCatalog
from app.routes import (
    card_folders,
    cards,
    chat,
    checkpoints,
    inputs,
    model_profiles,
    problem_images,
    problem_intake,
    session_events,
    sessions,
    speech,
)
from app.services.sensevoice_transcriber import SenseVoiceTranscriber
from app.services.model_profile_seed import sync_bundled_model_seed
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger
APP_VERSION = "0.1.0"
logger = logging.getLogger(__name__)



@asynccontextmanager
async def lifespan(app: FastAPI):
    async def refresh_opencode_free_models() -> None:
        while True:
            models = await app.state.opencode_free_models.refresh()
            app.state.model_profiles.sync_opencode_free_models(models)
            await asyncio.sleep(CATALOG_REFRESH_SECONDS)

    refresh_task = (
        asyncio.create_task(refresh_opencode_free_models())
        if app.state.settings.opencode_catalog_refresh_enabled
        else None
    )
    try:
        yield
    finally:
        if refresh_task is not None:
            refresh_task.cancel()
            with suppress(asyncio.CancelledError):
                await refresh_task


def create_app() -> FastAPI:
    settings = load_settings()
    settings.session_log_dir.mkdir(parents=True, exist_ok=True)
    db = Database(settings.database_path)
    secrets = SecretBox(settings.secret_path)
    session_logger = SessionLogger(settings.session_log_dir)
    opencode_free_models = OpenCodeFreeModelCatalog(settings.root / "data" / "opencode-models.json")

    app = FastAPI(title="Diagnostic Math Tutor API", version=APP_VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db
    app.state.model_profiles = ModelProfileRepository(db, secrets)
    if (
        settings.bundled_model_seed_database_path is not None
        and settings.bundled_model_seed_secret_path is not None
    ):
        app.state.bundled_model_seed_sync = sync_bundled_model_seed(
            app.state.model_profiles,
            settings.bundled_model_seed_database_path,
            settings.bundled_model_seed_secret_path,
            settings.database_path.parent / "bundled-model-seed-state.json",
            bundle_version=settings.bundled_model_seed_version,
        )
        result = app.state.bundled_model_seed_sync
        logger.info(
            "Bundled model seed %s (created=%s updated=%s disabled=%s)",
            result.status,
            result.created,
            result.updated,
            result.disabled,
        )
    app.state.opencode_free_models = opencode_free_models
    app.state.model_profiles.sync_opencode_free_models(opencode_free_models.current())
    app.state.sessions = SessionRepository(db)
    # A new process cannot know whether an old provider request completed. Never
    # resume durable queued/running rows silently: make the retry decision explicit.
    app.state.recovered_session_runs = app.state.sessions.recover_orphaned_runs()
    app.state.session_logger = session_logger
    app.state.chat_streams = chat.SessionStreamCoordinator()
    app.state.speech_transcriber = SenseVoiceTranscriber(
        model=settings.sensevoice_model,
        vad_model=settings.sensevoice_vad_model,
        device=settings.sensevoice_device,
        stream_segment_seconds=settings.sensevoice_stream_segment_seconds,
        commit_silence_ms=settings.sensevoice_commit_silence_ms,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(model_profiles.router)
    app.include_router(problem_images.router)
    app.include_router(problem_intake.router)
    app.include_router(sessions.router)
    app.include_router(inputs.router)
    app.include_router(session_events.router)
    app.include_router(chat.router)
    app.include_router(checkpoints.router)
    app.include_router(card_folders.router)
    app.include_router(cards.router)
    app.include_router(speech.router)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
