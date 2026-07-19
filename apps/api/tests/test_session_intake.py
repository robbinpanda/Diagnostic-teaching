import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, TutorTurn
from app.main import create_app
from app.services.input_acceptance import InputAcceptanceService
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


def _start_payload(profile_id: str, **overrides):
    return {
        "session_id": "sess_0123456789abcdef0123456789abcdef",
        "client_message_id": "first-message",
        "grade_band": "junior",
        "subject": "math",
        "model_profile_id": profile_id,
        "message": "你好",
        "problem_text": "",
        "student_initial_thought": "",
        **overrides,
    }


def _sse_events(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for part in body.split("\n\n"):
        event_line = next((line for line in part.splitlines() if line.startswith("event:")), None)
        data_line = next((line for line in part.splitlines() if line.startswith("data:")), None)
        if event_line and data_line:
            events.append(
                (
                    event_line.removeprefix("event:").strip(),
                    json.loads(data_line.removeprefix("data:").strip()),
                )
            )
    return events


def test_first_message_immediately_creates_formal_session_and_durable_input(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    response = client.post("/api/sessions/start", json=_start_payload(profile_id))

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "accepted"
    assert payload["context_status"] == "need_problem"
    session = client.app.state.sessions.get(payload["session_id"])
    assert session["problem_text"] == ""
    assert session["student_initial_thought"] == ""
    assert [row["content"] for row in client.app.state.sessions.list_messages(session["id"])] == ["你好"]
    inputs = client.app.state.sessions.list_inputs(session["id"])
    assert len(inputs) == 1
    assert inputs[0]["kind"] == "STUDENT_MESSAGE"
    assert inputs[0]["idempotency_key"] == "first-message"


def test_message_order_never_fills_problem_or_thought_fields(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    started = client.post("/api/sessions/start", json=_start_payload(profile_id)).json()

    InputAcceptanceService(client.app.state.sessions).accept_student_message(
        started["session_id"],
        client_message_id="second-message",
        message="你好",
    )

    session = client.app.state.sessions.get(started["session_id"])
    assert session["context_status"] == "need_problem"
    assert session["problem_text"] == ""
    assert session["student_initial_thought"] == ""
    assert [row["content"] for row in client.app.state.sessions.list_messages(session["id"])] == [
        "你好",
        "你好",
    ]


def test_formal_tutoring_collects_context_semantically_before_teaching(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    session_id = client.post("/api/sessions/start", json=_start_payload(profile_id)).json()["session_id"]

    greeting_events = _sse_events(
        client.post("/api/chat/stream", json={"session_id": session_id}).text
    )
    greeting_decision = next(data for event, data in greeting_events if event == "decision")
    assert greeting_decision["action"] == "ASK_OPEN_QUESTION"
    assert "题目" in greeting_decision["message"]
    session = client.app.state.sessions.get(session_id)
    assert session["context_status"] == "need_problem"
    assert session["problem_text"] == ""

    service = InputAcceptanceService(client.app.state.sessions)
    service.accept_student_message(
        session_id,
        client_message_id="problem-message",
        message="已知 $x+1=2$，求 $x$。",
    )
    problem_events = _sse_events(
        client.post("/api/chat/stream", json={"session_id": session_id}).text
    )
    problem_decision = next(data for event, data in problem_events if event == "decision")
    assert problem_decision["action"] == "ASK_OPEN_QUESTION"
    assert "试过什么" in problem_decision["message"]
    session = client.app.state.sessions.get(session_id)
    assert session["context_status"] == "need_thought"
    assert session["problem_text"] == "已知 $x+1=2$，求 $x$。"

    service.accept_student_message(
        session_id,
        client_message_id="thought-message",
        message="我完全没思路，不知道从哪里开始。",
    )
    ready_events = _sse_events(
        client.post("/api/chat/stream", json={"session_id": session_id}).text
    )
    ready_decision = next(data for event, data in ready_events if event == "decision")
    assert ready_decision["action"] == "ASK_MULTIPLE_CHOICE"
    session = client.app.state.sessions.get(session_id)
    assert session["context_status"] == "ready"
    assert "完全没思路" in session["student_initial_thought"]


def test_session_start_is_idempotent_across_response_loss_retry(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    request = _start_payload(profile_id, message="已知 $x+1=2$，求 $x$。")

    first = client.post("/api/sessions/start", json=request)
    second = client.post("/api/sessions/start", json=request)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["status"] == "accepted"
    assert second.json()["status"] == "duplicate"
    assert first.json()["message_id"] == second.json()["message_id"]
    assert len(client.get("/api/sessions/history").json()["sessions"]) == 1
    assert len(client.app.state.sessions.list_messages(request["session_id"])) == 1


def test_model_context_summary_updates_session_atomically(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    session_id = client.post("/api/sessions/start", json=_start_payload(profile_id)).json()["session_id"]

    client.app.state.sessions.record_tutor_action(
        session_id,
        TutorTurn(
            state_hint="diagnosing",
            context_status="need_thought",
            problem_summary="已知 $x+1=2$，求 $x$。",
            action="ASK_OPEN_QUESTION",
            message="你已经试过什么方法？",
        ),
        action_index=0,
    )
    client.app.state.sessions.record_tutor_action(
        session_id,
        TutorTurn(
            state_hint="diagnosing",
            context_status="ready",
            student_thought_summary="学生明确表示完全没思路。",
            action="ASK_OPEN_QUESTION",
            message="先观察等号左边多了哪一项？",
        ),
        action_index=1,
    )

    session = client.app.state.sessions.get(session_id)
    assert session["context_status"] == "ready"
    assert session["problem_text"] == "已知 $x+1=2$，求 $x$。"
    assert session["student_initial_thought"] == "学生明确表示完全没思路。"


def test_prefilled_image_analysis_starts_at_need_thought(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    response = client.post(
        "/api/sessions/start",
        json=_start_payload(
            profile_id,
            message="上传了一张题目图片",
            problem_text="已知 $y=-2(x-3)^2+5$，求最大值。",
        ),
    )

    assert response.status_code == 200
    assert response.json()["context_status"] == "need_thought"


def test_existing_session_can_be_opened_without_copying(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    created = client.post(
        "/api/sessions/start",
        json=_start_payload(profile_id, message="你好"),
    ).json()

    opened = client.get(f"/api/sessions/{created['session_id']}")

    assert opened.status_code == 200
    assert opened.json()["session_id"] == created["session_id"]
    assert opened.json()["restored_from"] is None
    assert opened.json()["context_status"] == "need_problem"
    assert len(client.get("/api/sessions/history").json()["sessions"]) == 1


def test_old_intake_endpoint_is_removed(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    response = client.post("/api/sessions/intake", json=_start_payload(profile_id))

    assert response.status_code == 405
