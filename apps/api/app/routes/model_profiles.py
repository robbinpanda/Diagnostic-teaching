from __future__ import annotations

import json
import time

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.schemas import (
    ModelProfileCreate,
    ModelProfileCreateResponse,
    ModelProfileListResponse,
    ModelProfilePublic,
    ModelProfileTestRequest,
    ModelProfileTestResponse,
    ModelProfileUpdate,
)
from app.llm.provider import LlmProfile, test_connection
from app.storage.repositories import host_from_url

router = APIRouter(prefix="/api/model-profiles", tags=["model profiles"])


def to_public(row) -> ModelProfilePublic:
    status = "available" if row["enabled"] else "disabled"
    return ModelProfilePublic(
        id=row["id"],
        display_name=row["display_name"],
        provider=row["provider"],
        base_url=row["base_url"],
        base_url_host=host_from_url(row["base_url"]),
        model=row["model"],
        tags=json.loads(row["tags_json"]),
        status=status,
        key_state="saved",
        masked_api_key=row["api_key_mask"],
        timeout_ms=row["timeout_ms"],
        temperature=row["temperature"],
        max_output_tokens=row["max_output_tokens"],
        is_multimodal=bool(row["is_multimodal"]),
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


@router.patch("/{profile_id}", response_model=ModelProfilePublic)
def update_profile(profile_id: str, payload: ModelProfileUpdate, request: Request) -> ModelProfilePublic:
    try:
        row = request.app.state.model_profiles.update(profile_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    return to_public(row)


@router.delete("/{profile_id}", status_code=204)
def delete_profile(profile_id: str, request: Request) -> Response:
    try:
        request.app.state.model_profiles.soft_delete(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
    return Response(status_code=204)


@router.post("/test", response_model=ModelProfileTestResponse)
async def test_profile(payload: ModelProfileTestRequest, request: Request) -> ModelProfileTestResponse:
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
    ok, latency, message = await test_connection(
        LlmProfile(
            id=profile_id,
            provider=payload.provider,
            base_url=str(payload.base_url).rstrip("/"),
            api_key=api_key,
            model=payload.model,
            timeout_ms=payload.timeout_ms,
            temperature=0,
            max_output_tokens=payload.max_output_tokens,
        )
    )
    if latency is None:
        latency = int((time.perf_counter() - started) * 1000)
    return ModelProfileTestResponse(ok=ok, latency_ms=latency, message=message)


def get_profile_or_404(request: Request, profile_id: str):
    try:
        return request.app.state.model_profiles.get(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc
