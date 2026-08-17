from __future__ import annotations

import asyncio
import base64
import json
import random
import time
from dataclasses import replace
from io import BytesIO

from fastapi import APIRouter, HTTPException, Request, Response
from PIL import Image, ImageDraw

from app.core.schemas import (
    ModelProfileBatchCreate,
    ModelProfileBatchCreateResponse,
    ModelProfileBatchDelete,
    ModelProfileBatchDeleteResponse,
    ModelProfileCreate,
    ModelProfileCreateResponse,
    ModelProfileListResponse,
    ModelProfilePublic,
    ModelProfileReasoningProbeResult,
    ModelProfileReasoningUpdate,
    ModelProfileTestRequest,
    ModelProfileTestResponse,
    ModelProfileUpdate,
)
from app.llm.provider import LlmProfile, test_connection, test_multimodal_connection
from app.llm.reasoning import (
    DEFAULT_REASONING_EFFORT,
    REASONING_EFFORTS,
    normalize_reasoning_effort_options,
    preferred_reasoning_effort,
    reasoning_capability,
)
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
    capability = reasoning_capability(row["provider"], row["base_url"], row["model"])
    reasoning_options = _stored_reasoning_options(
        row["reasoning_effort_options_json"]
    )
    selected_effort = preferred_reasoning_effort(
        row["reasoning_effort"],
        reasoning_options,
    )
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
        reasoning_effort=selected_effort,
        reasoning_effort_options=list(reasoning_options),
        reasoning_control=capability.control,
        reasoning_control_description=capability.description,
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
            reasoning_effort=payload.reasoning_effort,
            reasoning_effort_options=item.reasoning_effort_options,
        )
        for item in payload.models
    ]
    rows = request.app.state.model_profiles.create_many(profiles)
    return ModelProfileBatchCreateResponse(profiles=[to_public(row) for row in rows])


@router.post("/batch-delete", response_model=ModelProfileBatchDeleteResponse)
def delete_profiles_batch(
    payload: ModelProfileBatchDelete,
    request: Request,
) -> ModelProfileBatchDeleteResponse:
    if len(set(payload.profile_ids)) != len(payload.profile_ids):
        raise HTTPException(status_code=400, detail="批量删除列表中不能包含重复的模型配置")
    try:
        deleted_ids = request.app.state.model_profiles.soft_delete_many(payload.profile_ids)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    return ModelProfileBatchDeleteResponse(deleted_profile_ids=deleted_ids)


@router.patch("/{profile_id}", response_model=ModelProfilePublic)
def update_profile(
    profile_id: str, payload: ModelProfileUpdate, request: Request
) -> ModelProfilePublic:
    try:
        row = request.app.state.model_profiles.update(profile_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    return to_public(row)


@router.patch("/{profile_id}/reasoning", response_model=ModelProfilePublic)
def update_profile_reasoning(
    profile_id: str,
    payload: ModelProfileReasoningUpdate,
    request: Request,
) -> ModelProfilePublic:
    try:
        row = request.app.state.model_profiles.get(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    reasoning_options = _stored_reasoning_options(
        row["reasoning_effort_options_json"]
    )
    if payload.reasoning_effort not in reasoning_options:
        raise HTTPException(
            status_code=422,
            detail=f"该模型仅支持这些推理档位：{', '.join(reasoning_options)}",
        )
    updated = request.app.state.model_profiles.update_reasoning_effort(
        profile_id,
        payload.reasoning_effort,
    )
    return to_public(updated)


@router.delete("/{profile_id}", status_code=204)
def delete_profile(profile_id: str, request: Request) -> Response:
    try:
        request.app.state.model_profiles.soft_delete(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
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
        temperature=payload.temperature,
        max_output_tokens=payload.max_output_tokens,
        reasoning_effort=DEFAULT_REASONING_EFFORT,
    )
    reasoning_results = await _probe_reasoning_efforts(profile)
    reasoning_options = [
        result.effort for result in reasoning_results if result.ok
    ]
    ok = bool(reasoning_options)
    latency_values = [
        result.latency_ms
        for result in reasoning_results
        if result.latency_ms is not None
    ]
    latency = max(latency_values) if latency_values else None
    if latency is None:
        latency = int((time.perf_counter() - started) * 1000)
    if ok:
        unsupported = [
            result.effort for result in reasoning_results if not result.ok
        ]
        message = f"文本连接成功；可用推理档位：{', '.join(reasoning_options)}"
        if unsupported:
            message += f"；已移除报错档位：{', '.join(unsupported)}"
    else:
        message = "none / low / high 三个推理档位均未通过"
        first_error = next(
            (result.message for result in reasoning_results if result.message),
            "",
        )
        if first_error:
            message += f"：{first_error}"
    multimodal_ok: bool | None = None
    multimodal_latency: int | None = None
    multimodal_message: str | None = None
    if ok and payload.probe_multimodal:
        profile = replace(
            profile,
            reasoning_effort=preferred_reasoning_effort(
                DEFAULT_REASONING_EFFORT,
                tuple(reasoning_options),
            ),
        )
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
        reasoning_effort_options=reasoning_options,
        reasoning_effort_results=reasoning_results,
        multimodal_ok=multimodal_ok,
        multimodal_latency_ms=multimodal_latency,
        multimodal_message=multimodal_message,
    )


def get_profile_or_404(request: Request, profile_id: str):
    try:
        return request.app.state.model_profiles.get(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc


async def _probe_reasoning_efforts(
    profile: LlmProfile,
) -> list[ModelProfileReasoningProbeResult]:
    async def probe(
        effort: str,
    ) -> ModelProfileReasoningProbeResult:
        ok, latency, message = await test_connection(
            replace(profile, reasoning_effort=effort)
        )
        return ModelProfileReasoningProbeResult(
            effort=effort,
            ok=ok,
            latency_ms=latency,
            message=message,
        )

    return list(await asyncio.gather(*(probe(effort) for effort in REASONING_EFFORTS)))


def _stored_reasoning_options(raw: object) -> tuple:
    try:
        decoded = json.loads(str(raw))
    except (TypeError, json.JSONDecodeError):
        decoded = None
    return normalize_reasoning_effort_options(
        decoded if isinstance(decoded, list) else None
    )
