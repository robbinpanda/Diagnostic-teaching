import base64
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.core.schemas import ModelProfileCreate
from app.llm.provider import IMAGE_PROBLEM_DETECTION_PROMPT
from app.main import create_app
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
            display_name="Vision Demo",
            provider="local_demo",
            base_url="https://local.demo/v1",
            api_key="demo-key",
            model="local-demo",
            is_multimodal=True,
        )
    )
    return TestClient(app), profile["id"]


def _image_data_url(width: int = 100, height: int = 100) -> str:
    buffer = BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _start_payload(profile_id: str, session_id: str, message_id: str, problem: str):
    return {
        "session_id": session_id,
        "client_message_id": message_id,
        "grade_band": "junior",
        "subject": "math",
        "model_profile_id": profile_id,
        "message": problem,
        "problem_text": problem,
        "student_initial_thought": "",
        "problem_image_data_url": None,
    }


def test_selected_model_splits_numbered_text_into_independent_problems(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    response = client.post(
        "/api/problem-intake/analyze-text",
        json={
            "model_profile_id": profile_id,
            "text": "1. 解方程 $x+1=2$。\n2. 求函数 $y=x^2$ 的最小值。",
        },
    )

    assert response.status_code == 200
    problems = response.json()["problems"]
    assert len(problems) == 2
    assert "解方程" in problems[0]["problem_text"]
    assert "最小值" in problems[1]["problem_text"]


def test_image_detection_prompt_requires_complete_student_work_inside_each_box():
    assert "学生过程是框选内容的必要组成部分，不是可选内容" in IMAGE_PROBLEM_DETECTION_PROMPT
    assert "草稿、每一步计算、推导、改写、划掉后重写、最终答案" in IMAGE_PROBLEM_DETECTION_PROMPT
    assert "题干下方、右侧、空白处" in IMAGE_PROBLEM_DETECTION_PROMPT
    assert "禁止在该题存在可见作答时仅框题干" in IMAGE_PROBLEM_DETECTION_PROMPT
    assert "允许为此与相邻框轻微重叠" in IMAGE_PROBLEM_DETECTION_PROMPT


def test_image_detection_returns_editable_normalized_region(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)

    response = client.post(
        "/api/problem-images/detect",
        json={
            "model_profile_id": profile_id,
            "image_base64": _image_data_url(120, 80),
            "content_type": "image/png",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["image_width"] == 120
    assert payload["image_height"] == 80
    assert payload["problems"] == [
        {
            "id": "problem-1",
            "label": "题目 1",
            "bbox": {"x": 0.03, "y": 0.03, "width": 0.94, "height": 0.94},
        }
    ]


def test_confirmed_image_regions_are_cropped_into_equal_number_of_sessions(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    response = client.post(
        "/api/sessions/image-batch-start",
        json={
            "grade_band": "senior",
            "subject": "math",
            "model_profile_id": profile_id,
            "source_image_data_url": _image_data_url(),
            "items": [
                {
                    "session_id": "sess_11111111111111111111111111111111",
                    "client_message_id": "image-1",
                    "bbox": {"x": 0, "y": 0, "width": 0.5, "height": 0.4},
                },
                {
                    "session_id": "sess_22222222222222222222222222222222",
                    "client_message_id": "image-2",
                    "bbox": {"x": 0.5, "y": 0.5, "width": 0.5, "height": 0.5},
                },
            ],
        },
    )

    assert response.status_code == 200
    assert len(response.json()["sessions"]) == 2
    assert len(client.get("/api/sessions/history").json()["sessions"]) == 2
    crop_sizes = []
    for session_id in (
        "sess_11111111111111111111111111111111",
        "sess_22222222222222222222222222222222",
    ):
        image_url = client.app.state.sessions.get(session_id)["problem_image_data_url"]
        encoded = image_url.partition(",")[2]
        with Image.open(BytesIO(base64.b64decode(encoded))) as image:
            crop_sizes.append(image.size)
    assert crop_sizes == [(50, 40), (50, 50)]


def test_text_batch_start_is_grouped_and_idempotent(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    request = {
        "sessions": [
            _start_payload(
                profile_id,
                "sess_33333333333333333333333333333333",
                "text-1",
                "求 $x+1=2$ 的解。",
            ),
            _start_payload(
                profile_id,
                "sess_44444444444444444444444444444444",
                "text-2",
                "求 $y=x^2$ 的最小值。",
            ),
        ]
    }

    first = client.post("/api/sessions/batch-start", json=request)
    second = client.post("/api/sessions/batch-start", json=request)

    assert first.status_code == 200
    assert [item["status"] for item in first.json()["sessions"]] == ["accepted", "accepted"]
    assert [item["status"] for item in second.json()["sessions"]] == ["duplicate", "duplicate"]
    assert len(client.get("/api/sessions/history").json()["sessions"]) == 2


def test_batch_start_rolls_back_new_sessions_when_a_later_item_conflicts(tmp_path: Path):
    client, profile_id = _client_and_profile(tmp_path)
    existing_id = "sess_55555555555555555555555555555555"
    existing = _start_payload(profile_id, existing_id, "existing", "原题。")
    assert client.post("/api/sessions/start", json=existing).status_code == 200

    response = client.post(
        "/api/sessions/batch-start",
        json={
            "sessions": [
                _start_payload(
                    profile_id,
                    "sess_66666666666666666666666666666666",
                    "new-first",
                    "本应回滚的新题。",
                ),
                _start_payload(profile_id, existing_id, "different-key", "冲突题。"),
            ]
        },
    )

    assert response.status_code == 409
    history_ids = {
        item["session_id"] for item in client.get("/api/sessions/history").json()["sessions"]
    }
    assert history_ids == {existing_id}
