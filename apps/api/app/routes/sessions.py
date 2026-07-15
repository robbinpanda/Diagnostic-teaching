from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.schemas import (
    SessionCreate,
    SessionCreateResponse,
    SessionHistoryListResponse,
    SessionRestoreRequest,
    SessionRestoreResponse,
    SessionRestoredMessage,
)
from app.routes.cards import card_from_row

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
    logger = getattr(request.app.state, "session_logger", None)
    if logger is not None:
        logger.log_session_started(
            session_id=session["id"],
            model=profile["model"],
            grade_band=session["grade_band"],
            problem_text=session["problem_text"],
            student_initial_thought=session["student_initial_thought"],
        )
    return SessionCreateResponse(
        session_id=session["id"],
        state_hint=session["phase"],
        model_profile_id=session["model_profile_id"],
    )


@router.get("/history", response_model=SessionHistoryListResponse)
def list_session_history(request: Request) -> SessionHistoryListResponse:
    rows = request.app.state.sessions.list_history()
    return SessionHistoryListResponse(
        sessions=[
            {
                "session_id": row["id"],
                "restored_from": row["restored_from"],
                "title": row["problem_text"].strip().replace("\n", " ")[:72],
                "grade_band": row["grade_band"],
                "model_profile_id": row["model_profile_id"],
                "model_display_name": row["model_display_name"],
                "message_count": row["message_count"],
                "checkpoint_count": row["checkpoint_count"],
                "state_hint": row["phase"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    )


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: str, request: Request) -> Response:
    try:
        request.app.state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SQLite 中不存在该历史会话") from exc

    logger = getattr(request.app.state, "session_logger", None)
    if logger is not None:
        logger.delete(session_id)
    request.app.state.sessions.delete(session_id)
    return Response(status_code=204)


@router.post("/restore", response_model=SessionRestoreResponse)
def restore_session(payload: SessionRestoreRequest, request: Request) -> SessionRestoreResponse:
    try:
        profile = request.app.state.model_profiles.get(payload.model_profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="请选择一个可用模型来恢复会话") from exc
    try:
        source = request.app.state.sessions.get(payload.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SQLite 中不存在该历史会话") from exc
    if source["problem_image_data_url"] and not profile["is_multimodal"]:
        raise HTTPException(status_code=400, detail="该历史题目包含原图，必须选择支持图片识别的模型")

    session = request.app.state.sessions.restore(payload.session_id, payload.model_profile_id)
    messages = request.app.state.sessions.list_messages(session["id"])
    checkpoints = request.app.state.sessions.list_checkpoints(session["id"])
    pending = next((row for row in reversed(checkpoints) if row["selected_option_id"] is None), None)
    pending_payload = None
    if pending:
        pending_payload = json.loads(pending["options_json"])
        pending_payload["id"] = pending["id"]
        for option in pending_payload.get("options", []):
            option.pop("is_correct", None)
            option.pop("misconception", None)
    pending_card_row = request.app.state.sessions.latest_pending_card(session["id"])
    pending_card_payload = (
        card_from_row(pending_card_row).model_dump(mode="json")
        if pending_card_row is not None
        else None
    )

    logger = getattr(request.app.state, "session_logger", None)
    if logger is not None:
        logger.log_session_started(
            session_id=session["id"],
            model=profile["model"],
            grade_band=session["grade_band"],
            problem_text=session["problem_text"],
            student_initial_thought=session["student_initial_thought"],
            restored_from=payload.session_id,
        )
        for row in messages:
            logger.log_message(
                session_id=session["id"],
                message_id=row["id"],
                role=row["role"],
                action_id=row["action_id"],
                action=row["action"],
                in_reply_to_action_id=row["in_reply_to_action_id"],
                content=row["content"],
            )

    return SessionRestoreResponse(
        session_id=session["id"],
        restored_from=payload.session_id,
        state_hint=session["phase"],
        breakpoint_description=session["breakpoint_description"],
        model_profile_id=session["model_profile_id"],
        grade_band=session["grade_band"],
        problem_text=session["problem_text"],
        student_initial_thought=session["student_initial_thought"],
        problem_image_data_url=session["problem_image_data_url"],
        messages=[
            SessionRestoredMessage(
                id=row["id"],
                role=row["role"],
                text=row["content"],
                action_id=row["action_id"],
                action=row["action"],
            )
            for row in messages
            if row["role"] in {"student", "assistant"}
        ],
        pending_checkpoint=pending_payload,
        pending_card=pending_card_payload,
    )
