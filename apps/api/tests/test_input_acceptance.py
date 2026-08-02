from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate, TutorTurn
from app.main import create_app
from app.services.input_acceptance import InputAcceptanceService
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
            problem_text="已知 y=-2(x-3)^2+5，求最大值。",
            student_initial_thought="我不知道为什么最大值是 5。",
        )
    )
    return TestClient(app), session["id"]


def _checkpoint_id(client: TestClient, session_id: str) -> str:
    response = client.post("/api/chat/stream", json={"session_id": session_id})
    for block in response.text.split("\n\n"):
        if "event: checkpoint_ready" not in block:
            continue
        data = next(line for line in block.splitlines() if line.startswith("data: "))
        import json

        return json.loads(data.removeprefix("data: "))["id"]
    raise AssertionError("checkpoint_ready was not emitted")


def test_student_message_first_accept_retry_and_id_conflict(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    body = {
        "kind": "STUDENT_MESSAGE",
        "client_message_id": "client-msg-1",
        "message": "我觉得最大值和平方项有关。",
    }

    first = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    retry = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    conflict = client.post(
        f"/api/sessions/{session_id}/inputs",
        json={**body, "message": "我改成另一个答案。"},
    )

    assert first.status_code == 201
    assert first.json()["status"] == "accepted"
    assert retry.status_code == 200
    assert retry.json()["status"] == "duplicate"
    assert retry.json()["input_id"] == first.json()["input_id"]
    assert retry.json()["message_id"] == first.json()["message_id"]
    assert retry.json()["action_id"] == first.json()["action_id"]
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_CONFLICT"
    assert len(client.app.state.sessions.list_inputs(session_id)) == 1
    assert len(client.app.state.sessions.list_messages(session_id)) == 1


def test_double_click_with_same_client_message_id_accepts_once(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)

    def accept_once():
        return InputAcceptanceService(client.app.state.sessions).accept_student_message(
            session_id,
            client_message_id="double-click-1",
            message="同一次点击产生的消息",
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: accept_once(), range(2)))

    assert sorted(result.accepted for result in results) == [False, True]
    assert len({result.input_row["id"] for result in results}) == 1
    assert len(client.app.state.sessions.list_inputs(session_id)) == 1
    assert len(client.app.state.sessions.list_messages(session_id)) == 1


def test_student_input_and_message_are_one_transaction(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            CREATE TRIGGER reject_student_message
            BEFORE INSERT ON messages
            WHEN NEW.role = 'student'
            BEGIN
              SELECT RAISE(ABORT, 'forced student message failure');
            END;
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="forced student message failure"):
        InputAcceptanceService(client.app.state.sessions).accept_student_message(
            session_id,
            client_message_id="atomic-message-1",
            message="这条消息必须与输入记录一起回滚",
        )

    assert client.app.state.sessions.list_inputs(session_id) == []
    assert client.app.state.sessions.list_messages(session_id) == []


def test_checkpoint_same_answer_retry_returns_original_and_different_answer_conflicts(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    checkpoint_id = _checkpoint_id(client, session_id)
    url = f"/api/checkpoints/{checkpoint_id}/answer"

    first = client.post(
        url,
        json={"session_id": session_id, "selected_option_id": "B", "elapsed_ms": 900},
    )
    retry = client.post(
        url,
        json={"session_id": session_id, "selected_option_id": "B", "elapsed_ms": 5000},
    )
    conflict = client.post(
        url,
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 1000},
    )

    assert first.status_code == 200
    assert first.json()["status"] == "accepted"
    assert retry.status_code == 200
    assert retry.json()["status"] == "duplicate"
    assert retry.json()["input_id"] == first.json()["input_id"]
    assert retry.json()["action_id"] == first.json()["action_id"]
    assert retry.json()["student_message"] == first.json()["student_message"]
    assert retry.json()["elapsed_ms"] == first.json()["elapsed_ms"] == 900
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "CHECKPOINT_ANSWER_CONFLICT"
    checkpoint = client.app.state.sessions.get_checkpoint(checkpoint_id)
    assert checkpoint["selected_option_id"] == "B"
    assert checkpoint["elapsed_ms"] == 900
    checkpoint_inputs = [
        row for row in client.app.state.sessions.list_inputs(session_id)
        if row["kind"] == "CHECKPOINT_ANSWER"
    ]
    checkpoint_messages = [
        row for row in client.app.state.sessions.list_messages(session_id)
        if row["action"] == "CHECKPOINT_RESPONSE"
    ]
    assert len(checkpoint_inputs) == 1
    assert len(checkpoint_messages) == 1


def test_checkpoint_input_answer_and_message_roll_back_together(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    checkpoint_id = _checkpoint_id(client, session_id)
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            CREATE TRIGGER reject_checkpoint_response_message
            BEFORE INSERT ON messages
            WHEN NEW.action = 'CHECKPOINT_RESPONSE'
            BEGIN
              SELECT RAISE(ABORT, 'forced checkpoint response failure');
            END;
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="forced checkpoint response failure"):
        InputAcceptanceService(client.app.state.sessions).accept_checkpoint_answer(
            checkpoint_id,
            session_id=session_id,
            selected_option_id="A",
            elapsed_ms=300,
        )

    checkpoint = client.app.state.sessions.get_checkpoint(checkpoint_id)
    assert checkpoint["selected_option_id"] is None
    assert checkpoint["answered_at"] is None
    assert client.app.state.sessions.list_inputs(session_id) == []
    assert not any(
        row["action"] == "CHECKPOINT_RESPONSE"
        for row in client.app.state.sessions.list_messages(session_id)
    )


def test_student_free_text_atomically_completes_pending_checkpoint(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    checkpoint_id = _checkpoint_id(client, session_id)
    original_text = "我不想选，我觉得平方项前面是负数，所以应该取最大值。"
    body = {
        "kind": "STUDENT_MESSAGE",
        "client_message_id": "checkpoint-free-text-1",
        "message": original_text,
    }

    first = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    retry = client.post(f"/api/sessions/{session_id}/inputs", json=body)

    assert first.status_code == 201
    assert retry.status_code == 200
    assert retry.json()["input_id"] == first.json()["input_id"]
    checkpoint = client.app.state.sessions.get_checkpoint(checkpoint_id)
    assert checkpoint["free_text_response"] == original_text
    assert checkpoint["answered_at"] is not None
    assert checkpoint["selected_option_id"] is None
    assert checkpoint["is_correct"] is None

    messages = client.app.state.sessions.list_messages(session_id)
    student = messages[-1]
    assert student["content"] == original_text
    assert student["action"] == "STUDENT_RESPONSE"
    metadata = json.loads(student["metadata_json"])
    assert metadata["checkpoint_free_text_response"] == {
        "checkpoint_id": checkpoint_id,
        "response_text": original_text,
        "response_mode": "free_text",
    }

    restored = client.get(f"/api/sessions/{session_id}")
    assert restored.status_code == 200
    assert restored.json()["pending_checkpoint"] is None
    assert restored.json()["messages"][-1]["text"] == original_text

    option_after_text = client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 1000},
    )
    assert option_after_text.status_code == 409
    assert option_after_text.json()["detail"]["code"] == "CHECKPOINT_ANSWER_CONFLICT"

    events = client.get(f"/api/sessions/{session_id}/events").json()["events"]
    checkpoint_event = next(
        event for event in events
        if event["type"] == "checkpoint.completed"
        and event["data"].get("response_mode") == "free_text"
    )
    assert checkpoint_event["data"]["response_text"] == original_text


def test_free_text_checkpoint_completion_rolls_back_with_student_message(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    checkpoint_id = _checkpoint_id(client, session_id)
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            CREATE TRIGGER reject_free_text_checkpoint_message
            BEFORE INSERT ON messages
            WHEN NEW.role = 'student'
            BEGIN
              SELECT RAISE(ABORT, 'forced free-text response failure');
            END;
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="forced free-text response failure"):
        InputAcceptanceService(client.app.state.sessions).accept_student_message(
            session_id,
            client_message_id="checkpoint-free-text-rollback",
            message="这是不能被部分保存的回答。",
        )

    checkpoint = client.app.state.sessions.get_checkpoint(checkpoint_id)
    assert checkpoint["free_text_response"] is None
    assert checkpoint["answered_at"] is None
    assert client.app.state.sessions.list_inputs(session_id) == []


def test_card_dismiss_continue_is_durable_and_idempotent(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    turn = TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "action": "EXPLAIN_PRINCIPLE",
            "message": "先从平方项非负讲起。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": "平方项非负",
                "knowledge_point": "完全平方的非负性",
                "core_idea": "任意实数的平方都不小于零。",
                "derivation_steps": [{"title": "定义", "content": "$u^2\\ge0$。"}],
                "when_to_use": ["判断含平方项表达式的范围"],
                "common_mistakes": [],
                "connection_to_problem": "用于判断当前函数的最大值。",
            },
        }
    )
    _, _, card = client.app.state.sessions.record_tutor_action(session_id, turn, action_index=0)
    edited_content = turn.knowledge_card.model_dump()
    edited_content["title"] = "平方项非负（学生整理版）"
    edited_content["core_idea"] = "任意实数 $u$ 都满足 $u^2\\ge0$。"
    edited_content["common_mistakes"] = ["把平方项误认为一定大于零"]
    body = {
        "kind": "CARD_DISMISSED_CONTINUE",
        "client_command_id": f"card:{card['id']}",
        "card_id": card["id"],
        "content": edited_content,
    }

    first = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    retry = client.post(f"/api/sessions/{session_id}/inputs", json=body)

    assert first.status_code == 201
    assert first.json()["status"] == "accepted"
    assert retry.status_code == 200
    assert retry.json()["status"] == "duplicate"
    assert retry.json()["input_id"] == first.json()["input_id"]
    saved_card = client.app.state.sessions.get_card(card["id"])
    assert saved_card["saved_at"] is not None
    assert saved_card["title"] == edited_content["title"]
    assert json.loads(saved_card["content_json"]) == edited_content
    control_inputs = [
        row for row in client.app.state.sessions.list_inputs(session_id)
        if row["kind"] == "CARD_DISMISSED_CONTINUE"
    ]
    assert len(control_inputs) == 1

    changed_retry = {
        **body,
        "content": {**edited_content, "core_idea": "另一份内容"},
    }
    conflict = client.post(f"/api/sessions/{session_id}/inputs", json=changed_retry)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_card_can_be_discarded_without_entering_library(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    turn = TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "action": "EXPLAIN_PRINCIPLE",
            "message": "先从平方项非负讲起。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": "平方项非负",
                "knowledge_point": "完全平方的非负性",
                "core_idea": "任意实数的平方都不小于零。",
                "derivation_steps": [{"title": "定义", "content": "$u^2\\ge0$。"}],
                "when_to_use": ["判断含平方项表达式的范围"],
                "common_mistakes": [],
                "connection_to_problem": "用于判断当前函数的最大值。",
            },
        }
    )
    _, _, card = client.app.state.sessions.record_tutor_action(session_id, turn, action_index=0)
    body = {
        "kind": "CARD_DISMISSED_CONTINUE",
        "client_command_id": f"card:{card['id']}",
        "card_id": card["id"],
        "save_to_library": False,
    }

    first = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    retry = client.post(f"/api/sessions/{session_id}/inputs", json=body)

    assert first.status_code == 201
    assert first.json()["card_id"] == card["id"]
    assert first.json()["card_saved_at"] is None
    assert first.json()["card_discarded"] is True
    assert retry.status_code == 200
    assert retry.json()["status"] == "duplicate"
    assert retry.json()["card_id"] == card["id"]
    with pytest.raises(KeyError):
        client.app.state.sessions.get_card(card["id"])
    assert client.app.state.sessions.latest_pending_card(session_id) is None
    assert client.get("/api/cards").json()["cards"] == []
    events = client.get(f"/api/sessions/{session_id}/events").json()["events"]
    assert "card.discarded" in [event["type"] for event in events]
    assert client.post("/api/chat/stream", json={"session_id": session_id}).status_code == 200

    changed_retry = {**body, "save_to_library": True}
    conflict = client.post(f"/api/sessions/{session_id}/inputs", json=changed_retry)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_student_message_defers_pending_card_atomically_and_is_idempotent(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    turn = TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "action": "EXPLAIN_PRINCIPLE",
            "message": "先说明这个知识点。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": "待处理知识点",
                "knowledge_point": "平方非负",
                "core_idea": "任意实数的平方不小于零。",
                "derivation_steps": [{"title": "定义", "content": "$u^2\\ge0$。"}],
                "when_to_use": ["判断范围"],
                "common_mistakes": [],
                "connection_to_problem": "用于当前问题。",
            },
        }
    )
    _, _, card = client.app.state.sessions.record_tutor_action(session_id, turn, action_index=0)
    body = {
        "kind": "STUDENT_MESSAGE",
        "client_message_id": "question-during-card",
        "message": "这里为什么一定非负？",
    }

    first = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    retry = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    second = client.post(
        f"/api/sessions/{session_id}/inputs",
        json={
            "kind": "STUDENT_MESSAGE",
            "client_message_id": "second-question-during-card",
            "message": "那负号又会怎样影响大小？",
        },
    )

    assert first.status_code == 201
    assert first.json()["deferred_card_id"] == card["id"]
    assert first.json()["card_deferred_at"]
    assert retry.status_code == 200
    assert retry.json()["card_deferred_at"] == first.json()["card_deferred_at"]
    assert second.status_code == 201
    assert second.json()["deferred_card_id"] is None
    assert second.json()["card_deferred_at"] is None
    pending = client.app.state.sessions.latest_pending_card(session_id)
    assert pending["deferred_at"] == first.json()["card_deferred_at"]
    messages = client.app.state.sessions.list_messages(session_id)
    assert [row["content"] for row in messages].count(body["message"]) == 1
    event_types = [
        event["type"]
        for event in client.get(f"/api/sessions/{session_id}/events").json()["events"]
    ]
    assert event_types[-3:] == ["card.deferred", "message.completed", "message.completed"]
    assert event_types.count("card.deferred") == 1
    restored = client.get(f"/api/sessions/{session_id}").json()
    assert restored["pending_card"]["deferred_at"] == first.json()["card_deferred_at"]


def test_session_delete_removes_durable_inputs(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    client.post(
        f"/api/sessions/{session_id}/inputs",
        json={
            "kind": "STUDENT_MESSAGE",
            "client_message_id": "delete-me",
            "message": "删除会话时也删除输入",
        },
    )

    assert client.delete(f"/api/sessions/{session_id}").status_code == 204
    assert client.app.state.sessions.list_inputs(session_id) == []


def test_restored_branch_preserves_student_message_idempotency(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    body = {
        "kind": "STUDENT_MESSAGE",
        "client_message_id": "restore-message-1",
        "message": "这条消息在恢复分支中仍可对账。",
    }
    accepted = client.post(f"/api/sessions/{session_id}/inputs", json=body)
    profile_id = client.app.state.sessions.get(session_id)["model_profile_id"]
    restored = client.post(
        "/api/sessions/restore",
        json={"session_id": session_id, "model_profile_id": profile_id},
    )
    restored_session_id = restored.json()["session_id"]

    retry = client.post(f"/api/sessions/{restored_session_id}/inputs", json=body)

    assert accepted.status_code == 201
    assert restored.status_code == 200
    assert restored.json()["messages"][0]["client_message_id"] == "restore-message-1"
    assert retry.status_code == 200
    assert retry.json()["status"] == "duplicate"
    assert len(client.app.state.sessions.list_messages(restored_session_id)) == 1
