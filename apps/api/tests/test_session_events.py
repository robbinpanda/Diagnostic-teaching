from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate, TutorTurn
from app.main import create_app
from app.routes import chat as chat_routes
from app.services.input_acceptance import InputAcceptanceService
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_events import event_from_row


def _bootstrap_app(tmp_path: Path) -> tuple[TestClient, str, str]:
    app = create_app()
    db = Database(tmp_path / "events.db")
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
    return TestClient(app), session["id"], profile["id"]


def _parse_event_sse(body: str) -> list[dict]:
    events: list[dict] = []
    for block in body.split("\n\n"):
        lines = block.splitlines()
        event_name = next((line[6:].strip() for line in lines if line.startswith("event:")), None)
        event_id = next((line[3:].strip() for line in lines if line.startswith("id:")), None)
        data = next((line[5:].strip() for line in lines if line.startswith("data:")), None)
        if event_name == "session_event" and event_id and data:
            payload = json.loads(data)
            assert payload["seq"] == int(event_id)
            events.append(payload)
    return events


def test_session_event_migration_is_additive_and_versioned(tmp_path: Path):
    database_path = tmp_path / "migration.db"
    db = Database(database_path)
    Database(database_path)  # Reopening an upgraded DB must be idempotent.
    with db.connect() as conn:
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(session_events)").fetchall()
        }
        revision = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]

    assert columns == {"id", "session_id", "seq", "type", "data_json", "created_at"}
    assert revision == "0003_session_events"


def test_concurrent_appends_allocate_strict_per_session_sequence(tmp_path: Path):
    client, session_id, _ = _bootstrap_app(tmp_path)
    repository = client.app.state.sessions.events

    def append(index: int) -> None:
        repository.append(session_id, "test.concurrent", {"index": index})

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(append, range(48)))

    rows = repository.list(session_id, after_seq=0, limit=100)
    events = [event_from_row(row) for row in rows]
    assert [event["seq"] for event in events] == list(range(1, 50))
    assert len({event["id"] for event in events}) == 49
    assert {event["data"]["index"] for event in events[1:]} == set(range(48))


def test_event_and_business_write_roll_back_together(tmp_path: Path):
    client, session_id, _ = _bootstrap_app(tmp_path)
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            CREATE TRIGGER reject_message_event
            BEFORE INSERT ON session_events
            WHEN NEW.type = 'message.completed'
            BEGIN
              SELECT RAISE(ABORT, 'forced event failure');
            END;
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="forced event failure"):
        InputAcceptanceService(client.app.state.sessions).accept_student_message(
            session_id,
            client_message_id="forced-event-rollback",
            message="这条消息必须回滚",
        )

    assert client.app.state.sessions.list_messages(session_id) == []
    assert [
        event_from_row(row)["type"]
        for row in client.app.state.sessions.events.list(session_id, limit=20)
    ] == ["session.created"]


def test_history_is_limited_ordered_and_session_isolated(tmp_path: Path):
    client, first_session_id, profile_id = _bootstrap_app(tmp_path)
    second_session = client.app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile_id,
            problem_text="计算 1+1。",
            student_initial_thought="等于 2。",
        )
    )
    for index in range(4):
        client.app.state.sessions.events.append(
            first_session_id,
            "test.history",
            {"index": index},
        )
    client.app.state.sessions.events.append(second_session["id"], "test.other", {})

    first_page = client.get(
        f"/api/sessions/{first_session_id}/events",
        params={"after_seq": 0, "limit": 2},
    )
    assert first_page.status_code == 200
    payload = first_page.json()
    assert payload["schema_version"] == 1
    assert payload["has_more"] is True
    assert [event["seq"] for event in payload["events"]] == [1, 2]
    assert {event["session_id"] for event in payload["events"]} == {first_session_id}

    second_page = client.get(
        f"/api/sessions/{first_session_id}/events",
        params={"after_seq": payload["next_after_seq"], "limit": 2},
    ).json()
    assert [event["seq"] for event in second_page["events"]] == [3, 4]
    assert client.get(
        f"/api/sessions/{first_session_id}/events",
        params={"limit": 201},
    ).status_code == 422


def test_chat_publishes_replayable_completion_events_in_order(tmp_path: Path):
    client, session_id, _ = _bootstrap_app(tmp_path)
    response = client.post("/api/chat/stream", json={"session_id": session_id})
    assert response.status_code == 200

    history = client.get(f"/api/sessions/{session_id}/events").json()["events"]
    types = [event["type"] for event in history]
    assert types == [
        "session.created",
        "run.started",
        "message.completed",
        "action.completed",
        "checkpoint.ready",
        "run.completed",
        "session.idle",
    ]
    message_event = next(event for event in history if event["type"] == "message.completed")
    action_event = next(event for event in history if event["type"] == "action.completed")
    checkpoint_event = next(event for event in history if event["type"] == "checkpoint.ready")
    assert message_event["data"]["content"]
    assert action_event["data"]["message"] == message_event["data"]["content"]
    assert action_event["data"]["message_id"] == message_event["data"]["message_id"]
    assert all("is_correct" not in option for option in checkpoint_event["data"]["checkpoint"]["options"])
    assert [event["seq"] for event in history] == list(range(1, len(history) + 1))


def test_sse_resume_and_duplicate_delivery_are_idempotent(tmp_path: Path):
    client, session_id, _ = _bootstrap_app(tmp_path)
    client.post("/api/chat/stream", json={"session_id": session_id})
    all_events = client.get(
        f"/api/sessions/{session_id}/events/stream",
        params={"after_seq": 0, "follow": "false"},
    )
    parsed_all = _parse_event_sse(all_events.text)
    disconnect_after = parsed_all[3]["seq"]

    resumed = client.get(
        f"/api/sessions/{session_id}/events/stream",
        params={"follow": "false"},
        headers={"Last-Event-ID": str(disconnect_after)},
    )
    replayed_again = client.get(
        f"/api/sessions/{session_id}/events/stream",
        params={"after_seq": disconnect_after, "follow": "false"},
    )
    resumed_events = _parse_event_sse(resumed.text)
    duplicate_events = _parse_event_sse(replayed_again.text)

    assert resumed_events[0]["seq"] == disconnect_after + 1
    assert [event["id"] for event in duplicate_events] == [event["id"] for event in resumed_events]
    consumed: dict[int, str] = {}
    for event in parsed_all[:4] + resumed_events + duplicate_events:
        consumed.setdefault(event["seq"], event["id"])
    assert list(consumed) == [event["seq"] for event in parsed_all]
    assert len(consumed) == len(parsed_all)


def test_checkpoint_and_card_completion_events_are_durable(tmp_path: Path):
    client, session_id, _ = _bootstrap_app(tmp_path)
    first = client.post("/api/chat/stream", json={"session_id": session_id})
    checkpoint_id = next(
        data["id"]
        for event, data in _parse_chat_sse(first.text)
        if event == "checkpoint_ready"
    )
    answered = client.post(
        f"/api/checkpoints/{checkpoint_id}/answer",
        json={"session_id": session_id, "selected_option_id": "A", "elapsed_ms": 120},
    )
    assert answered.status_code == 200

    turn = TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "action": "EXPLAIN_PRINCIPLE",
            "message": "任意实数的平方都不小于零。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": "平方非负",
                "knowledge_point": "完全平方的非负性",
                "core_idea": "$u^2\\ge0$。",
                "derivation_steps": [{"title": "定义", "content": "平方不小于零。"}],
                "when_to_use": ["判断范围"],
                "common_mistakes": [],
                "connection_to_problem": "用于判断最大值。",
            },
        }
    )
    _, _, card = client.app.state.sessions.record_tutor_action(
        session_id,
        turn,
        action_index=0,
        run_id="run_test",
    )
    client.app.state.sessions.save_card(card["id"], session_id=session_id)

    events = [
        event_from_row(row)
        for row in client.app.state.sessions.events.list(session_id, limit=100)
    ]
    assert "checkpoint.completed" in [event["type"] for event in events]
    assert "card.ready" in [event["type"] for event in events]
    assert "card.saved" in [event["type"] for event in events]
    checkpoint_completed = next(event for event in events if event["type"] == "checkpoint.completed")
    assert checkpoint_completed["data"]["checkpoint_id"] == checkpoint_id
    assert checkpoint_completed["data"]["student_message_id"]


def _parse_chat_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        event = next(
            (line[6:].strip() for line in block.splitlines() if line.startswith("event:")),
            None,
        )
        data = next(
            (line[5:].strip() for line in block.splitlines() if line.startswith("data:")),
            None,
        )
        if event and data:
            events.append((event, json.loads(data)))
    return events


def test_error_and_idle_events_are_replayable(tmp_path: Path, monkeypatch):
    client, session_id, _ = _bootstrap_app(tmp_path)

    async def fail_stream(*args, **kwargs):
        raise RuntimeError("模型暂时不可用")
        yield  # pragma: no cover

    monkeypatch.setattr(chat_routes, "generate_tutor_turn_stream", fail_stream)
    response = client.post("/api/chat/stream", json={"session_id": session_id})
    assert response.status_code == 200
    assert "模型暂时不可用" in response.text

    events = client.get(f"/api/sessions/{session_id}/events").json()["events"]
    assert [event["type"] for event in events][-3:] == [
        "error.occurred",
        "run.completed",
        "session.idle",
    ]
    assert events[-2]["data"]["status"] == "failed"
