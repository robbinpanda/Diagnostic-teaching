from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate
from app.main import create_app
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger


def _client(tmp_path: Path) -> tuple[TestClient, str]:
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


def _session(
    client: TestClient,
    profile_id: str,
    *,
    paper_id: str,
    problem_text: str,
    image_data_url: str | None = None,
):
    return client.app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile_id,
            paper_id=paper_id,
            problem_text=problem_text,
            student_initial_thought="",
            problem_image_data_url=image_data_url,
        )
    )


def _add_problem_card(client: TestClient, session_id: str):
    content = {
        "type": "problem_card",
        "title": "三角形边长复盘",
        "problem_summary": "已知三角形两边，求第三边范围。",
        "solution_overview": "使用三角形两边之和大于第三边。",
        "solution_steps": [
            {
                "step": 1,
                "title": "列出不等式",
                "reasoning": "第三边同时小于两边之和且大于两边之差。",
                "result": "$|a-b|<c<a+b$",
            }
        ],
        "pitfalls": ["不要漏掉下界"],
        "how_to_think": ["看到三边关系就想到三角形不等式"],
        "final_answer": "$|a-b|<c<a+b$",
    }
    with client.app.state.db.connect() as conn:
        folder_id = conn.execute(
            """
            SELECT p.card_folder_id
            FROM sessions s
            JOIN exam_papers p ON p.id = s.paper_id
            WHERE s.id = ?
            """,
            (session_id,),
        ).fetchone()["card_folder_id"]
        conn.execute(
            """
            INSERT INTO study_cards (
              id, session_id, live_session_id, card_type, title, content_json,
              source_action_id, source_message_id, created_at, saved_at, folder_id
            ) VALUES (?, ?, ?, 'problem_card', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"card_{session_id}",
                session_id,
                session_id,
                content["title"],
                json.dumps(content, ensure_ascii=False),
                f"action_{session_id}",
                f"message_{session_id}",
                "2026-08-07T00:00:00Z",
                "2026-08-07T00:00:00Z",
                folder_id,
            ),
        )
    return content


def _problem_card_id(session_id: str) -> str:
    return f"card_{session_id}"


def test_mistake_set_api_snapshots_cross_paper_sessions_in_request_order(tmp_path: Path):
    client, profile_id = _client(tmp_path)
    paper_a = client.post("/api/exam-papers", json={"name": "代数卷"}).json()
    paper_b = client.post("/api/exam-papers", json={"name": "几何卷"}).json()
    session_a = _session(
        client,
        profile_id,
        paper_id=paper_a["id"],
        problem_text="解方程 $2x+3=11$",
    )
    session_b = _session(
        client,
        profile_id,
        paper_id=paper_b["id"],
        problem_text="求三角形第三边范围",
        image_data_url="data:image/png;base64,c25hcHNob3Q=",
    )
    _add_problem_card(client, session_a["id"])
    problem_card = _add_problem_card(client, session_b["id"])

    response = client.post(
        "/api/mistake-sets",
        json={"name": "  期末复习  ", "card_ids": [_problem_card_id(session_b["id"]), _problem_card_id(session_a["id"])]},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "期末复习"
    assert [item["source_session_id"] for item in payload["items"]] == [
        session_b["id"],
        session_a["id"],
    ]
    assert [item["source_paper_name"] for item in payload["items"]] == ["几何卷", "代数卷"]
    assert payload["items"][0]["problem_image_data_url"] == "data:image/png;base64,c25hcHNob3Q="
    assert payload["items"][0]["problem_card"] == problem_card
    assert payload["items"][1]["problem_card"] is not None
    assert [item["position"] for item in payload["items"]] == [0, 1]

    listed = client.get("/api/mistake-sets")
    opened = client.get(f"/api/mistake-sets/{payload['id']}")
    assert listed.status_code == 200
    assert listed.json()["mistake_sets"] == [payload]
    assert opened.status_code == 200
    assert opened.json() == payload


def test_mistake_set_snapshot_survives_source_session_and_paper_deletion(tmp_path: Path):
    client, profile_id = _client(tmp_path)
    paper = client.post("/api/exam-papers", json={"name": "会被删除的试卷"}).json()
    session = _session(
        client,
        profile_id,
        paper_id=paper["id"],
        problem_text="保留下来的题目",
    )
    problem_card = _add_problem_card(client, session["id"])
    deleted = client.delete(f"/api/sessions/{session['id']}")
    cards_after_delete = client.get("/api/cards", params={"card_type": "problem_card"})
    created_response = client.post(
        "/api/mistake-sets",
        json={"name": "长期错题集", "card_ids": [_problem_card_id(session["id"])]},
    )
    created = created_response.json()
    opened = client.get(f"/api/mistake-sets/{created['id']}")

    assert deleted.status_code == 204
    assert cards_after_delete.status_code == 200
    assert [card["id"] for card in cards_after_delete.json()["cards"]] == [_problem_card_id(session["id"])]
    assert created_response.status_code == 201
    assert opened.status_code == 200
    assert opened.json()["items"][0] == created["items"][0]
    assert opened.json()["items"][0]["source_session_id"] is None
    assert opened.json()["items"][0]["source_paper_name"] == "会被删除的试卷"
    assert opened.json()["items"][0]["problem_text"] == problem_card["problem_summary"]
    assert opened.json()["items"][0]["problem_card"] == problem_card


def test_mistake_set_create_rejects_duplicates_missing_sessions_and_blank_names(tmp_path: Path):
    client, profile_id = _client(tmp_path)
    paper = client.post("/api/exam-papers", json={"name": "校验卷"}).json()
    session = _session(
        client,
        profile_id,
        paper_id=paper["id"],
        problem_text="校验题",
    )

    duplicate = client.post(
        "/api/mistake-sets",
        json={"name": "重复", "card_ids": [_problem_card_id(session["id"]), _problem_card_id(session["id"])]},
    )
    missing = client.post(
        "/api/mistake-sets",
        json={"name": "缺失", "card_ids": ["card_missing"]},
    )
    blank = client.post(
        "/api/mistake-sets",
        json={"name": "   ", "card_ids": [_problem_card_id(session["id"])]},
    )

    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == "错题集不能重复选择同一题目"
    assert missing.status_code == 404
    assert missing.json()["detail"] == "部分题目卡片已经不存在，请刷新错题卡片库后重试"
    assert blank.status_code == 422


def test_get_missing_mistake_set_returns_404(tmp_path: Path):
    client, _ = _client(tmp_path)

    response = client.get("/api/mistake-sets/mistake_set_missing")

    assert response.status_code == 404
    assert response.json()["detail"] == "错题集不存在"
