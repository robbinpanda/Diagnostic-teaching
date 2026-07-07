from pathlib import Path

from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate
from app.main import create_app
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox


def test_local_demo_chat_stream_emits_checkpoint(tmp_path: Path):
    app = create_app()
    db = Database(tmp_path / "app.db")
    app.state.db = db
    app.state.model_profiles = ModelProfileRepository(db, SecretBox(tmp_path / "secret.key"))
    app.state.sessions = SessionRepository(db)

    profile = app.state.model_profiles.create(
        ModelProfileCreate(
            display_name="Local Demo",
            provider="local_demo",
            base_url="https://local.demo/v1",
            api_key="demo-key",
            model="local-demo",
        )
    )
    session = app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile["id"],
            problem_text="已知 y=-2(x-3)^2+5，求最大值。",
            student_initial_thought="我不知道为什么最大值是 5。",
        )
    )

    client = TestClient(app)
    response = client.post("/api/chat/stream", json={"session_id": session["id"]})

    assert response.status_code == 200
    body = response.text
    assert "event: decision" in body
    assert "event: checkpoint_ready" in body
    assert "平方项" in body
