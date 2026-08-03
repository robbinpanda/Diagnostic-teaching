import asyncio
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate, TutorTurn
from app.main import create_app
from app.routes import chat as chat_routes
from app.routes.chat import SessionStreamCoordinator
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


def _parse_sse_events(body: str) -> list[tuple[str, dict]]:
    events = []
    for part in body.split("\n\n"):
        event_line = next((line for line in part.split("\n") if line.startswith("event:")), None)
        data_line = next((line for line in part.split("\n") if line.startswith("data:")), None)
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
    assert decision["action"] == "ASK_MULTIPLE_CHOICE"
    assert decision["message"].strip()
    assert "state_hint" in decision
    assert decision["wait_for_student"] is True


def test_tutor_action_rolls_back_if_checkpoint_insert_fails(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    turn = TutorTurn.model_validate(
        {
            "state_hint": "checking",
            "action": "ASK_MULTIPLE_CHOICE",
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


def test_tutor_action_rolls_back_if_card_insert_fails(tmp_path: Path):
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
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            CREATE TRIGGER reject_card_insert
            BEFORE INSERT ON study_cards
            BEGIN
              SELECT RAISE(ABORT, 'forced card failure');
            END;
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="forced card failure"):
        client.app.state.sessions.record_tutor_action(session_id, turn, action_index=0)

    session = client.app.state.sessions.get(session_id)
    assert session["phase"] == "diagnosing"
    assert client.app.state.sessions.list_messages(session_id) == []
    assert client.app.state.sessions.list_cards(session_id, include_pending=True) == []


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
    assert decisions[0]["action"] == "RESPOND_TO_CHECKPOINT"
    assert any(d["action"] == "SUMMARIZE" for d in decisions)
    assert not any(d["action"] == "ASK_OPEN_QUESTION" for d in decisions)
    deltas = [d for e, d in second_events if e == "message_delta"]
    visible = "".join(d.get("text", "") for d in deltas)
    assert visible.strip(), "第二轮应输出可见讲解而非空内容"
    assert "x=3" in visible or "为 0" in visible or "最大值 5" in visible


def test_problem_card_waits_for_close_then_joins_global_library(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 700},
    )

    response = client.post("/api/chat/stream", json={"session_id": session_id})
    events = _parse_sse_events(response.text)
    card = next(d for e, d in events if e == "card_ready")
    message_done = [d for e, d in events if e == "message_done"][-1]

    assert card["card_type"] == "problem_card"
    assert card["content"]["type"] == "problem_card"
    assert card["content"]["solution_steps"]
    assert card["content"]["how_to_think"]
    assert card["saved_at"] is None
    assert message_done["awaiting_card_dismissal"] is True
    assert message_done["continue_after_card"] is False
    assert client.get("/api/cards").json()["cards"] == []
    assert client.post("/api/chat/stream", json={"session_id": session_id}).status_code == 409

    profile_id = client.app.state.sessions.get(session_id)["model_profile_id"]
    restored = client.post(
        "/api/sessions/restore",
        json={"session_id": session_id, "model_profile_id": profile_id},
    )
    assert restored.status_code == 200
    restored_pending = restored.json()["pending_card"]
    assert restored_pending["id"] != card["id"]
    assert restored_pending["content"] == card["content"]

    saved = client.post(
        f"/api/cards/{card['id']}/save",
        json={"session_id": session_id},
    )
    assert saved.status_code == 200
    assert saved.json()["saved_at"]
    listed = client.get("/api/cards?card_type=problem_card")
    assert [item["id"] for item in listed.json()["cards"]] == [card["id"]]

    restored_after_save = client.post(
        "/api/sessions/restore",
        json={"session_id": session_id, "model_profile_id": profile_id},
    )
    assert restored_after_save.status_code == 200
    assert restored_after_save.json()["pending_card"] is None
    assert [item["id"] for item in client.get("/api/cards").json()["cards"]] == [card["id"]]

    new_session = client.post(
        "/api/sessions",
        json={
            "grade_band": "junior",
            "subject": "math",
            "model_profile_id": profile_id,
            "problem_text": "计算 $2+2$。",
            "student_initial_thought": "",
        },
    )
    assert new_session.status_code == 200
    assert [item["id"] for item in client.get("/api/cards").json()["cards"]] == [card["id"]]

    assert client.delete(f"/api/sessions/{session_id}").status_code == 204
    assert [item["id"] for item in client.get("/api/cards").json()["cards"]] == [card["id"]]

    deleted = client.delete(f"/api/cards/{card['id']}")
    assert deleted.status_code == 204
    assert client.get("/api/cards").json()["cards"] == []


def test_knowledge_card_close_resumes_nonblocking_tutoring(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "UNKNOWN", "elapsed_ms": 500},
    )

    response = client.post("/api/chat/stream", json={"session_id": session_id})
    events = _parse_sse_events(response.text)
    card = next(d for e, d in events if e == "card_ready")
    card_decision = [d for e, d in events if e == "decision"][-1]
    message_done = [d for e, d in events if e == "message_done"][-1]

    assert card_decision["action"] == "EXPLAIN_PRINCIPLE"
    assert card_decision["wait_for_student"] is False
    assert card["card_type"] == "knowledge_card"
    assert card["content"]["derivation_steps"]
    assert message_done["continue_after_card"] is True

    client.post(f"/api/cards/{card['id']}/save", json={"session_id": session_id})
    continued = client.post("/api/chat/stream", json={"session_id": session_id})
    continued_events = _parse_sse_events(continued.text)

    assert continued.status_code == 200
    assert any(e == "decision" for e, _ in continued_events)
    assert not any(e == "card_ready" and d["id"] == card["id"] for e, d in continued_events)


def test_saved_knowledge_card_content_can_be_updated(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "UNKNOWN", "elapsed_ms": 500},
    )
    response = client.post("/api/chat/stream", json={"session_id": session_id})
    card = next(d for e, d in _parse_sse_events(response.text) if e == "card_ready")
    edited_content = {
        **card["content"],
        "title": "平方项非负（卡片库修订版）",
        "core_idea": "任意实数 $u$ 都满足 $u^2\\ge 0$。",
    }

    pending_update = client.put(
        f"/api/cards/{card['id']}",
        json={"content": edited_content},
    )
    assert pending_update.status_code == 409

    assert client.post(
        f"/api/cards/{card['id']}/save",
        json={"session_id": session_id},
    ).status_code == 200
    updated = client.put(
        f"/api/cards/{card['id']}",
        json={"content": edited_content},
    )

    assert updated.status_code == 200
    assert updated.json()["content"] == edited_content
    assert updated.json()["saved_at"]
    listed = client.get("/api/cards?card_type=knowledge_card").json()["cards"]
    assert listed[0]["id"] == card["id"]
    assert listed[0]["content"] == edited_content


def test_optional_explain_local_card_pauses_then_requests_continuation(tmp_path: Path, monkeypatch):
    client, session_id = _bootstrap_app(tmp_path)
    turn = TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "action": "EXPLAIN_LOCAL",
            "message": "韦达定理中，两根之和用 $-b/a$，两根之积用 $c/a$。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": "韦达定理的和与积",
                "knowledge_point": "区分韦达定理的两条公式",
                "core_idea": "和看 $b$ 且带负号，积看 $c$ 且不带负号。",
                "derivation_steps": [
                    {"title": "两根之和", "content": "$x_1+x_2=-b/a$。"},
                    {"title": "两根之积", "content": "$x_1x_2=c/a$。"},
                ],
                "when_to_use": ["由二次方程系数求两根之和或积"],
                "common_mistakes": ["混淆分子 $b$ 和 $c$"],
                "connection_to_problem": "本题用积得到 $a_1a_5=1$。",
            },
        }
    )

    async def fake_generate_tutor_turn_stream(*args, **kwargs):
        yield "message_delta", turn.message
        yield "turn", turn

    monkeypatch.setattr(chat_routes, "generate_tutor_turn_stream", fake_generate_tutor_turn_stream)

    response = client.post("/api/chat/stream", json={"session_id": session_id})
    events = _parse_sse_events(response.text)
    card = next(d for e, d in events if e == "card_ready")
    decision = next(d for e, d in events if e == "decision")
    message_done = next(d for e, d in events if e == "message_done")

    assert response.status_code == 200
    assert decision["action"] == "EXPLAIN_LOCAL"
    assert decision["wait_for_student"] is False
    assert card["card_type"] == "knowledge_card"
    assert message_done["awaiting_card_dismissal"] is True
    assert message_done["continue_after_card"] is True
    assert client.post("/api/chat/stream", json={"session_id": session_id}).status_code == 409

    saved = client.post(f"/api/cards/{card['id']}/save", json={"session_id": session_id})
    assert saved.status_code == 200
    assert [item["id"] for item in client.get("/api/cards").json()["cards"]] == [card["id"]]


def test_card_suppression_stays_enabled_for_whole_run_if_card_is_saved_mid_run(
    tmp_path: Path,
    monkeypatch,
):
    client, session_id = _bootstrap_app(tmp_path)
    card_turn = TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "action": "EXPLAIN_PRINCIPLE",
            "message": "先说明皮带传动的弧长关系。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": "皮带传动弧长相等",
                "knowledge_point": "无滑动皮带传动的弧长关系",
                "core_idea": "同一时间内两轮边缘通过的弧长相等。",
                "derivation_steps": [{"title": "列式", "content": "$r_1\\theta_1=r_2\\theta_2$。"}],
                "when_to_use": ["无滑动皮带传动"],
                "common_mistakes": [],
                "connection_to_problem": "用于比较两轮转角。",
            },
        }
    )
    _, _, card = client.app.state.sessions.record_tutor_action(
        session_id,
        card_turn,
        action_index=0,
    )
    accepted = client.post(
        f"/api/sessions/{session_id}/inputs",
        json={
            "kind": "STUDENT_MESSAGE",
            "client_message_id": "defer-before-run",
            "message": "为什么弧长相等？",
        },
    )
    assert accepted.status_code == 201

    calls: list[bool] = []

    async def fake_generate_tutor_turn_stream(*args, **kwargs):
        calls.append(kwargs["suppress_cards"])
        if len(calls) == 1:
            client.app.state.sessions.save_card(card["id"], session_id=session_id)
            turn = TutorTurn(
                state_hint="explaining",
                action="EXPLAIN_LOCAL",
                message="皮带不打滑，所以接触处通过的线长度一致。",
            )
        else:
            turn = TutorTurn(
                state_hint="checking",
                action="ASK_OPEN_QUESTION",
                message="你能用半径和转角写出这个等式吗？",
                wait_for_student=True,
            )
        yield "message_delta", turn.message
        yield "turn", turn

    monkeypatch.setattr(chat_routes, "generate_tutor_turn_stream", fake_generate_tutor_turn_stream)

    response = client.post("/api/chat/stream", json={"session_id": session_id})

    assert response.status_code == 200
    assert calls == [True, True]
    assert client.app.state.sessions.latest_pending_card(session_id) is None


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
        "ASK_MULTIPLE_CHOICE",
        "CHECKPOINT_RESPONSE",
    ]
    checkpoint_result = payload["messages"][1]["checkpoint_result"]
    assert checkpoint_result["checkpoint"]["question"]
    assert checkpoint_result["selected_option_id"] == "A"
    assert checkpoint_result["is_correct"] is True
    assert all("is_correct" not in option for option in checkpoint_result["checkpoint"]["options"])
    assert all("misconception" not in option for option in checkpoint_result["checkpoint"]["options"])
    original_messages = client.app.state.sessions.list_messages(session_id)
    copied_messages = client.app.state.sessions.list_messages(payload["session_id"])
    assert [row["content"] for row in copied_messages] == [row["content"] for row in original_messages]
    assert [row["id"] for row in copied_messages] != [row["id"] for row in original_messages]
    assert copied_messages[1]["in_reply_to_action_id"] == copied_messages[0]["action_id"]
    original_checkpoint = client.app.state.sessions.list_checkpoints(session_id)[0]
    copied_checkpoint = client.app.state.sessions.list_checkpoints(payload["session_id"])[0]
    assert copied_checkpoint["id"] != original_checkpoint["id"]
    assert copied_checkpoint["source_action_id"] == copied_messages[0]["action_id"]


def test_session_history_keeps_complete_latex_title_for_frontend_rendering(tmp_path: Path):
    client, existing_session_id = _bootstrap_app(tmp_path)
    profile_id = client.app.state.sessions.get(existing_session_id)["model_profile_id"]
    problem_text = (
        "已知 $\\{a_n\\}$ 是等比数列，$a_1$、$a_5$ 是函数 $y=x^2+6x+1$ 的两个零点，"
        "并且数列各项均为实数。请结合等比中项的性质，求 $a_3$ 的所有可能值。"
    )
    created = client.post(
        "/api/sessions",
        json={
            "grade_band": "senior",
            "subject": "math",
            "model_profile_id": profile_id,
            "problem_text": problem_text,
            "student_initial_thought": "我准备先求两个零点。",
        },
    )

    assert created.status_code == 200
    session_id = created.json()["session_id"]
    history = client.get("/api/sessions/history").json()["sessions"]
    item = next(item for item in history if item["session_id"] == session_id)
    assert len(item["title"]) > 72
    assert item["title"] == problem_text
    assert item["title"].endswith("$a_3$ 的所有可能值。")


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


def test_delete_all_sessions_clears_sqlite_and_logs_but_preserves_saved_cards(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 700},
    )
    summarized = client.post("/api/chat/stream", json={"session_id": session_id})
    card = next(d for e, d in _parse_sse_events(summarized.text) if e == "card_ready")
    client.post(f"/api/cards/{card['id']}/save", json={"session_id": session_id})

    profile_id = client.app.state.sessions.get(session_id)["model_profile_id"]
    second = client.post(
        "/api/sessions",
        json={
            "grade_band": "junior",
            "subject": "math",
            "model_profile_id": profile_id,
            "problem_text": "计算 $2+2$。",
            "student_initial_thought": "",
        },
    ).json()["session_id"]
    log_dir = client.app.state.session_logger.log_dir
    assert list(log_dir.glob("*.jsonl"))
    assert list(log_dir.glob("*.log.md"))

    deleted = client.delete("/api/sessions")

    assert deleted.status_code == 204
    assert client.get("/api/sessions/history").json()["sessions"] == []
    for deleted_session_id in (session_id, second):
        with pytest.raises(KeyError):
            client.app.state.sessions.get(deleted_session_id)
        assert client.app.state.sessions.list_messages(deleted_session_id) == []
        assert client.app.state.sessions.list_checkpoints(deleted_session_id) == []
    assert list(log_dir.glob("*.jsonl")) == []
    assert list(log_dir.glob("*.log.md")) == []
    assert [item["id"] for item in client.get("/api/cards").json()["cards"]] == [card["id"]]
    assert client.get("/api/model-profiles").json()["profiles"]


def test_delete_all_cards_removes_saved_and_pending_cards_only(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(d["id"] for e, d in _parse_sse_events(first.text) if e == "checkpoint_ready")
    client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 700},
    )
    summarized = client.post("/api/chat/stream", json={"session_id": session_id})
    pending_card = next(d for e, d in _parse_sse_events(summarized.text) if e == "card_ready")
    assert client.app.state.sessions.latest_pending_card(session_id)["id"] == pending_card["id"]

    deleted = client.delete("/api/cards")

    assert deleted.status_code == 204
    assert client.app.state.sessions.list_cards(include_pending=True) == []
    assert client.app.state.sessions.get(session_id)["id"] == session_id
    assert client.app.state.sessions.list_messages(session_id)
    assert client.get("/api/sessions/history").json()["sessions"]
    assert list(client.app.state.session_logger.log_dir.glob("*.jsonl"))


def test_bulk_delete_is_rejected_while_a_chat_stream_is_active(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    coordinator = client.app.state.chat_streams
    handle = asyncio.run(coordinator.enqueue(session_id, "run_test_active"))
    try:
        sessions_response = client.delete("/api/sessions")
        cards_response = client.delete("/api/cards")
    finally:
        asyncio.run(coordinator.finish(handle))

    assert sessions_response.status_code == 409
    assert cards_response.status_code == 409
    assert client.app.state.sessions.get(session_id)["id"] == session_id


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


def test_session_stream_coordinator_serializes_same_session_and_parallelizes_others():
    async def exercise():
        coordinator = SessionStreamCoordinator()
        first = await coordinator.enqueue("sess_1", "run_1")
        second = await coordinator.enqueue("sess_1", "run_2")
        other = await coordinator.enqueue("sess_2", "run_3")

        await coordinator.start(first)
        second_start = asyncio.create_task(coordinator.start(second))
        await asyncio.sleep(0)
        assert not second_start.done()
        await coordinator.start(other)
        assert (await coordinator.status("sess_1"))["running"] is True
        assert (await coordinator.status("sess_2"))["running"] is True

        await coordinator.finish(first)
        await asyncio.wait_for(second_start, timeout=1)
        assert second.state == "running"
        await coordinator.finish(second)
        await coordinator.finish(other)

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


def test_session_create_rejects_unapproved_vision_model_metadata(tmp_path: Path):
    client, session_id = _bootstrap_app(tmp_path)
    profile_id = client.app.state.sessions.get(session_id)["model_profile_id"]

    response = client.post(
        "/api/sessions",
        json={
            "grade_band": "junior",
            "subject": "math",
            "model_profile_id": profile_id,
            "problem_text": "计算 $1+1$。",
            "student_initial_thought": "学生写了 $2$。",
            "answer_text": "视觉模型内部答案",
            "correctness": "correct",
            "mistake_summary": "视觉模型内部批改字段",
            "diagram_image_data_url": "data:image/png;base64,Y3JvcA==",
        },
    )

    assert response.status_code == 422
    assert all(error["type"] == "extra_forbidden" for error in response.json()["detail"])
