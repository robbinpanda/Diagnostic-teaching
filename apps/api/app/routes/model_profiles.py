from __future__ import annotations

import base64
import json
import random
import time
from io import BytesIO

from fastapi import APIRouter, HTTPException, Request, Response
from PIL import Image, ImageDraw

from app.core.schemas import (
    ModelProfileBatchCreate,
    ModelProfileBatchCreateResponse,
    ModelProfileCreate,
    ModelProfileCreateResponse,
    ModelProfileListResponse,
    ModelProfilePublic,
    ModelProfileTestRequest,
    ModelProfileTestResponse,
    ModelProfileUpdate,
)
from app.llm.provider import LlmProfile, test_connection, test_multimodal_connection
from app.storage.repositories import host_from_url

router = APIRouter(prefix="/api/model-profiles", tags=["model profiles"])
MULTIMODAL_PROBE_COLORS = (
    ("RED", "#ef4444"),
    ("BLUE", "#2563eb"),
    ("YELLOW", "#facc15"),
    ("GREEN", "#16a34a"),
)
MULTIMODAL_PROBE_SHAPES = ("CIRCLE", "SQUARE", "TRIANGLE", "DIAMOND")
MULTIMODAL_PROBE_ITEM_COUNT = 2


def multimodal_probe_challenge() -> tuple[str, str]:
    """Build an unpredictable visual challenge so a text-only model cannot guess it."""
    colors = list(MULTIMODAL_PROBE_COLORS)
    shapes = list(MULTIMODAL_PROBE_SHAPES)
    secure_random = random.SystemRandom()
    secure_random.shuffle(colors)
    secure_random.shuffle(shapes)
    colors = colors[:MULTIMODAL_PROBE_ITEM_COUNT]
    shapes = shapes[:MULTIMODAL_PROBE_ITEM_COUNT]

    width, height = 480, 240
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    cell_width = width // len(shapes)
    expected_tokens: list[str] = []
    for index, ((color_token, color_value), shape) in enumerate(zip(colors, shapes, strict=True)):
        left = index * cell_width + 45
        right = (index + 1) * cell_width - 45
        top = 45
        bottom = height - 45
        center_x = (left + right) // 2
        center_y = (top + bottom) // 2
        half_size = min(right - left, bottom - top) // 2
        if shape == "CIRCLE":
            draw.ellipse(
                (
                    center_x - half_size,
                    center_y - half_size,
                    center_x + half_size,
                    center_y + half_size,
                ),
                fill=color_value,
            )
        elif shape == "SQUARE":
            draw.rectangle(
                (
                    center_x - half_size,
                    center_y - half_size,
                    center_x + half_size,
                    center_y + half_size,
                ),
                fill=color_value,
            )
        elif shape == "TRIANGLE":
            draw.polygon(
                (
                    (center_x, center_y - half_size),
                    (center_x - half_size, center_y + half_size),
                    (center_x + half_size, center_y + half_size),
                ),
                fill=color_value,
            )
        else:
            draw.polygon(
                (
                    (center_x, center_y - half_size),
                    (center_x - half_size, center_y),
                    (center_x, center_y + half_size),
                    (center_x + half_size, center_y),
                ),
                fill=color_value,
            )
        expected_tokens.append(f"{color_token}_{shape}")

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}", "|".join(expected_tokens)


def to_public(row) -> ModelProfilePublic:
    status = "available" if row["enabled"] else "disabled"
    tags = json.loads(row["tags_json"])
    return ModelProfilePublic(
        id=row["id"],
        display_name=row["display_name"],
        provider=row["provider"],
        base_url=row["base_url"],
        base_url_host=host_from_url(row["base_url"]),
        model=row["model"],
        tags=tags,
        status=status,
        key_state="saved",
        masked_api_key=row["api_key_mask"],
        timeout_ms=row["timeout_ms"],
        temperature=row["temperature"],
        max_output_tokens=row["max_output_tokens"],
        is_multimodal=bool(row["is_multimodal"]),
        managed=is_managed_tags(tags),
        last_test_status=row["last_test_status"],
        last_test_latency_ms=row["last_test_latency_ms"],
    )


@router.get("", response_model=ModelProfileListResponse)
def list_profiles(request: Request) -> ModelProfileListResponse:
    rows = request.app.state.model_profiles.list_public()
    return ModelProfileListResponse(profiles=[to_public(row) for row in rows])


@router.post("", response_model=ModelProfileCreateResponse)
def create_profile(payload: ModelProfileCreate, request: Request) -> ModelProfileCreateResponse:
    row = request.app.state.model_profiles.create(payload)
    return ModelProfileCreateResponse(
        id=row["id"],
        display_name=row["display_name"],
        provider=row["provider"],
        status="available",
        masked_api_key=row["api_key_mask"],
    )


@router.post("/batch", response_model=ModelProfileBatchCreateResponse)
def create_profiles_batch(
    payload: ModelProfileBatchCreate,
    request: Request,
) -> ModelProfileBatchCreateResponse:
    normalized_models = [item.model.strip() for item in payload.models]
    if len(set(normalized_models)) != len(normalized_models):
        raise HTTPException(status_code=400, detail="同一供应商配置中不能重复填写 model name")
    profiles = [
        ModelProfileCreate(
            display_name=payload.display_name,
            provider=payload.provider,
            base_url=payload.base_url,
            api_key=payload.api_key,
            model=item.model,
            tags=payload.tags,
            timeout_ms=payload.timeout_ms,
            temperature=payload.temperature,
            max_output_tokens=payload.max_output_tokens,
            is_multimodal=item.is_multimodal,
        )
        for item in payload.models
    ]
    rows = request.app.state.model_profiles.create_many(profiles)
    return ModelProfileBatchCreateResponse(profiles=[to_public(row) for row in rows])


@router.patch("/{profile_id}", response_model=ModelProfilePublic)
def update_profile(
    profile_id: str, payload: ModelProfileUpdate, request: Request
) -> ModelProfilePublic:
    try:
        row = request.app.state.model_profiles.update(profile_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=409, detail="OpenCode 免费模型由目录自动同步，不能手动修改"
        ) from exc
    return to_public(row)


@router.delete("/{profile_id}", status_code=204)
def delete_profile(profile_id: str, request: Request) -> Response:
    try:
        request.app.state.model_profiles.soft_delete(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=409, detail="OpenCode 免费模型由目录自动同步，不能手动删除"
        ) from exc
    return Response(status_code=204)


@router.post("/test", response_model=ModelProfileTestResponse)
async def test_profile(
    payload: ModelProfileTestRequest, request: Request
) -> ModelProfileTestResponse:
    started = time.perf_counter()
    api_key = payload.api_key
    profile_id = "unsaved"
    if not api_key:
        if not payload.profile_id:
            raise HTTPException(status_code=400, detail="请填写 API key")
        try:
            saved_profile = request.app.state.model_profiles.get(payload.profile_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="模型配置不存在") from exc
        api_key = request.app.state.model_profiles.decrypt_api_key(saved_profile)
        profile_id = saved_profile["id"]
    profile = LlmProfile(
        id=profile_id,
        provider=payload.provider,
        base_url=str(payload.base_url).rstrip("/"),
        api_key=api_key,
        model=payload.model,
        timeout_ms=payload.timeout_ms,
        temperature=0,
        max_output_tokens=payload.max_output_tokens,
    )
    ok, latency, message = await test_connection(profile)
    if latency is None:
        latency = int((time.perf_counter() - started) * 1000)
    multimodal_ok: bool | None = None
    multimodal_latency: int | None = None
    multimodal_message: str | None = None
    if ok and payload.probe_multimodal:
        probe_image_data_url, expected_answer = multimodal_probe_challenge()
        multimodal_ok, multimodal_latency, multimodal_message = await test_multimodal_connection(
            profile,
            probe_image_data_url,
            expected_answer,
        )
        if multimodal_ok:
            message = f"{message}；图片探测通过"
        elif payload.require_multimodal:
            ok = False
            message = f"文本连接成功，但图片探测失败：{multimodal_message}"
        else:
            message = f"{message}；图片探测未通过，保留为文本模型"
    if payload.profile_id:
        request.app.state.model_profiles.update_test_status(
            payload.profile_id,
            "ok" if ok else "error",
            latency,
        )
    return ModelProfileTestResponse(
        ok=ok,
        latency_ms=latency,
        message=message,
        multimodal_ok=multimodal_ok,
        multimodal_latency_ms=multimodal_latency,
        multimodal_message=multimodal_message,
    )


def get_profile_or_404(request: Request, profile_id: str):
    try:
        return request.app.state.model_profiles.get(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc


def is_managed_tags(tags: list[str]) -> bool:
    return "opencodefree" in tags
