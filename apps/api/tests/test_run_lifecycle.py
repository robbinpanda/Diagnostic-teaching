import asyncio
import json
from contextlib import suppress
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate, TutorTurn
from app.main import create_app
from app.routes import chat as chat_routes
from app.routes.chat import SessionStreamCoordinator
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger


def bootstrap(tmp_path: Path):
    app = create_app()
    db = Database(tmp_path / "app.db")
    app.state.db = db
    app.state.model_profiles = ModelProfileRepository(db, SecretBox(tmp_path / "secret.key"))
    app.state.sessions = SessionRepository(db)
    app.state.session_logger = SessionLogger(tmp_path / "sessions")
    app.state.chat_streams = SessionStreamCoordinator()
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
            problem_text="求函数最大值。",
            student_initial_thought="我卡住了。",
        )
    )
    return app, session["id"]


def parse_sse(body: str) -> list[tuple[str, dict]]:
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


def open_question(message: str = "你先说说现在卡在哪里？") -> TutorTurn:
    return TutorTurn.model_validate(
        {
            "state_hint": "diagnosing",
            "action": "ASK_OPEN_QUESTION",
            "message": message,
            "breakpoint_description": "等待学生补充",
            "wait_for_student": True,
        }
    )


def test_run_attempts_and_structured_terminal_state_are_durable(tmp_path: Path):
    app, session_id = bootstrap(tmp_path)
    repository = app.state.sessions

    first = repository.create_run(session_id)
    assert first["attempt"] == 1
    assert first["status"] == "queued"
    assert first["queued_at"] and first["updated_at"]
    running = repository.mark_run_running(first["id"])
    assert running["status"] == "running"
    assert running["started_at"]
    failed = repository.mark_run_failed(
        first["id"],
        {"code": "provider_error", "message": "boom", "retryable": True},
    )
    assert failed["status"] == "failed"
    assert failed["finished_at"]
    assert json.loads(failed["error_json"])["code"] == "provider_error"

    second = repository.create_run(session_id)
    assert second["attempt"] == 2
    repository.mark_run_running(second["id"])
    completed = repository.mark_run_completed(second["id"])
    assert completed["status"] == "completed"
    assert completed["error_json"] is None


def test_client_run_id_admission_is_idempotent(tmp_path: Path):
    app, session_id = bootstrap(tmp_path)
    repository = app.state.sessions

    first, first_created = repository.admit_run(
        session_id,
        client_run_id="client-run-stable",
    )
    duplicate, duplicate_created = repository.admit_run(
        session_id,
        client_run_id="client-run-stable",
    )

    assert first_created is True
    assert duplicate_created is False
    assert duplicate["id"] == first["id"]
    assert duplicate["client_run_id"] == "client-run-stable"
    assert len(repository.list_runs(session_id)) == 1


def test_duplicate_client_run_id_returns_existing_run_without_new_generation(tmp_path: Path):
    app, session_id = bootstrap(tmp_path)
    client = TestClient(app)

    first = client.post(
        "/api/chat/stream",
        json={"session_id": session_id, "client_run_id": "browser-run-1"},
    )
    duplicate = client.post(
        "/api/chat/stream",
        json={"session_id": session_id, "client_run_id": "browser-run-1"},
    )

    assert first.status_code == 200
    assert any(event == "stream_complete" for event, _ in parse_sse(first.text))
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "RUN_ALREADY_EXISTS"
    assert duplicate.json()["detail"]["status"] == "completed"
    assert len(app.state.sessions.list_runs(session_id)) == 1


def test_session_runs_migration_is_idempotent_for_existing_database(tmp_path: Path):
    app, session_id = bootstrap(tmp_path)
    first = app.state.sessions.create_run(session_id)

    reopened = Database(tmp_path / "app.db")
    repository = SessionRepository(reopened)
    assert repository.get(session_id)["id"] == session_id
    assert repository.get_run(first["id"])["attempt"] == 1

    # Repeated upgrade head is a no-op and preserves the existing run row.
    Database(tmp_path / "app.db")
    assert len(repository.list_runs(session_id)) == 1


def test_idle_and_repeated_interrupt_are_idempotent(tmp_path: Path):
    app, session_id = bootstrap(tmp_path)
    client = TestClient(app)

    first = client.post(f"/api/sessions/{session_id}/interrupt")
    second = client.post(f"/api/sessions/{session_id}/interrupt")

    assert first.status_code == 200
    assert first.json() == {"interrupted": False, "active": False, "run_ids": []}
    assert second.json() == first.json()


def test_interrupt_cancels_provider_loop_and_keeps_only_complete_actions(tmp_path: Path, monkeypatch):
    app, session_id = bootstrap(tmp_path)
    first_turn = TutorTurn.model_validate(
        {
            "state_hint": "recovering",
            "action": "RESPOND_TO_CHECKPOINT",
            "message": "先确认：你刚才的选择说明负号这里还不清楚。",
        }
    )

    async def exercise():
        second_started = asyncio.Event()
        provider_cancelled = asyncio.Event()
        call_count = 0

        async def fake_generation(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                yield "message_delta", first_turn.message
                yield "turn", first_turn
                return
            yield "message_delta", "这段未完成内容不应入库"
            second_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                provider_cancelled.set()
                raise

        monkeypatch.setattr(chat_routes, "generate_tutor_turn_stream", fake_generation)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            stream_task = asyncio.create_task(
                client.post("/api/chat/stream", json={"session_id": session_id})
            )
            await asyncio.wait_for(second_started.wait(), timeout=1)

            status = await client.get(f"/api/sessions/{session_id}/run")
            assert status.json()["running"] is True
            assert status.json()["run"]["last_committed_action_index"] == 0

            interrupted = await client.post(f"/api/sessions/{session_id}/interrupt")
            duplicate = await client.post(f"/api/sessions/{session_id}/interrupt")
            response = await asyncio.wait_for(stream_task, timeout=1)

        assert interrupted.json()["interrupted"] is True
        assert duplicate.json()["interrupted"] is False
        assert provider_cancelled.is_set()
        events = parse_sse(response.text)
        assert any(event == "run_interrupted" for event, _ in events)
        assert [data["action"] for event, data in events if event == "decision"] == [
            "RESPOND_TO_CHECKPOINT"
        ]

    asyncio.run(exercise())

    messages = app.state.sessions.list_messages(session_id)
    assistant_messages = [row for row in messages if row["role"] == "assistant"]
    assert [row["content"] for row in assistant_messages] == [first_turn.message]
    run = app.state.sessions.list_runs(session_id)[0]
    assert run["status"] == "interrupted"
    assert run["last_committed_action_index"] == 0
    assert json.loads(run["error_json"])["code"] == "explicit_interrupt"
    assert asyncio.run(app.state.chat_streams.status(session_id))["active"] is False


def test_explicit_interrupt_discards_partial_output_and_keeps_next_input_normal(tmp_path: Path, monkeypatch):
    app, session_id = bootstrap(tmp_path)

    async def exercise():
        partial_started = asyncio.Event()
        provider_cancelled = asyncio.Event()

        async def fake_generation(*args, **kwargs):
            yield "message_delta", "先把等式两边"
            partial_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                provider_cancelled.set()
                raise

        monkeypatch.setattr(chat_routes, "generate_tutor_turn_stream", fake_generation)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            stream_task = asyncio.create_task(
                client.post("/api/chat/stream", json={"session_id": session_id})
            )
            await asyncio.wait_for(partial_started.wait(), timeout=1)
            interrupted = await client.post(
                f"/api/sessions/{session_id}/interrupt",
            )
            duplicate = await client.post(
                f"/api/sessions/{session_id}/interrupt",
            )
            await asyncio.wait_for(stream_task, timeout=1)

        assert interrupted.json()["interrupted"] is True
        assert duplicate.json()["interrupted"] is False
        assert provider_cancelled.is_set()

    asyncio.run(exercise())

    messages = app.state.sessions.list_messages(session_id)
    assert messages == []
    client = TestClient(app)
    accepted = client.post(
        f"/api/sessions/{session_id}/inputs",
        json={
            "kind": "STUDENT_MESSAGE",
            "client_message_id": "interrupt-question",
            "message": "我刚才其实想选 A。",
        },
    )
    assert accepted.status_code == 201
    assert accepted.json()["message_id"]
    assert app.state.sessions.list_messages(session_id)[0]["content"] == "我刚才其实想选 A。"
    run = app.state.sessions.list_runs(session_id)[0]
    assert json.loads(run["error_json"])["code"] == "explicit_interrupt"


def test_provider_exception_marks_failed_releases_coordinator_and_allows_retry(
    tmp_path: Path,
    monkeypatch,
):
    app, session_id = bootstrap(tmp_path)
    fail = True

    async def fake_generation(*args, **kwargs):
        if fail:
            yield "message_delta", "未完成"
            raise RuntimeError("forced provider failure")
        turn = open_question()
        yield "message_delta", turn.message
        yield "turn", turn

    monkeypatch.setattr(chat_routes, "generate_tutor_turn_stream", fake_generation)
    client = TestClient(app)

    failed_response = client.post("/api/chat/stream", json={"session_id": session_id})
    assert any(event == "error" for event, _ in parse_sse(failed_response.text))
    assert app.state.sessions.list_messages(session_id) == []
    assert app.state.sessions.list_runs(session_id)[0]["status"] == "failed"
    assert asyncio.run(app.state.chat_streams.status(session_id))["active"] is False

    fail = False
    retry_response = client.post("/api/chat/stream", json={"session_id": session_id})
    assert any(event == "decision" for event, _ in parse_sse(retry_response.text))
    runs = app.state.sessions.list_runs(session_id)
    assert [row["attempt"] for row in runs] == [1, 2]
    assert [row["status"] for row in runs] == ["failed", "completed"]


def test_client_disconnect_is_failed_not_explicitly_interrupted(tmp_path: Path, monkeypatch):
    app, session_id = bootstrap(tmp_path)

    async def exercise():
        started = asyncio.Event()
        provider_cancelled = asyncio.Event()

        async def blocked_generation(*args, **kwargs):
            yield "message_delta", "只发出了一部分"
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                provider_cancelled.set()
                raise

        monkeypatch.setattr(chat_routes, "generate_tutor_turn_stream", blocked_generation)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            stream_task = asyncio.create_task(
                client.post("/api/chat/stream", json={"session_id": session_id})
            )
            await asyncio.wait_for(started.wait(), timeout=1)
            stream_task.cancel()
            with suppress(asyncio.CancelledError):
                await stream_task
        assert provider_cancelled.is_set()

    asyncio.run(exercise())

    run = app.state.sessions.list_runs(session_id)[0]
    assert run["status"] == "failed"
    assert json.loads(run["error_json"])["code"] == "client_disconnected"
    assert app.state.sessions.list_messages(session_id) == []
    assert asyncio.run(app.state.chat_streams.status(session_id))["active"] is False


def test_app_startup_fails_orphaned_queued_and_running_runs(tmp_path: Path, monkeypatch):
    database_path = tmp_path / "restart.db"
    db = Database(database_path)
    profiles = ModelProfileRepository(db, SecretBox(tmp_path / "before-restart.key"))
    sessions = SessionRepository(db)
    profile = profiles.create(
        ModelProfileCreate(
            display_name="Local Demo",
            provider="local_demo",
            base_url="https://local.demo/v1",
            api_key="demo-key",
            model="local-demo",
        )
    )
    first_session = sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile["id"],
            problem_text="题目一",
            student_initial_thought="思路一",
        )
    )
    second_session = sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile["id"],
            problem_text="题目二",
            student_initial_thought="思路二",
        )
    )
    running = sessions.create_run(first_session["id"])
    sessions.mark_run_running(running["id"])
    queued = sessions.create_run(second_session["id"])

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("APP_SECRET_PATH", str(tmp_path / "after-restart.key"))
    monkeypatch.setenv("SESSION_LOG_DIR", str(tmp_path / "restart-logs"))
    restarted_app = create_app()

    recovered = {row["id"]: row for row in restarted_app.state.recovered_session_runs}
    assert set(recovered) == {running["id"], queued["id"]}
    for row in recovered.values():
        assert row["status"] == "failed"
        error = json.loads(row["error_json"])
        assert error["code"] == "process_restarted"
        assert error["previous_status"] in {"queued", "running"}
    assert restarted_app.state.sessions.latest_active_run(first_session["id"]) is None
    assert restarted_app.state.sessions.latest_active_run(second_session["id"]) is None
