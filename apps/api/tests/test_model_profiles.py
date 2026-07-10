import base64
import json
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.core.schemas import ModelProfileCreate
from app.main import create_app
from app.routes import model_profiles, problem_images
from app.routes.problem_images import build_student_summary
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, host_from_url
from app.storage.security import SecretBox


def test_model_profile_encrypts_api_key(tmp_path: Path):
    db = Database(tmp_path / "app.db")
    repo = ModelProfileRepository(db, SecretBox(tmp_path / "secret.key"))

    row = repo.create(
        ModelProfileCreate(
            display_name="Test Model",
            provider="openai_compatible",
            base_url="https://example.com/v1",
            api_key="sk-test-secret",
            model="test-model",
            tags=["math"],
        )
    )

    assert row["api_key_ciphertext"] != "sk-test-secret"
    assert row["api_key_mask"].endswith("cret")
    assert repo.decrypt_api_key(row) == "sk-test-secret"
    assert host_from_url(row["base_url"]) == "example.com"


def test_delete_model_profile_endpoint_hides_profile(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(app.state.db, SecretBox(tmp_path / "secret.key"))
    client = TestClient(app)

    created = client.post(
        "/api/model-profiles",
        json={
            "display_name": "Delete Me",
            "provider": "openai_compatible",
            "base_url": "https://example.com/v1",
            "api_key": "sk-test-secret",
            "model": "test-model",
            "tags": ["math"],
        },
    )
    assert created.status_code == 200
    profile_id = created.json()["id"]

    deleted = client.delete(f"/api/model-profiles/{profile_id}")
    assert deleted.status_code == 204

    listed = client.get("/api/model-profiles")
    assert listed.status_code == 200
    assert listed.json()["profiles"] == []

    deleted_again = client.delete(f"/api/model-profiles/{profile_id}")
    assert deleted_again.status_code == 404


def test_update_model_profile_changes_editable_fields_and_can_replace_key(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(app.state.db, SecretBox(tmp_path / "secret.key"))
    client = TestClient(app)

    created = client.post(
        "/api/model-profiles",
        json={
            "display_name": "Old Name",
            "provider": "openai_compatible",
            "base_url": "https://example.com/v1",
            "api_key": "sk-old-secret",
            "model": "old-model",
            "tags": ["math"],
        },
    )
    profile_id = created.json()["id"]

    updated = client.patch(
        f"/api/model-profiles/{profile_id}",
        json={
            "display_name": "Vision Model",
            "base_url": "https://vision.example.com/v1",
            "api_key": "sk-new-secret",
            "model": "vision-model",
            "max_output_tokens": 8000,
            "is_multimodal": True,
        },
    )

    assert updated.status_code == 200
    payload = updated.json()
    assert payload["display_name"] == "Vision Model"
    assert payload["base_url"] == "https://vision.example.com/v1"
    assert payload["model"] == "vision-model"
    assert payload["max_output_tokens"] == 8000
    assert payload["is_multimodal"] is True
    row = app.state.model_profiles.get(profile_id)
    assert app.state.model_profiles.decrypt_api_key(row) == "sk-new-secret"


def test_problem_image_analysis_requires_multimodal_profile(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(app.state.db, SecretBox(tmp_path / "secret.key"))
    client = TestClient(app)

    created = client.post(
        "/api/model-profiles",
        json={
            "display_name": "Text Only",
            "provider": "local_demo",
            "base_url": "https://local.demo/v1",
            "api_key": "demo-key",
            "model": "local-demo",
            "is_multimodal": False,
        },
    )
    response = client.post(
        "/api/problem-images/analyze",
        json={
            "model_profile_id": created.json()["id"],
            "image_base64": "ZmFrZQ==",
            "content_type": "image/png",
        },
    )

    assert response.status_code == 400
    assert "多模态" in response.json()["detail"]


def test_problem_image_analysis_local_demo_extracts_problem_text(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(app.state.db, SecretBox(tmp_path / "secret.key"))
    client = TestClient(app)

    created = client.post(
        "/api/model-profiles",
        json={
            "display_name": "Vision Demo",
            "provider": "local_demo",
            "base_url": "https://local.demo/v1",
            "api_key": "demo-key",
            "model": "local-demo",
            "is_multimodal": True,
        },
    )
    response = client.post(
        "/api/problem-images/analyze",
        json={
            "model_profile_id": created.json()["id"],
            "image_base64": "ZmFrZQ==",
            "content_type": "image/png",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "最大值" in payload["problem_text"]
    assert payload["needs_diagram"] is False
    assert payload["student_work_summary"] == ""


def test_student_summary_stays_empty_when_no_work_was_recognized():
    assert build_student_summary({"problem_text": "求 x 的值"}) == ""


def test_text_only_image_result_does_not_crop_even_if_model_returns_bbox(tmp_path: Path, monkeypatch):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(app.state.db, SecretBox(tmp_path / "secret.key"))
    client = TestClient(app)

    created = client.post(
        "/api/model-profiles",
        json={
            "display_name": "Vision Model",
            "provider": "openai_compatible",
            "base_url": "https://vision.example.com/v1",
            "api_key": "vision-key",
            "model": "vision-model",
            "is_multimodal": True,
        },
    )

    async def fake_analyze_problem_image(profile, image_data_url):
        return json.dumps(
            {
                "problem_text": "计算 1+1。",
                "needs_diagram": False,
                "diagram_bbox": {"x": 0, "y": 0, "width": 1, "height": 1},
                "student_work_summary": "",
                "answer_text": "",
                "correctness": "not_present",
                "mistake_summary": "",
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(problem_images, "analyze_problem_image", fake_analyze_problem_image)
    image_buffer = BytesIO()
    Image.new("RGB", (20, 20), "white").save(image_buffer, format="PNG")
    encoded = base64.b64encode(image_buffer.getvalue()).decode("ascii")

    response = client.post(
        "/api/problem-images/analyze",
        json={
            "model_profile_id": created.json()["id"],
            "image_base64": encoded,
            "content_type": "image/png",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["needs_diagram"] is False
    assert payload["diagram_image_data_url"] is None
    assert payload["student_work_summary"] == ""


def test_edit_connection_test_uses_saved_api_key_when_input_is_blank(tmp_path: Path, monkeypatch):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(app.state.db, SecretBox(tmp_path / "secret.key"))
    client = TestClient(app)
    created = client.post(
        "/api/model-profiles",
        json={
            "display_name": "Saved Model",
            "provider": "openai_compatible",
            "base_url": "https://old.example.com/v1",
            "api_key": "saved-secret-key",
            "model": "old-model",
        },
    )
    captured = {}

    async def fake_test_connection(profile):
        captured["profile"] = profile
        return True, 12, "连接成功"

    monkeypatch.setattr(model_profiles, "test_connection", fake_test_connection)
    response = client.post(
        "/api/model-profiles/test",
        json={
            "profile_id": created.json()["id"],
            "provider": "openai_compatible",
            "base_url": "https://new.example.com/v1",
            "model": "new-model",
            "max_output_tokens": 8000,
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    tested_profile = captured["profile"]
    assert tested_profile.api_key == "saved-secret-key"
    assert tested_profile.base_url == "https://new.example.com/v1"
    assert tested_profile.model == "new-model"
