from __future__ import annotations

from pathlib import Path

import pytest
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


def _pending_problem_card(client: TestClient, session_id: str, *, title: str = "一元一次方程"):
    turn = TutorTurn.model_validate(
        {
            "state_hint": "summarizing",
            "context_status": "ready",
            "action": "SUMMARIZE",
            "message": "把这道题整理成题目卡片。",
            "problem_card": {
                "type": "problem_card",
                "title": title,
                "problem_summary": "解方程 x + 1 = 2。",
                "solution_overview": "利用等式的基本性质移项。",
                "solution_steps": [
                    {
                        "step": 1,
                        "title": "两边减一",
                        "reasoning": "等式两边同时减一仍相等。",
                        "result": "x = 1",
                    }
                ],
                "pitfalls": ["只在一边减一"],
                "how_to_think": ["先保持等式两边平衡"],
                "final_answer": "x = 1",
            },
        }
    )
    _, _, card = client.app.state.sessions.record_tutor_action(session_id, turn, action_index=1)
    return card


def _paper_session(client: TestClient, source_session_id: str):
    source = client.app.state.sessions.get(source_session_id)
    paper = client.app.state.sessions.create_exam_paper("函数练习")
    session = client.app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=source["model_profile_id"],
            paper_id=paper["id"],
            problem_text="求函数最值。",
            student_initial_thought="先配方。",
        )
    )
    return paper, session["id"]


def test_folder_tree_and_card_file_operations(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    defaults = client.get("/api/card-folders")
    assert defaults.status_code == 200
    folders = {folder["name"]: folder for folder in defaults.json()["folders"]}
    assert folders["默认知识卡片"]["is_system"] is True
    assert folders["默认题目卡片"]["is_system"] is True
    assert folders["按试卷归档"]["managed_kind"] == "paper_archive_root"

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


def test_paper_session_cards_share_archive_folder_and_ready_event(tmp_path: Path):
    client, source_session_id = _bootstrap_app(tmp_path)
    paper, session_id = _paper_session(client, source_session_id)

    knowledge = _pending_knowledge_card(client, session_id)
    problem = _pending_problem_card(client, session_id)

    assert knowledge["folder_id"] == paper["card_folder_id"]
    assert problem["folder_id"] == paper["card_folder_id"]
    events = client.get(f"/api/sessions/{session_id}/events").json()["events"]
    ready_folders = {
        event["data"]["card_id"]: event["data"]["folder_id"]
        for event in events
        if event["type"] == "card.ready"
    }
    assert ready_folders == {
        knowledge["id"]: paper["card_folder_id"],
        problem["id"]: paper["card_folder_id"],
    }


def test_omitted_save_uses_generated_folder_while_explicit_selection_wins(tmp_path: Path):
    client, source_session_id = _bootstrap_app(tmp_path)
    paper, session_id = _paper_session(client, source_session_id)
    custom = client.post("/api/card-folders", json={"name": "我的精选"}).json()

    knowledge = _pending_knowledge_card(client, session_id)
    saved_knowledge = client.post(
        f"/api/sessions/{session_id}/inputs",
        json={
            "kind": "CARD_DISMISSED_CONTINUE",
            "client_command_id": f"card:{knowledge['id']}",
            "card_id": knowledge["id"],
        },
    )
    assert saved_knowledge.status_code == 201
    assert saved_knowledge.json()["folder_id"] == paper["card_folder_id"]

    problem = _pending_problem_card(client, session_id)
    saved_problem = client.post(
        f"/api/cards/{problem['id']}/save",
        json={"session_id": session_id},
    )
    assert saved_problem.status_code == 200
    assert saved_problem.json()["folder_id"] == paper["card_folder_id"]

    explicitly_placed = _pending_problem_card(client, session_id, title="显式归档")
    selected = client.post(
        f"/api/cards/{explicitly_placed['id']}/save",
        json={"session_id": session_id, "folder_id": custom["id"]},
    )
    assert selected.status_code == 200
    assert selected.json()["folder_id"] == custom["id"]


@pytest.mark.parametrize("status", ["queued", "running"])
def test_delete_all_cards_rejects_durable_active_run(tmp_path: Path, status: str):
    client, session_id = _bootstrap_app(tmp_path)
    card = _pending_knowledge_card(client, session_id)
    run = client.app.state.sessions.create_run(session_id)
    if status == "running":
        client.app.state.sessions.mark_run_running(run["id"])

    response = client.delete("/api/cards")

    assert response.status_code == 409
    assert response.json()["detail"] == "仍有答疑正在生成，请等待完成后再清空全部卡片"
    assert client.app.state.sessions.get_card(card["id"])["id"] == card["id"]
