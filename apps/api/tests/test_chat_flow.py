import json
import asyncio
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate, TutorTurn
from app.main import create_app
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger
from app.routes.chat import SessionStreamCoordinator


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


def _parse_sse_events(body: str) -> list[tuple[str, dict]]:
    events = []
    for part in body.split("\n\n"):
        event_line = next((l for l in part.split("\n") if l.startswith("event:")), None)
        data_line = next((l for l in part.split("\n") if l.startswith("data:")), None)
        if event_line and data_line:
            events.append(
                (event_line.replace("event:", "").strip(), json.loads(data_line.replace("data:", "").strip()))
            )
    return events


def test_local_demo_chat_stream_emits_checkpoint(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    response = client.post("/api/chat/stream", json={"session_id": session_id})

    assert response.status_code == 200
    body = response.text
    assert "event: decision" in body
    assert "event: checkpoint_ready" in body
    assert "平方项" in body
    events = _parse_sse_events(body)
    decision = next(d for e, d in events if e == "decision")
    assert decision["message"].strip()
    assert "state_hint" in decision
    assert decision["wait_for_student"] is True


def test_tutor_action_rolls_back_if_checkpoint_insert_fails(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    turn = TutorTurn.model_validate(
        {
            "state_hint": "checking",
            "action": "SHOW_CHECKPOINT_MC",
            "message": "先检查一个小点。",
            "breakpoint_description": "测试事务回滚",
            "breakpoint_confidence": 0.8,
            "checkpoint": {
                "type": "checkpoint_mc",
                "question": "1 + 1 等于多少？",
                "options": [
                    {"id": "A", "text": "2", "is_correct": True, "misconception": None},
                    {"id": "B", "text": "1", "is_correct": False, "misconception": "漏加一次"},
                    {"id": "C", "text": "3", "is_correct": False, "misconception": "多加一次"},
                ],
                "tested_point": "整数加法",
            },
        }
    )
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            CREATE TRIGGER reject_checkpoint_insert
            BEFORE INSERT ON checkpoints
            BEGIN
              SELECT RAISE(ABORT, 'forced checkpoint failure');
            END;
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="forced checkpoint failure"):
        client.app.state.sessions.record_tutor_action(session_id, turn, action_index=0)

    session = client.app.state.sessions.get(session_id)
    assert session["phase"] == "diagnosing"
    assert session["breakpoint_description"] is None
    assert client.app.state.sessions.list_messages(session_id) == []
    assert client.app.state.sessions.list_checkpoints(session_id) == []


def test_checkpoint_answer_drives_followup_instead_of_loop(tmp_path: Path):
    """答题接口已写入 result，下一轮不重复提交 message 也能继续讲解。"""
    client, session_id = _bootstrap_app(tmp_path)

    # 第一轮：拿到检查点
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    assert first.status_code == 200
    first_events = _parse_sse_events(first.text)
    checkpoint_event = next((d for e, d in first_events if e == "checkpoint_ready"), None)
    assert checkpoint_event is not None, "第一轮应弹检查点"
    checkpoint_id = checkpoint_event["id"]

    # 学生答题：/answer 原子写 checkpoints 和 CHECKPOINT_RESPONSE message。
    answer = client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={
            "session_id": session_id,
            "selected_option_id": "A",
            "elapsed_ms": 1200,
        },
    )
    assert answer.status_code == 200
    assert answer.json()["event"] == "CHECKPOINT_CORRECT"

    # 第二轮：只触发生成；选择已经从 SQLite 结构化 history 进入模型上下文。
    second = client.post("/api/chat/stream", json={"session_id": session_id})
    assert second.status_code == 200
    second_events = _parse_sse_events(second.text)
    second_checkpoint = next((d for e, d in second_events if e == "checkpoint_ready"), None)
    assert second_checkpoint is None, "答完检查点后不应再次弹同一检查点（修复死循环）"
    decisions = [d for e, d in second_events if e == "decision"]
    assert decisions
    assert any(d["action"] == "ASK_OPEN_QUESTION" for d in decisions)
    deltas = [d for e, d in second_events if e == "message_delta"]
    visible = "".join(d.get("text", "") for d in deltas)
    assert visible.strip(), "第二轮应输出可见讲解而非空内容"
    assert "x=3" in visible or "为 0" in visible or "最大值 5" in visible


def test_checkpoint_answer_is_structured_student_result(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")

    answer = client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "B", "elapsed_ms": 900},
    )

    assert answer.status_code == 200
    assert answer.json()["student_message"].startswith("我在检查点")
    messages = client.app.state.sessions.list_messages(session_id)
    result_message = messages[-1]
    metadata = json.loads(result_message["metadata_json"])
    assert result_message["role"] == "student"
    assert result_message["action"] == "CHECKPOINT_RESPONSE"
    assert result_message["in_reply_to_action_id"]
    assert metadata["checkpoint_result"]["checkpoint_id"] == checkpoint_id
    assert metadata["checkpoint_result"]["is_correct"] is False
    assert metadata["checkpoint_result"]["misconception"]

    duplicate = client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 1000},
    )
    assert duplicate.status_code == 409
    checkpoint_results = [
        row for row in client.app.state.sessions.list_messages(session_id)
        if row["action"] == "CHECKPOINT_RESPONSE"
    ]
    assert len(checkpoint_results) == 1


def test_sqlite_history_can_be_restored_as_new_session(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 700},
    )

    history = client.get("/api/sessions/history")
    assert history.status_code == 200
    item = next(item for item in history.json()["sessions"] if item["session_id"] == session_id)
    assert item["message_count"] == 2
    profile_id = client.app.state.sessions.get(session_id)["model_profile_id"]

    restored = client.post(
        "/api/sessions/restore",
        json={"session_id": session_id, "model_profile_id": profile_id},
    )

    assert restored.status_code == 200
    payload = restored.json()
    assert payload["session_id"] != session_id
    assert payload["restored_from"] == session_id
    assert [message["action"] for message in payload["messages"]] == [
        "SHOW_CHECKPOINT_MC",
        "CHECKPOINT_RESPONSE",
    ]
    original_messages = client.app.state.sessions.list_messages(session_id)
    copied_messages = client.app.state.sessions.list_messages(payload["session_id"])
    assert [row["content"] for row in copied_messages] == [row["content"] for row in original_messages]
    assert [row["id"] for row in copied_messages] != [row["id"] for row in original_messages]
    assert copied_messages[1]["in_reply_to_action_id"] == copied_messages[0]["action_id"]
    original_checkpoint = client.app.state.sessions.list_checkpoints(session_id)[0]
    copied_checkpoint = client.app.state.sessions.list_checkpoints(payload["session_id"])[0]
    assert copied_checkpoint["id"] != original_checkpoint["id"]
    assert copied_checkpoint["source_action_id"] == copied_messages[0]["action_id"]


def test_session_delete_removes_sqlite_children_and_log_files(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    response = client.post("/api/chat/stream", json={"session_id": session_id})
    assert response.status_code == 200
    log_dir = client.app.state.session_logger.log_dir
    assert (log_dir / f"{session_id}.jsonl").exists()
    assert (log_dir / f"{session_id}.log.md").exists()

    deleted = client.delete(f"/api/sessions/{session_id}")

    assert deleted.status_code == 204
    with pytest.raises(KeyError):
        client.app.state.sessions.get(session_id)
    assert client.app.state.sessions.list_messages(session_id) == []
    assert client.app.state.sessions.list_checkpoints(session_id) == []
    assert not (log_dir / f"{session_id}.jsonl").exists()
    assert not (log_dir / f"{session_id}.log.md").exists()
    history_ids = {
        item["session_id"]
        for item in client.get("/api/sessions/history").json()["sessions"]
    }
    assert session_id not in history_ids


def test_session_delete_succeeds_when_logs_are_already_missing(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)

    deleted = client.delete(f"/api/sessions/{session_id}")

    assert deleted.status_code == 204
    assert client.delete(f"/api/sessions/{session_id}").status_code == 404


def test_answer_unknown_triggers_recovery_phase(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    answer = client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "UNKNOWN", "elapsed_ms": 500},
    )
    assert answer.json()["event"] == "CHECKPOINT_UNKNOWN"
    assert answer.json()["next_state_hint"] == "recovering"


def test_checkpoint_session_mismatch_does_not_mutate_checkpoint(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    original = client.app.state.sessions.get_checkpoint(checkpoint_id)

    other_session = client.app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=client.app.state.sessions.get(session_id)["model_profile_id"],
            problem_text="另一道题",
            student_initial_thought="",
        )
    )
    response = client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": other_session["id"], "selected_option_id": "A", "elapsed_ms": 50},
    )

    assert response.status_code == 400
    current = client.app.state.sessions.get_checkpoint(checkpoint_id)
    assert original["selected_option_id"] is None
    assert current["selected_option_id"] is None
    assert current["answered_at"] is None


def test_session_stream_coordinator_rejects_second_active_stream():
    async def exercise():
        coordinator = SessionStreamCoordinator()
        assert await coordinator.try_start("sess_1") is True
        assert await coordinator.try_start("sess_1") is False
        assert await coordinator.try_start("sess_2") is True
        await coordinator.finish("sess_1")
        assert await coordinator.try_start("sess_1") is True

    asyncio.run(exercise())


def test_student_message_no_longer_uses_student_checkpoint_role(tmp_path: Path):
    """漏洞 1 修复后选择走 student role，不再产生 student_checkpoint 这条模糊历史"""
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 100},
    )
    client.post(
        "/api/chat/stream",
        json={"session_id": session_id, "message": "我在检查点「x」选了：A 尽量小"},
    )

    # 直接查 SQLite：messages 表里不应再出现 role='student_checkpoint'
    import sqlite3

    conn = sqlite3.connect(tmp_path / "app.db")
    rows = conn.execute("SELECT role FROM messages WHERE session_id = ?", (session_id,)).fetchall()
    conn.close()
    roles = [r[0] for r in rows]
    assert "student_checkpoint" not in roles
    assert "student" in roles


def test_streamed_message_arrives_as_multiple_small_deltas(tmp_path: Path):
    """真流式：local_demo 把同一 turn 拆成多段 message_delta，前端看到打字机效果而非一次性块"""
    client, session_id = _bootstrap_app(tmp_path)
    response = client.post("/api/chat/stream", json={"session_id": session_id})
    deltas = [d for e, d in _parse_sse_events(response.text) if e == "message_delta"]
    # local_demo_stream 按 4 字符一组切，message 有几十个字符 → 至少多个 delta
    assert len(deltas) > 1
    # 拼起来应当非空且含完整讲解文本
    joined = "".join(d.get("text", "") for d in deltas)
    assert joined.strip()
    assert "平方项" in joined or "我先不从头讲完整题" in joined


def test_session_with_problem_image_requires_multimodal_tutoring_model(tmp_path: Path):
    app = create_app()
    db = Database(tmp_path / "app.db")
    app.state.db = db
    app.state.model_profiles = ModelProfileRepository(db, SecretBox(tmp_path / "secret.key"))
    app.state.sessions = SessionRepository(db)
    client = TestClient(app)

    text_profile = app.state.model_profiles.create(
        ModelProfileCreate(
            display_name="Text Model",
            provider="openai_compatible",
            base_url="https://example.com/v1",
            api_key="text-key",
            model="text-model",
            is_multimodal=False,
        )
    )
    session_payload = {
        "grade_band": "junior",
        "subject": "math",
        "model_profile_id": text_profile["id"],
        "problem_text": "根据图形求角 A。",
        "student_initial_thought": "",
        "problem_image_data_url": "data:image/png;base64,aW1hZ2U=",
    }

    rejected = client.post("/api/sessions", json=session_payload)

    assert rejected.status_code == 400
    assert "多模态" in rejected.json()["detail"]

    vision_profile = app.state.model_profiles.create(
        ModelProfileCreate(
            display_name="Vision Model",
            provider="openai_compatible",
            base_url="https://example.com/v1",
            api_key="vision-key",
            model="vision-model",
            is_multimodal=True,
        )
    )
    session_payload["model_profile_id"] = vision_profile["id"]
    created = client.post("/api/sessions", json=session_payload)

    assert created.status_code == 200
    session = app.state.sessions.get(created.json()["session_id"])
    assert session["problem_image_data_url"] == session_payload["problem_image_data_url"]
