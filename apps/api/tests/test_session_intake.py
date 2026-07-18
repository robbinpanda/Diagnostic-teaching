from pathlib import Path

from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate
from app.main import create_app
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger


def _client_and_profile(tmp_path: Path) -> tuple[TestClient, str]:
    app = create_app()
    db = Database(tmp_path / "app.db")
    app.state.db = db
    app.state.model_profiles = ModelProfileRepository(db, SecretBox(tmp_path / "secret.key"))
    app.state.sessions = SessionRepository(db)
    app.state.session_logger = SessionLogger(tmp_path / "sessions")
    profile = app.state.model_profiles.create(
        ModelProfileCreate(
            display_name="Local Demo",
            provider="local_demo",
            base_url="https://local.demo/v1",
            api_key="demo-key",
            model="local-demo",
        )
    )
    return TestClient(app), profile["id"]


def _intake_payload(profile_id: str, **overrides):
    return {
        "grade_band": "junior",
        "subject": "math",
        "model_profile_id": profile_id,
        "message": "",
        **overrides,
    }


def test_intake_asks_for_thought_before_creating_session(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    first = client.post(
        "/api/sessions/intake",
        json=_intake_payload(profile_id, message="已知 y=-2(x-3)^2+5，求最大值。"),
    )

    assert first.status_code == 200
    assert first.json()["status"] == "needs_thought"
    assert first.json()["session_id"] is None
    assert client.get("/api/sessions/history").json()["sessions"] == []

    second = client.post(
        "/api/sessions/intake",
        json=_intake_payload(
            profile_id,
            problem_text=first.json()["problem_text"],
            message="我知道平方项非负，但不知道负号会怎么影响最大值。",
        ),
    )

    assert second.status_code == 200
    payload = second.json()
    assert payload["status"] == "ready"
    assert payload["session_id"]
    session = client.app.state.sessions.get(payload["session_id"])
    assert session["problem_text"] == "已知 y=-2(x-3)^2+5，求最大值。"
    assert "平方项非负" in session["student_initial_thought"]


def test_intake_accepts_labeled_problem_and_thought_in_one_turn(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    response = client.post(
        "/api/sessions/intake",
        json=_intake_payload(
            profile_id,
            message="题目：计算 2+2。\n我的思路：我算出 4，但不确定书写过程。",
        ),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["problem_text"] == "计算 2+2。"
    assert payload["student_initial_thought"] == "我算出 4，但不确定书写过程。"


def test_intake_can_collect_thought_before_problem(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    response = client.post(
        "/api/sessions/intake",
        json=_intake_payload(profile_id, message="我完全没思路，不知道从哪里开始。"),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "needs_problem"
    assert response.json()["student_initial_thought"] == "我完全没思路，不知道从哪里开始。"


def test_existing_session_can_be_opened_without_copying(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    created = client.post(
        "/api/sessions/intake",
        json=_intake_payload(
            profile_id,
            message="题目：计算 2+2。\n思路：我先把两个 2 相加。",
        ),
    ).json()

    opened = client.get(f"/api/sessions/{created['session_id']}")

    assert opened.status_code == 200
    assert opened.json()["session_id"] == created["session_id"]
    assert opened.json()["restored_from"] is None
    assert len(client.get("/api/sessions/history").json()["sessions"]) == 1
