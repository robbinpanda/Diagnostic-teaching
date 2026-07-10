from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import SessionCreate, SessionCreateResponse

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionCreateResponse)
def create_session(payload: SessionCreate, request: Request) -> SessionCreateResponse:
    try:
        profile = request.app.state.model_profiles.get(payload.model_profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="请选择一个可用模型") from exc
    if payload.problem_image_data_url:
        if not payload.problem_image_data_url.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="题目原图格式无效")
        if not profile["is_multimodal"]:
            raise HTTPException(status_code=400, detail="包含题图的题目必须选择支持图片识别的多模态答疑模型")
    session = request.app.state.sessions.create(payload)
    return SessionCreateResponse(
        session_id=session["id"],
        state_hint=session["phase"],
        model_profile_id=session["model_profile_id"],
    )
