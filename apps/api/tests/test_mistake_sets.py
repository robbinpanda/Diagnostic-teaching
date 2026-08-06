from __future__ import annotations

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

    response = client.post(
        "/api/mistake-sets",
        json={"name": "  期末复习  ", "session_ids": [session_b["id"], session_a["id"]]},
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
    created = client.post(
        "/api/mistake-sets",
        json={"name": "长期错题集", "session_ids": [session["id"]]},
    ).json()

    deleted = client.delete(f"/api/sessions/{session['id']}")
    opened = client.get(f"/api/mistake-sets/{created['id']}")

    assert deleted.status_code == 204
    assert opened.status_code == 200
    assert opened.json()["items"][0] == {
        **created["items"][0],
        "source_session_id": None,
    }
    assert opened.json()["items"][0]["source_paper_name"] == "会被删除的试卷"
    assert opened.json()["items"][0]["problem_text"] == "保留下来的题目"


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
        json={"name": "重复", "session_ids": [session["id"], session["id"]]},
    )
    missing = client.post(
        "/api/mistake-sets",
        json={"name": "缺失", "session_ids": ["sess_missing"]},
    )
    blank = client.post(
        "/api/mistake-sets",
        json={"name": "   ", "session_ids": [session["id"]]},
    )

    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == "错题集不能重复选择同一题目"
    assert missing.status_code == 404
    assert missing.json()["detail"] == "部分题目已经不存在，请刷新错题合集后重试"
    assert blank.status_code == 422


def test_get_missing_mistake_set_returns_404(tmp_path: Path):
    client, _ = _client(tmp_path)

    response = client.get("/api/mistake-sets/mistake_set_missing")

    assert response.status_code == 404
    assert response.json()["detail"] == "错题集不存在"
