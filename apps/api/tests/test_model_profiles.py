import base64
import json
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image, ImageColor

from app.core.schemas import ModelProfileCreate
from app.llm.opencode_free_models import (
    BUILTIN_FREE_MODELS,
    OPENCODE_PUBLIC_API_KEY,
    OpenCodeFreeModel,
    parse_opencode_free_models,
)
from app.llm.provider import IMAGE_ANALYSIS_PROMPT
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


def test_opencode_catalog_keeps_free_supported_models_and_image_metadata():
    models = parse_opencode_free_models(
        {
            "opencode": {
                "id": "opencode",
                "npm": "@ai-sdk/openai-compatible",
                "api": "https://opencode.ai/zen/v1",
                "models": {
                    "vision-free": {
                        "id": "vision-free",
                        "name": "Vision Free",
                        "cost": {"input": 0, "output": 0},
                        "modalities": {"input": ["text", "image"], "output": ["text"]},
                    },
                    "anthropic-free": {
                        "id": "anthropic-free",
                        "name": "Anthropic Free",
                        "cost": {"input": 0, "output": 0},
                        "provider": {
                            "npm": "@ai-sdk/anthropic",
                            "api": "https://opencode.ai/zen/v1/messages",
                        },
                        "modalities": {"input": ["text"], "output": ["text"]},
                    },
                    "paid": {"id": "paid", "cost": {"input": 1, "output": 1}},
                    "old-free": {
                        "id": "old-free",
                        "status": "deprecated",
                        "cost": {"input": 0, "output": 0},
                    },
                    "unsupported-free": {
                        "id": "unsupported-free",
                        "cost": {"input": 0, "output": 0},
                        "provider": {"npm": "@ai-sdk/google"},
                    },
                },
            }
        }
    )

    assert [(model.model, model.provider, model.is_multimodal) for model in models] == [
        ("anthropic-free", "anthropic", False),
        ("vision-free", "openai_compatible", True),
    ]
    assert models[0].base_url.endswith("/messages")


def test_builtin_opencode_models_have_expected_multimodal_checkbox():
    capabilities = {model.model: model.is_multimodal for model in BUILTIN_FREE_MODELS}

    assert capabilities == {
        "hy3": False,
        "mimo-v2.5-free": True,
    }


def test_managed_opencode_profiles_sync_into_sqlite_and_cannot_be_changed(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    managed = (
        OpenCodeFreeModel(
            model="vision-free",
            name="Vision Free",
            provider="anthropic",
            base_url="https://opencode.ai/zen/v1/messages",
            is_multimodal=True,
        ),
    )
    first = app.state.model_profiles.sync_opencode_free_models(managed)
    second = app.state.model_profiles.sync_opencode_free_models(managed)
    client = TestClient(app)

    assert first[0]["id"] == second[0]["id"]
    assert app.state.model_profiles.decrypt_api_key(first[0]) == OPENCODE_PUBLIC_API_KEY
    listed = client.get("/api/model-profiles").json()["profiles"]
    assert len(listed) == 1
    assert listed[0]["display_name"] == "opencodefree-vision-free"
    assert listed[0]["provider"] == "anthropic"
    assert listed[0]["is_multimodal"] is True
    assert listed[0]["managed"] is True

    profile_id = listed[0]["id"]
    updated = client.patch(f"/api/model-profiles/{profile_id}", json={"is_multimodal": False})
    deleted = client.delete(f"/api/model-profiles/{profile_id}")

    assert updated.status_code == 409
    assert deleted.status_code == 409


def test_delete_model_profile_endpoint_hides_profile(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
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


def test_batch_delete_model_profiles_is_atomic_and_preserves_order(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    client = TestClient(app)

    created = client.post(
        "/api/model-profiles/batch",
        json={
            "display_name": "Example Cloud",
            "base_url": "https://example.com/v1",
            "api_key": "shared-secret",
            "models": [
                {"model": "first-model"},
                {"model": "keep-model"},
                {"model": "third-model"},
            ],
        },
    ).json()["profiles"]
    delete_ids = [created[2]["id"], created[0]["id"]]

    deleted = client.post(
        "/api/model-profiles/batch-delete",
        json={"profile_ids": delete_ids},
    )

    assert deleted.status_code == 200
    assert deleted.json()["deleted_profile_ids"] == delete_ids
    listed = client.get("/api/model-profiles").json()["profiles"]
    assert [profile["model"] for profile in listed] == ["keep-model"]


def test_batch_delete_rejects_managed_profile_without_partial_deletion(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    managed = app.state.model_profiles.sync_opencode_free_models(
        (
            OpenCodeFreeModel(
                model="vision-free",
                name="Vision Free",
                provider="openai_compatible",
                base_url="https://opencode.ai/zen/v1",
                is_multimodal=True,
            ),
        )
    )[0]
    client = TestClient(app)
    custom = client.post(
        "/api/model-profiles",
        json={
            "display_name": "Keep Me",
            "base_url": "https://example.com/v1",
            "api_key": "secret",
            "model": "custom-model",
        },
    ).json()

    deleted = client.post(
        "/api/model-profiles/batch-delete",
        json={"profile_ids": [custom["id"], managed["id"]]},
    )

    assert deleted.status_code == 409
    listed_ids = {
        profile["id"] for profile in client.get("/api/model-profiles").json()["profiles"]
    }
    assert listed_ids == {custom["id"], managed["id"]}


def test_update_model_profile_changes_editable_fields_and_can_replace_key(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
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


def test_batch_create_adds_multiple_models_for_one_supplier(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    client = TestClient(app)

    response = client.post(
        "/api/model-profiles/batch",
        json={
            "display_name": "Example Cloud",
            "provider": "openai_compatible",
            "base_url": "https://example.com/v1",
            "api_key": "shared-secret",
            "models": [
                {"model": "text-model", "is_multimodal": False},
                {"model": "vision-model", "is_multimodal": True},
            ],
            "tags": ["math"],
        },
    )

    assert response.status_code == 200
    profiles = response.json()["profiles"]
    assert [profile["model"] for profile in profiles] == ["text-model", "vision-model"]
    assert [profile["is_multimodal"] for profile in profiles] == [False, True]
    assert all(profile["display_name"] == "Example Cloud" for profile in profiles)
    for profile in profiles:
        row = app.state.model_profiles.get(profile["id"])
        assert app.state.model_profiles.decrypt_api_key(row) == "shared-secret"


def test_batch_create_rejects_duplicate_model_names(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    client = TestClient(app)

    response = client.post(
        "/api/model-profiles/batch",
        json={
            "display_name": "Example Cloud",
            "base_url": "https://example.com/v1",
            "api_key": "shared-secret",
            "models": [
                {"model": "same-model"},
                {"model": " same-model "},
            ],
        },
    )

    assert response.status_code == 400
    assert "不能重复" in response.json()["detail"]


def test_problem_image_analysis_requires_multimodal_profile(tmp_path: Path):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
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
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
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
    assert "$y=-2(x-3)^2+5$" in payload["problem_text"]
    assert payload["needs_diagram"] is False
    assert payload["student_work_summary"] == ""


def test_student_summary_stays_empty_when_no_work_was_recognized():
    assert build_student_summary({"problem_text": "求 x 的值"}) == ""


def test_image_analysis_prompt_forbids_inferring_student_work_from_answer():
    assert "只有最终答案" in IMAGE_ANALYSIS_PROMPT
    assert "禁止根据题目、最终答案、常见解法或上下文补全中间步骤" in IMAGE_ANALYSIS_PROMPT
    assert "不得扩写成“学生通过解方程得到 x=2”" in IMAGE_ANALYSIS_PROMPT


def test_image_analysis_prompt_requires_katex_and_complete_visible_markings():
    assert "可直接交给 KaTeX" in IMAGE_ANALYSIS_PROMPT
    assert (
        "所有数学变量、数字关系、公式、方程、不等式、几何符号都放在 `$...$` 中"
        in IMAGE_ANALYSIS_PROMPT
    )
    assert "不要把多行有效过程压缩" in IMAGE_ANALYSIS_PROMPT
    assert "勾、叉、圈、划线、得分、改错痕迹或批语" in IMAGE_ANALYSIS_PROMPT
    assert "就必须记录" in IMAGE_ANALYSIS_PROMPT


def test_answer_only_summary_adds_only_visible_answer_and_grading_trace():
    assert (
        build_student_summary(
            {
                "student_work_summary": "",
                "answer_text": "x=2",
                "correctness": "incorrect",
                "mistake_summary": "移项时符号错误",
            }
        )
        == "学生写出的答案：x=2\n图片中的批改痕迹：移项时符号错误"
    )


def test_student_summary_keeps_only_visible_process_and_answer():
    assert build_student_summary(
        {
            "student_work_summary": "学生写了“2x=4”，下一行写了“x=2”。",
            "answer_text": "x=2",
            "correctness": "correct",
        }
    ) == (
        "学生写了“2x=4”，下一行写了“x=2”。\n"
        "学生写出的答案：x=2\n"
        "图片中的批改痕迹：可见明确的对勾或正确标记。"
    )


def test_student_summary_keeps_explicit_red_pen_cross_without_inventing_reason():
    assert build_student_summary(
        {
            "student_work_summary": "学生依次写了 $2x=4$、$x=3$。",
            "answer_text": "$x=3$",
            "correctness": "incorrect",
            "mistake_summary": "红笔在 $x=3$ 这一行右侧画了叉，未写错误原因。",
        }
    ) == (
        "学生依次写了 $2x=4$、$x=3$。\n"
        "学生写出的答案：$x=3$\n"
        "图片中的批改痕迹：红笔在 $x=3$ 这一行右侧画了叉，未写错误原因。"
    )


def test_text_only_image_result_does_not_crop_even_if_model_returns_bbox(
    tmp_path: Path, monkeypatch
):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
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
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
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


def test_connection_test_probes_and_reports_multimodal_support(tmp_path: Path, monkeypatch):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    client = TestClient(app)
    captured = {}

    async def fake_test_connection(profile):
        return True, 11, "文本连接成功"

    async def fake_test_multimodal_connection(profile, image_data_url, expected_answer):
        captured["image_data_url"] = image_data_url
        captured["expected_answer"] = expected_answer
        return True, 17, "图片请求成功"

    monkeypatch.setattr(model_profiles, "test_connection", fake_test_connection)
    monkeypatch.setattr(
        model_profiles, "test_multimodal_connection", fake_test_multimodal_connection
    )
    response = client.post(
        "/api/model-profiles/test",
        json={
            "provider": "openai_compatible",
            "base_url": "https://example.com/v1",
            "api_key": "test-secret",
            "model": "vision-model",
            "probe_multimodal": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["multimodal_ok"] is True
    assert payload["multimodal_latency_ms"] == 17
    assert "图片探测通过" in payload["message"]
    assert captured["image_data_url"].startswith("data:image/png;base64,")
    assert len(captured["expected_answer"].split("|")) == 2


def test_multimodal_probe_challenge_matches_generated_image():
    image_data_url, expected_answer = model_profiles.multimodal_probe_challenge()

    assert image_data_url.startswith("data:image/png;base64,")
    tokens = expected_answer.split("|")
    assert len(tokens) == 2
    assert len({token.split("_", 1)[0] for token in tokens}) == 2
    assert len({token.split("_", 1)[1] for token in tokens}) == 2
    assert {token.split("_", 1)[0] for token in tokens} <= {"RED", "BLUE", "YELLOW", "GREEN"}
    assert {token.split("_", 1)[1] for token in tokens} <= {
        "CIRCLE",
        "SQUARE",
        "TRIANGLE",
        "DIAMOND",
    }

    encoded = image_data_url.split(",", 1)[1]
    with Image.open(BytesIO(base64.b64decode(encoded))) as image:
        assert image.size == (480, 240)
        expected_colors = {
            token: ImageColor.getrgb(color)
            for token, color in model_profiles.MULTIMODAL_PROBE_COLORS
        }
        for index, token in enumerate(tokens):
            color_token = token.split("_", 1)[0]
            assert image.getpixel((index * 240 + 120, 120)) == expected_colors[color_token]


def test_required_multimodal_probe_failure_marks_test_failed(tmp_path: Path, monkeypatch):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    client = TestClient(app)

    async def fake_test_connection(profile):
        return True, 11, "文本连接成功"

    async def fake_test_multimodal_connection(profile, image_data_url, expected_answer):
        return False, 9, "模型不接受 image_url"

    monkeypatch.setattr(model_profiles, "test_connection", fake_test_connection)
    monkeypatch.setattr(
        model_profiles, "test_multimodal_connection", fake_test_multimodal_connection
    )
    response = client.post(
        "/api/model-profiles/test",
        json={
            "provider": "openai_compatible",
            "base_url": "https://example.com/v1",
            "api_key": "test-secret",
            "model": "text-model",
            "probe_multimodal": True,
            "require_multimodal": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["multimodal_ok"] is False
    assert "图片探测失败" in payload["message"]


def test_optional_multimodal_probe_failure_keeps_text_model_available(tmp_path: Path, monkeypatch):
    app = create_app()
    app.state.db = Database(tmp_path / "app.db")
    app.state.model_profiles = ModelProfileRepository(
        app.state.db, SecretBox(tmp_path / "secret.key")
    )
    client = TestClient(app)

    async def fake_test_connection(profile):
        return True, 8, "文本连接成功"

    async def fake_test_multimodal_connection(profile, image_data_url, expected_answer):
        return False, 7, "模型不接受 image_url"

    monkeypatch.setattr(model_profiles, "test_connection", fake_test_connection)
    monkeypatch.setattr(
        model_profiles, "test_multimodal_connection", fake_test_multimodal_connection
    )
    response = client.post(
        "/api/model-profiles/test",
        json={
            "provider": "openai_compatible",
            "base_url": "https://example.com/v1",
            "api_key": "test-secret",
            "model": "text-model",
            "probe_multimodal": True,
            "require_multimodal": False,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["multimodal_ok"] is False
    assert "保留为文本模型" in payload["message"]
