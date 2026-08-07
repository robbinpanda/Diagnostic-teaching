from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.schemas import ModelProfileCreate, SessionCreate
from app.main import create_app
from app.storage.card_folder_repository import resolve_card_folder, session_card_folder_id
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, SessionRepository
from app.storage.security import SecretBox
from app.storage.session_logger import SessionLogger


def _client(tmp_path: Path) -> TestClient:
    app = create_app()
    db = Database(tmp_path / "app.db")
    app.state.db = db
    app.state.model_profiles = ModelProfileRepository(db, SecretBox(tmp_path / "secret.key"))
    app.state.sessions = SessionRepository(db)
    app.state.session_logger = SessionLogger(tmp_path / "sessions")
    app.state.model_profiles.create(
        ModelProfileCreate(
            display_name="Local Demo",
            provider="local_demo",
            base_url="https://local.demo/v1",
            api_key="demo-key",
            model="local-demo",
        )
    )
    return TestClient(app)


def _folders_by_kind(client: TestClient) -> dict[str, list[dict]]:
    folders = client.get("/api/card-folders").json()["folders"]
    grouped: dict[str, list[dict]] = {}
    for folder in folders:
        grouped.setdefault(str(folder["managed_kind"]), []).append(folder)
    return grouped


def test_exam_paper_api_creates_managed_folder_and_reuses_name_identity(tmp_path: Path):
    client = _client(tmp_path)

    created = client.post("/api/exam-papers", json={"name": "  MidTerm A  "})
    duplicate = client.post("/api/exam-papers", json={"name": "midterm a"})

    assert created.status_code == 201
    assert created.json()["name"] == "MidTerm A"
    assert created.json()["card_folder_id"]
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == created.json()["id"]
    assert duplicate.json()["card_folder_id"] == created.json()["card_folder_id"]

    folders = client.get("/api/card-folders").json()["folders"]
    assert all("managed_key" not in folder for folder in folders)
    root = next(folder for folder in folders if folder["managed_kind"] == "paper_archive_root")
    paper_folder = next(folder for folder in folders if folder["id"] == created.json()["card_folder_id"])
    assert root["name"] == "按试卷归档"
    assert paper_folder["name"] == "MidTerm A"
    assert paper_folder["parent_id"] == root["id"]
    assert paper_folder["managed_kind"] == "paper_archive"

    with client.app.state.db.connect() as conn:
        conn.execute("DELETE FROM exam_papers WHERE id = ?", (created.json()["id"],))
    recreated = client.post("/api/exam-papers", json={"name": "MIDTERM A"})
    assert recreated.status_code == 201
    assert recreated.json()["id"] != created.json()["id"]
    assert recreated.json()["card_folder_id"] == created.json()["card_folder_id"]

    upper_unicode = client.post("/api/exam-papers", json={"name": "Ä卷"}).json()
    lower_unicode = client.post("/api/exam-papers", json={"name": "ä卷"}).json()
    assert upper_unicode["id"] != lower_unicode["id"]
    assert upper_unicode["card_folder_id"] != lower_unicode["card_folder_id"]


def test_runtime_ensure_adopts_existing_same_name_child(tmp_path: Path):
    client = _client(tmp_path)
    root = _folders_by_kind(client)["paper_archive_root"][0]
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            INSERT INTO card_folders (
              id, name, parent_id, is_system, default_card_type,
              managed_kind, managed_key, created_at, updated_at
            ) VALUES (
              'folder_existing_runtime_child', '运行时认领卷', ?, 0, NULL,
              NULL, NULL, 'now', 'now'
            )
            """,
            (root["id"],),
        )

    paper = client.post("/api/exam-papers", json={"name": "运行时认领卷"})

    assert paper.status_code == 201
    assert paper.json()["card_folder_id"] == "folder_existing_runtime_child"
    adopted = next(
        folder
        for folder in client.get("/api/card-folders").json()["folders"]
        if folder["id"] == "folder_existing_runtime_child"
    )
    assert adopted["managed_kind"] == "paper_archive"
    assert adopted["parent_id"] == root["id"]


def test_existing_paper_with_invalid_managed_binding_returns_stable_conflict(tmp_path: Path):
    client = _client(tmp_path)
    paper = client.post("/api/exam-papers", json={"name": "损坏绑定卷"}).json()
    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            UPDATE card_folders
            SET managed_kind = NULL, managed_key = NULL
            WHERE id = ?
            """,
            (paper["card_folder_id"],),
        )

    response = client.post("/api/exam-papers", json={"name": "损坏绑定卷"})

    assert response.status_code == 409
    assert response.json()["detail"] == "试卷绑定的归档目录状态冲突"


def test_managed_folders_are_protected_but_legacy_children_can_move_out(tmp_path: Path):
    client = _client(tmp_path)
    paper = client.post("/api/exam-papers", json={"name": "受保护试卷"}).json()
    folders = client.get("/api/card-folders").json()["folders"]
    root = next(folder for folder in folders if folder["managed_kind"] == "paper_archive_root")
    paper_folder = next(folder for folder in folders if folder["id"] == paper["card_folder_id"])

    assert client.patch(
        f"/api/card-folders/{root['id']}", json={"name": "新归档根"}
    ).status_code == 409
    assert client.patch(
        f"/api/card-folders/{paper_folder['id']}", json={"parent_id": None}
    ).status_code == 409
    assert client.delete(f"/api/card-folders/{root['id']}").status_code == 409
    assert client.delete(f"/api/card-folders/{paper_folder['id']}").status_code == 409
    assert client.post(
        "/api/card-folders", json={"name": "禁止的新目录", "parent_id": root["id"]}
    ).status_code == 409

    ordinary = client.post("/api/card-folders", json={"name": "普通目录"}).json()
    assert client.patch(
        f"/api/card-folders/{ordinary['id']}", json={"parent_id": root["id"]}
    ).status_code == 409

    with client.app.state.db.connect() as conn:
        conn.execute(
            """
            INSERT INTO card_folders (
              id, name, parent_id, is_system, default_card_type,
              managed_kind, managed_key, created_at, updated_at
            ) VALUES (
              'folder_legacy_archive_child', '遗留普通子目录', ?, 0, NULL,
              NULL, NULL, 'now', 'now'
            )
            """,
            (root["id"],),
        )
    assert client.patch(
        "/api/card-folders/folder_legacy_archive_child", json={"name": "不能原地改名"}
    ).status_code == 409
    moved = client.patch(
        "/api/card-folders/folder_legacy_archive_child", json={"parent_id": None}
    )
    assert moved.status_code == 200
    assert moved.json()["parent_id"] is None
    assert client.delete("/api/card-folders/folder_legacy_archive_child").status_code == 204


def test_concurrent_same_name_exam_paper_creation_uses_one_managed_folder(tmp_path: Path):
    client = _client(tmp_path)

    def create_paper(_: int):
        return client.app.state.sessions.create_exam_paper("并发归档卷")

    with ThreadPoolExecutor(max_workers=8) as executor:
        papers = list(executor.map(create_paper, range(16)))

    assert len({paper["id"] for paper in papers}) == 1
    assert len({paper["card_folder_id"] for paper in papers}) == 1
    folder_id = papers[0]["card_folder_id"]
    with client.app.state.db.connect() as conn:
        assert conn.execute(
            "SELECT COUNT(*) FROM card_folders WHERE id = ? AND managed_kind = 'paper_archive'",
            (folder_id,),
        ).fetchone()[0] == 1
        assert conn.execute(
            "SELECT COUNT(*) FROM exam_papers WHERE card_folder_id = ?", (folder_id,)
        ).fetchone()[0] == 1


def test_session_folder_resolution_prefers_explicit_then_paper_then_type_default(
    tmp_path: Path,
):
    client = _client(tmp_path)
    profile_id = client.get("/api/model-profiles").json()["profiles"][0]["id"]
    paper = client.post("/api/exam-papers", json={"name": "目录解析卷"}).json()
    custom = client.post("/api/card-folders", json={"name": "手动目录"}).json()
    paper_session = client.app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile_id,
            paper_id=paper["id"],
            problem_text="paper problem",
        )
    )
    paperless_session = client.app.state.sessions.create(
        SessionCreate(
            grade_band="junior",
            subject="math",
            model_profile_id=profile_id,
            problem_text="paperless problem",
        )
    )

    with client.app.state.db.connect() as conn:
        assert session_card_folder_id(
            conn, paper_session["id"], "knowledge_card"
        ) == paper["card_folder_id"]
        assert session_card_folder_id(
            conn, paperless_session["id"], "problem_card"
        ) == "folder_default_problem"
        assert resolve_card_folder(
            conn,
            None,
            "knowledge_card",
            preferred_folder_id=paper["card_folder_id"],
        ) == paper["card_folder_id"]
        assert resolve_card_folder(
            conn,
            custom["id"],
            "knowledge_card",
            preferred_folder_id=paper["card_folder_id"],
        ) == custom["id"]
        with pytest.raises(KeyError):
            session_card_folder_id(conn, "sess_missing", "knowledge_card")
