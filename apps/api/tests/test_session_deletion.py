from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from app.core.schemas import (
    ModelProfileCreate,
    SessionCreate,
    SessionStartRequest,
    TutorTurn,
)
from app.main import create_app
from app.routes import sessions as session_routes
from app.services.input_acceptance import InputAcceptanceService
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger

MISSING_PAPER_DETAIL = "所选试卷已不存在，请重新选择"


def _client_and_profile(
    tmp_path: Path,
    *,
    raise_server_exceptions: bool = True,
) -> tuple[TestClient, str]:
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
    return TestClient(app, raise_server_exceptions=raise_server_exceptions), profile["id"]


def _create_session(
    client: TestClient,
    profile_id: str,
    *,
    paper_id: str | None = None,
    problem_text: str = "解方程 x+1=2。",
):
    return client.app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile_id,
            paper_id=paper_id,
            problem_text=problem_text,
            student_initial_thought="",
        )
    )


def _start_request(
    profile_id: str,
    paper_id: str,
    *,
    session_id: str,
    client_message_id: str,
) -> SessionStartRequest:
    return SessionStartRequest(
        session_id=session_id,
        client_message_id=client_message_id,
        grade_band="junior",
        subject="math",
        model_profile_id=profile_id,
        paper_id=paper_id,
        message="请帮我分析这道题。",
        problem_text="解方程 x+1=2。",
        student_initial_thought="",
    )


def _knowledge_card_turn(title: str) -> TutorTurn:
    return TutorTurn.model_validate(
        {
            "state_hint": "explaining",
            "action": "EXPLAIN_PRINCIPLE",
            "message": "先整理这个知识点。",
            "knowledge_card": {
                "type": "knowledge_card",
                "title": title,
                "knowledge_point": "移项",
                "core_idea": "等式两边同时做相同运算。",
                "derivation_steps": [{"title": "移项", "content": "x=2-1。"}],
                "when_to_use": ["解一元一次方程"],
                "common_mistakes": [],
                "connection_to_problem": "用于当前方程。",
            },
        }
    )


def _delete_paper_without_foreign_keys(database_path: Path, paper_id: str) -> None:
    with sqlite3.connect(database_path) as conn:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("DELETE FROM exam_papers WHERE id = ?", (paper_id,))


def _assert_foreign_keys_clean(client: TestClient) -> None:
    with client.app.state.db.connect() as conn:
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_delete_last_paper_session_prunes_only_its_paper(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    first_paper = client.app.state.sessions.create_exam_paper("一模试卷")
    other_paper = client.app.state.sessions.create_exam_paper("二模试卷")
    first = _create_session(client, profile_id, paper_id=first_paper["id"])
    second = _create_session(client, profile_id, paper_id=first_paper["id"])
    _create_session(client, profile_id, paper_id=other_paper["id"])

    assert client.delete(f"/api/sessions/{first['id']}").status_code == 204
    assert client.app.state.sessions.get_exam_paper(first_paper["id"])["id"] == first_paper["id"]

    assert client.delete(f"/api/sessions/{second['id']}").status_code == 204
    with pytest.raises(KeyError):
        client.app.state.sessions.get_exam_paper(first_paper["id"])
    assert client.app.state.sessions.get_exam_paper(other_paper["id"])["id"] == other_paper["id"]


def test_delete_session_preserves_saved_card_and_drops_pending_card_and_paper(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    paper = client.app.state.sessions.create_exam_paper("卡片归档卷")
    session = _create_session(client, profile_id, paper_id=paper["id"])
    _, _, saved_card = client.app.state.sessions.record_tutor_action(
        session["id"],
        _knowledge_card_turn("已保存知识卡"),
        action_index=0,
    )
    client.app.state.sessions.save_card(saved_card["id"], session_id=session["id"])
    _, _, pending_card = client.app.state.sessions.record_tutor_action(
        session["id"],
        _knowledge_card_turn("待处理知识卡"),
        action_index=1,
    )

    assert client.delete(f"/api/sessions/{session['id']}").status_code == 204

    remaining = {
        row["id"]: row
        for row in client.app.state.sessions.list_cards(include_pending=True)
    }
    assert set(remaining) == {saved_card["id"]}
    assert remaining[saved_card["id"]]["live_session_id"] is None
    assert pending_card["id"] not in remaining
    with pytest.raises(KeyError):
        client.app.state.sessions.get_exam_paper(paper["id"])


def test_delete_all_sessions_atomically_clears_all_papers(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    for name in ("期中卷", "期末卷"):
        paper = client.app.state.sessions.create_exam_paper(name)
        _create_session(client, profile_id, paper_id=paper["id"])

    assert client.delete("/api/sessions").status_code == 204
    assert client.app.state.sessions.list_history() == []
    assert client.app.state.sessions.list_exam_papers() == []


@pytest.mark.parametrize("status", ["queued", "running"])
def test_delete_session_rejects_durable_active_run(tmp_path: Path, status: str):
    client, profile_id = _client_and_profile(tmp_path)
    paper = client.app.state.sessions.create_exam_paper(f"{status} 试卷")
    session = _create_session(client, profile_id, paper_id=paper["id"])
    run = client.app.state.sessions.create_run(session["id"])
    if status == "running":
        client.app.state.sessions.mark_run_running(run["id"])

    response = client.delete(f"/api/sessions/{session['id']}")

    assert response.status_code == 409
    assert client.app.state.sessions.get(session["id"])["id"] == session["id"]
    assert client.app.state.sessions.get_exam_paper(paper["id"])["id"] == paper["id"]


def test_delete_all_sessions_rejects_any_durable_active_run(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    paper = client.app.state.sessions.create_exam_paper("持久化运行卷")
    session = _create_session(client, profile_id, paper_id=paper["id"])
    client.app.state.sessions.create_run(session["id"])

    response = client.delete("/api/sessions")

    assert response.status_code == 409
    assert client.app.state.sessions.get(session["id"])["id"] == session["id"]
    assert client.app.state.sessions.get_exam_paper(paper["id"])["id"] == paper["id"]


def test_paper_prune_failure_rolls_back_session_and_keeps_logs(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path, raise_server_exceptions=False)
    paper = client.app.state.sessions.create_exam_paper("回滚试卷")
    session = _create_session(client, profile_id, paper_id=paper["id"])
    logger = client.app.state.session_logger
    logger.log_session_started(
        session_id=session["id"],
        model="local-demo",
        grade_band="junior",
        problem_text=session["problem_text"],
        student_initial_thought="",
    )
    with client.app.state.db.connect() as conn:
        conn.execute(
            f"""
            CREATE TRIGGER block_target_paper_delete
            BEFORE DELETE ON exam_papers
            WHEN OLD.id = '{paper['id']}'
            BEGIN
              SELECT RAISE(ABORT, 'paper delete blocked');
            END
            """
        )

    response = client.delete(f"/api/sessions/{session['id']}")

    assert response.status_code == 500
    assert client.app.state.sessions.get(session["id"])["id"] == session["id"]
    assert client.app.state.sessions.get_exam_paper(paper["id"])["id"] == paper["id"]
    assert (logger.log_dir / f"{session['id']}.jsonl").exists()
    assert (logger.log_dir / f"{session['id']}.log.md").exists()


def test_log_failure_after_single_delete_is_warning_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    client, profile_id = _client_and_profile(tmp_path, raise_server_exceptions=False)
    paper = client.app.state.sessions.create_exam_paper("日志失败卷")
    session = _create_session(client, profile_id, paper_id=paper["id"])

    def fail_delete(_: str) -> None:
        raise OSError("模拟日志删除失败")

    warnings: list[tuple[str, dict]] = []
    monkeypatch.setattr(client.app.state.session_logger, "delete", fail_delete)
    monkeypatch.setattr(
        session_routes.LOGGER,
        "warning",
        lambda message, *args, **kwargs: warnings.append((message, kwargs)),
    )

    response = client.delete(f"/api/sessions/{session['id']}")

    assert response.status_code == 204
    with pytest.raises(KeyError):
        client.app.state.sessions.get(session["id"])
    with pytest.raises(KeyError):
        client.app.state.sessions.get_exam_paper(paper["id"])
    assert "diagnostic session logs" in warnings[0][0]
    assert warnings[0][1]["exc_info"] is True


def test_log_failure_after_delete_all_is_warning_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    client, profile_id = _client_and_profile(tmp_path, raise_server_exceptions=False)
    paper = client.app.state.sessions.create_exam_paper("批量日志失败卷")
    _create_session(client, profile_id, paper_id=paper["id"])

    def fail_delete_all() -> None:
        raise OSError("模拟批量日志删除失败")

    warnings: list[tuple[str, dict]] = []
    monkeypatch.setattr(client.app.state.session_logger, "delete_all", fail_delete_all)
    monkeypatch.setattr(
        session_routes.LOGGER,
        "warning",
        lambda message, *args, **kwargs: warnings.append((message, kwargs)),
    )

    response = client.delete("/api/sessions")

    assert response.status_code == 204
    assert client.app.state.sessions.list_history() == []
    assert client.app.state.sessions.list_exam_papers() == []
    assert "diagnostic session logs" in warnings[0][0]
    assert warnings[0][1]["exc_info"] is True


def test_repository_create_rejects_stale_paper_with_domain_error(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    paper = client.app.state.sessions.create_exam_paper("过期直接创建卷")
    _delete_paper_without_foreign_keys(client.app.state.db.path, paper["id"])

    with pytest.raises(LookupError) as error:
        _create_session(client, profile_id, paper_id=paper["id"])

    assert type(error.value).__name__ == "ExamPaperNotFoundError"


def test_batch_start_validates_papers_inside_its_transaction_and_rolls_back(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    valid_paper = client.app.state.sessions.create_exam_paper("有效批量卷")
    stale_paper = client.app.state.sessions.create_exam_paper("过期批量卷")
    _delete_paper_without_foreign_keys(client.app.state.db.path, stale_paper["id"])
    first_id = "sess_11111111111111111111111111111111"
    second_id = "sess_22222222222222222222222222222222"

    with pytest.raises(LookupError) as error:
        InputAcceptanceService(client.app.state.sessions).start_sessions(
            [
                _start_request(
                    profile_id,
                    valid_paper["id"],
                    session_id=first_id,
                    client_message_id="valid-paper",
                ),
                _start_request(
                    profile_id,
                    stale_paper["id"],
                    session_id=second_id,
                    client_message_id="stale-paper",
                ),
            ]
        )

    assert type(error.value).__name__ == "ExamPaperNotFoundError"
    with pytest.raises(KeyError):
        client.app.state.sessions.get(first_id)
    with pytest.raises(KeyError):
        client.app.state.sessions.get(second_id)


@pytest.mark.parametrize("endpoint", ["create", "start"])
def test_session_routes_report_stale_paper_with_stable_400(tmp_path: Path, endpoint: str):
    client, profile_id = _client_and_profile(tmp_path, raise_server_exceptions=False)
    paper = client.app.state.sessions.create_exam_paper(f"过期 {endpoint} 卷")
    _delete_paper_without_foreign_keys(client.app.state.db.path, paper["id"])
    body = {
        "grade_band": "junior",
        "subject": "math",
        "model_profile_id": profile_id,
        "paper_id": paper["id"],
        "problem_text": "解方程 x+1=2。",
        "student_initial_thought": "",
    }
    if endpoint == "start":
        body.update(
            {
                "session_id": "sess_33333333333333333333333333333333",
                "client_message_id": "stale-route-paper",
                "message": "请帮我分析。",
            }
        )

    response = client.post("/api/sessions" if endpoint == "create" else "/api/sessions/start", json=body)

    assert response.status_code == 400
    assert response.json()["detail"] == MISSING_PAPER_DETAIL


def test_restore_reports_stale_source_paper_with_stable_400(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path, raise_server_exceptions=False)
    paper = client.app.state.sessions.create_exam_paper("过期恢复卷")
    source = _create_session(client, profile_id, paper_id=paper["id"])
    _delete_paper_without_foreign_keys(client.app.state.db.path, paper["id"])

    response = client.post(
        "/api/sessions/restore",
        json={"session_id": source["id"], "model_profile_id": profile_id},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == MISSING_PAPER_DETAIL


def test_create_vs_delete_never_leaves_a_dangling_paper_reference(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    paper = client.app.state.sessions.create_exam_paper("并发创建卷")
    original = _create_session(client, profile_id, paper_id=paper["id"])
    barrier = Barrier(2)

    def delete_original():
        barrier.wait()
        client.app.state.sessions.delete(original["id"])
        return "deleted"

    def create_replacement():
        barrier.wait()
        try:
            return ("created", _create_session(client, profile_id, paper_id=paper["id"]))
        except Exception as exc:  # The delete may commit first.
            return ("rejected", exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        delete_future = executor.submit(delete_original)
        create_future = executor.submit(create_replacement)
        assert delete_future.result() == "deleted"
        outcome, value = create_future.result()

    if outcome == "created":
        assert client.app.state.sessions.get(value["id"])["paper_id"] == paper["id"]
        assert client.app.state.sessions.get_exam_paper(paper["id"])["id"] == paper["id"]
    else:
        assert type(value).__name__ == "ExamPaperNotFoundError"
        with pytest.raises(KeyError):
            client.app.state.sessions.get_exam_paper(paper["id"])
    _assert_foreign_keys_clean(client)


def test_restore_vs_delete_never_leaves_a_dangling_paper_reference(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    paper = client.app.state.sessions.create_exam_paper("并发恢复卷")
    source = _create_session(client, profile_id, paper_id=paper["id"])
    barrier = Barrier(2)

    def delete_source():
        barrier.wait()
        client.app.state.sessions.delete(source["id"])
        return "deleted"

    def restore_source():
        barrier.wait()
        try:
            return ("restored", client.app.state.sessions.restore(source["id"], profile_id))
        except Exception as exc:  # The delete may commit first.
            return ("rejected", exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        delete_future = executor.submit(delete_source)
        restore_future = executor.submit(restore_source)
        assert delete_future.result() == "deleted"
        outcome, value = restore_future.result()

    if outcome == "restored":
        assert client.app.state.sessions.get(value["id"])["paper_id"] == paper["id"]
        assert client.app.state.sessions.get_exam_paper(paper["id"])["id"] == paper["id"]
    else:
        assert isinstance(value, LookupError)
        with pytest.raises(KeyError):
            client.app.state.sessions.get_exam_paper(paper["id"])
    _assert_foreign_keys_clean(client)
