from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate, TutorTurn
from app.main import create_app
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger


def _bootstrap_app(tmp_path: Path) -> tuple[TestClient, str]:
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
    session = app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile["id"],
            problem_text="解方程 x + 1 = 2。",
            student_initial_thought="两边同时减一。",
        )
    )
    return TestClient(app), session["id"]


def _pending_knowledge_card(client: TestClient, session_id: str):
    turn = TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "context_status": "ready",
            "action": "EXPLAIN_PRINCIPLE",
            "message": "等式两边做相同运算，等式仍成立。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": "等式的基本性质",
                "knowledge_point": "等式两边同加、同减一个数",
                "core_idea": "保持两边平衡",
                "derivation_steps": [{"title": "同减", "content": "两边同时减一"}],
                "when_to_use": ["解方程"],
                "common_mistakes": ["只改一边"],
                "connection_to_problem": "本题两边同时减一",
            },
        }
    )
    _, _, card = client.app.state.sessions.record_tutor_action(session_id, turn, action_index=0)
    return card


def test_folder_tree_and_card_file_operations(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    defaults = client.get("/api/card-folders")
    assert defaults.status_code == 200
    assert [(folder["name"], folder["is_system"]) for folder in defaults.json()["folders"]] == [
        ("默认知识卡片", True),
        ("默认题目卡片", True),
    ]

    parent = client.post("/api/card-folders", json={"name": "代数"})
    assert parent.status_code == 201
    child = client.post(
        "/api/card-folders",
        json={"name": "一元一次方程", "parent_id": parent.json()["id"]},
    )
    assert child.status_code == 201
    duplicate = client.post(
        "/api/card-folders",
        json={"name": "一元一次方程", "parent_id": parent.json()["id"]},
    )
    assert duplicate.status_code == 409
    cycle = client.patch(
        f"/api/card-folders/{parent.json()['id']}",
        json={"parent_id": child.json()["id"]},
    )
    assert cycle.status_code == 409

    pending = _pending_knowledge_card(client, session_id)
    assert pending["folder_id"] == "folder_default_knowledge"
    saved = client.post(
        f"/api/cards/{pending['id']}/save",
        json={"session_id": session_id, "folder_id": child.json()["id"]},
    )
    assert saved.status_code == 200
    assert saved.json()["folder_id"] == child.json()["id"]

    copied = client.post(
        f"/api/cards/{pending['id']}/copy",
        json={"folder_id": "folder_default_knowledge"},
    )
    assert copied.status_code == 201
    assert copied.json()["id"] != pending["id"]
    assert copied.json()["folder_id"] == "folder_default_knowledge"
    moved = client.patch(
        f"/api/cards/{copied.json()['id']}/move",
        json={"folder_id": child.json()["id"]},
    )
    assert moved.status_code == 200
    assert moved.json()["folder_id"] == child.json()["id"]

    assert client.delete(f"/api/card-folders/{child.json()['id']}").status_code == 409
    assert client.delete("/api/card-folders/folder_default_knowledge").status_code == 409


def test_card_dialog_save_defaults_and_accepts_selected_folder_atomically(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    folder = client.post("/api/card-folders", json={"name": "易错点"}).json()
    pending = _pending_knowledge_card(client, session_id)

    response = client.post(
        f"/api/sessions/{session_id}/inputs",
        json={
            "kind": "CARD_DISMISSED_CONTINUE",
            "client_command_id": f"card:{pending['id']}",
            "card_id": pending["id"],
            "folder_id": folder["id"],
        },
    )
    assert response.status_code == 201
    assert response.json()["folder_id"] == folder["id"]
    stored = client.app.state.sessions.get_card(pending["id"])
    assert stored["saved_at"] is not None
    assert stored["folder_id"] == folder["id"]
