from __future__ import annotations

import base64
import json
from io import BytesIO
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import ProblemImageAnalyzeRequest, ProblemImageAnalyzeResponse
from app.core.teaching_controller import extract_json_object
from app.llm.provider import LlmProfile, analyze_problem_image

router = APIRouter(prefix="/api/problem-images", tags=["problem images"])

SUPPORTED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


def profile_from_row(request: Request, row) -> LlmProfile:
    return LlmProfile(
        id=row["id"],
        provider=row["provider"],
        base_url=row["base_url"],
        api_key=request.app.state.model_profiles.decrypt_api_key(row),
        model=row["model"],
        timeout_ms=row["timeout_ms"],
        temperature=row["temperature"],
        max_output_tokens=row["max_output_tokens"],
    )


def clean_base64_image(value: str) -> tuple[str | None, str]:
    if value.startswith("data:"):
        header, _, payload = value.partition(",")
        content_type = header.removeprefix("data:").split(";")[0] or None
        return content_type, payload
    return None, value


def image_data_url(content_type: str, image_bytes: bytes) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def crop_diagram_data_url(image_bytes: bytes, content_type: str, bbox: Any) -> str | None:
    if not bbox:
        return None
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - dependency is declared, fallback keeps feature usable
        return None

    if isinstance(bbox, dict):
        raw_x = bbox.get("x")
        raw_y = bbox.get("y")
        raw_w = bbox.get("width")
        raw_h = bbox.get("height")
    elif isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        raw_x, raw_y, raw_w, raw_h = bbox
    else:
        return None

    try:
        x, y, w, h = (float(raw_x), float(raw_y), float(raw_w), float(raw_h))
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None

    with Image.open(BytesIO(image_bytes)) as image:
        image = image.convert("RGB")
        image_width, image_height = image.size
        if max(abs(x), abs(y), abs(w), abs(h)) <= 1.5:
            left = int(x * image_width)
            top = int(y * image_height)
            right = int((x + w) * image_width)
            bottom = int((y + h) * image_height)
        else:
            left = int(x)
            top = int(y)
            right = int(x + w)
            bottom = int(y + h)

        left = max(0, min(left, image_width - 1))
        top = max(0, min(top, image_height - 1))
        right = max(left + 1, min(right, image_width))
        bottom = max(top + 1, min(bottom, image_height))
        if (right - left) < 8 or (bottom - top) < 8:
            return None

        output = BytesIO()
        image.crop((left, top, right, bottom)).save(output, format="PNG")
    return image_data_url("image/png", output.getvalue())


def normalize_correctness(value: object) -> str:
    if value in {"correct", "incorrect", "unknown", "not_present"}:
        return str(value)
    return "unknown"


def build_student_summary(data: dict[str, Any]) -> str:
    lines: list[str] = []
    summary = str(data.get("student_work_summary") or "").strip()
    answer = str(data.get("answer_text") or "").strip()

    if summary:
        lines.append(summary)
    if answer:
        lines.append(f"学生写出的答案：{answer}")
    return "\n".join(lines)


@router.post("/analyze", response_model=ProblemImageAnalyzeResponse)
async def analyze_image(payload: ProblemImageAnalyzeRequest, request: Request) -> ProblemImageAnalyzeResponse:
    try:
        row = request.app.state.model_profiles.get(payload.model_profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    if not row["is_multimodal"]:
        raise HTTPException(status_code=400, detail="请选择一个已标记为多模态的模型配置")

    embedded_content_type, encoded = clean_base64_image(payload.image_base64.strip())
    content_type = embedded_content_type or payload.content_type
    if content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="只支持 PNG、JPEG 或 WebP 图片")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="图片数据不是有效的 base64") from exc
    if not image_bytes:
        raise HTTPException(status_code=400, detail="图片内容为空")
    if len(image_bytes) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="图片太大，请压缩到 12MB 以内")

    source_data_url = image_data_url(content_type, image_bytes)
    try:
        raw = await analyze_problem_image(profile_from_row(request, row), source_data_url)
        data = extract_json_object(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="图片识别模型返回格式不完整，请重试") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "图片识别失败") from exc

    problem_text = str(data.get("problem_text") or "").strip()
    if not problem_text:
        raise HTTPException(status_code=422, detail="未能从图片中识别出题目文字，请换一张更清晰的图片或手动输入")

    needs_diagram = bool(data.get("needs_diagram"))
    diagram_image = (
        crop_diagram_data_url(image_bytes, content_type, data.get("diagram_bbox"))
        if needs_diagram
        else None
    )
    diagram_note = None
    if needs_diagram and not diagram_image:
        diagram_image = source_data_url
        diagram_note = "未能可靠裁剪题图，暂时显示原图。"

    correctness = normalize_correctness(data.get("correctness"))
    return ProblemImageAnalyzeResponse(
        problem_text=problem_text,
        student_work_summary=build_student_summary(data),
        answer_text=str(data.get("answer_text") or "").strip(),
        correctness=correctness,  # type: ignore[arg-type]
        mistake_summary=str(data.get("mistake_summary") or "").strip(),
        needs_diagram=needs_diagram,
        diagram_image_data_url=diagram_image,
        diagram_note=diagram_note,
    )
