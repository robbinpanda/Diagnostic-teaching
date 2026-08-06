from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.schemas import (
    ImageSessionBatchStartRequest,
    SessionBatchStartRequest,
    SessionBatchStartResponse,
    SessionCreate,
    SessionCreateResponse,
    SessionHistoryListResponse,
    SessionInterruptResponse,
    SessionRestoredMessage,
    SessionRestoreRequest,
    SessionRestoreResponse,
    SessionRunPublic,
    SessionRunStatusResponse,
    SessionStartRequest,
    SessionStartResponse,
)
from app.routes.cards import card_from_row
from app.routes.problem_images import crop_diagram_data_url, decode_problem_image
from app.services.input_acceptance import (
    IdempotencyConflictError,
    InputAcceptanceService,
    InputStateConflictError,
    InputValidationError,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def checkpoint_public_payload(row) -> dict:
    payload = json.loads(row["options_json"])
    payload["id"] = row["id"]
    for option in payload.get("options", []):
        option.pop("is_correct", None)
        option.pop("misconception", None)
    return payload


def messages_have_images(message_rows) -> bool:
    for row in message_rows:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        image_data_url = metadata.get("image_data_url")
        if isinstance(image_data_url, str) and image_data_url.startswith("data:image/"):
            return True
    return False


def restored_messages(message_rows, checkpoint_rows) -> list[SessionRestoredMessage]:
    checkpoints = {row["id"]: row for row in checkpoint_rows}
    restored: list[SessionRestoredMessage] = []
    for row in message_rows:
        if row["role"] not in {"student", "assistant"}:
            continue
        checkpoint_result = None
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except json.JSONDecodeError:
            metadata = {}
        if row["action"] == "CHECKPOINT_RESPONSE":
            result = metadata.get("checkpoint_result") or metadata.get("checkpoint_answer")
            checkpoint = checkpoints.get(result.get("checkpoint_id")) if isinstance(result, dict) else None
            if checkpoint is not None and checkpoint["selected_option_id"] is not None:
                checkpoint_result = {
                    "checkpoint": checkpoint_public_payload(checkpoint),
                    "selected_option_id": checkpoint["selected_option_id"],
                    "is_correct": bool(checkpoint["is_correct"]),
                }
        restored.append(
            SessionRestoredMessage(
                id=row["id"],
                role=row["role"],
                text=row["content"],
                action_id=row["action_id"],
                action=row["action"],
                client_message_id=row["client_message_id"],
                image_data_url=metadata.get("image_data_url"),
                checkpoint_result=checkpoint_result,
            )
        )
    return restored


def run_from_row(row) -> SessionRunPublic:
    return SessionRunPublic(
        run_id=row["id"],
        client_run_id=row["client_run_id"],
        session_id=row["session_id"],
        attempt=row["attempt"],
        status=row["status"],
        queued_at=row["queued_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        updated_at=row["updated_at"],
        last_committed_action_index=row["last_committed_action_index"],
        error=json.loads(row["error_json"]) if row["error_json"] else None,
    )


def validate_session_profile(payload: SessionCreate, request: Request):
    if payload.paper_id:
        try:
            request.app.state.sessions.get_exam_paper(payload.paper_id)
        except KeyError as exc:
            raise HTTPException(status_code=400, detail="所选试卷不存在") from exc
    try:
        profile = request.app.state.model_profiles.get(payload.model_profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="请选择一个可用模型") from exc
    if payload.problem_image_data_url:
        if not payload.problem_image_data_url.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="题目原图格式无效")
        if not profile["is_multimodal"]:
            raise HTTPException(status_code=400, detail="包含题图的题目必须选择支持图片识别的多模态答疑模型")
    return profile


def persist_session(payload: SessionCreate, request: Request):
    profile = validate_session_profile(payload, request)
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
    return session


def session_start_response(started) -> SessionStartResponse:
    session = started.session_row
    message = started.message_row
    return SessionStartResponse(
        status="accepted" if started.accepted else "duplicate",
        session_id=session["id"],
        state_hint=session["phase"],
        context_status=session["context_status"],
        model_profile_id=session["model_profile_id"],
        problem_text=session["problem_text"],
        student_initial_thought=session["student_initial_thought"],
        message_id=message["id"],
        action_id=message["action_id"],
    )


def accept_session_starts(
    payloads: list[SessionStartRequest],
    request: Request,
) -> list[SessionStartResponse]:
    profiles = [validate_session_profile(payload, request) for payload in payloads]
    try:
        started_sessions = InputAcceptanceService(request.app.state.sessions).start_sessions(payloads)
    except IdempotencyConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SESSION_START_IDEMPOTENCY_CONFLICT",
                "message": "同一个会话启动标识已被用于不同内容。",
            },
        ) from exc
    except (InputValidationError, InputStateConflictError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger = getattr(request.app.state, "session_logger", None)
    for started, profile in zip(started_sessions, profiles, strict=True):
        if logger is None or not started.accepted:
            continue
        session = started.session_row
        message = started.message_row
        logger.log_session_started(
            session_id=session["id"],
            model=profile["model"],
            grade_band=session["grade_band"],
            problem_text=session["problem_text"],
            student_initial_thought=session["student_initial_thought"],
        )
        logger.log_message(
            session_id=session["id"],
            message_id=message["id"],
            role="student",
            action_id=message["action_id"],
            action=message["action"],
            in_reply_to_action_id=message["in_reply_to_action_id"],
            content=message["content"],
        )
    return [session_start_response(started) for started in started_sessions]


@router.post("", response_model=SessionCreateResponse)
def create_session(payload: SessionCreate, request: Request) -> SessionCreateResponse:
    session = persist_session(payload, request)
    return SessionCreateResponse(
        session_id=session["id"],
        state_hint=session["phase"],
        context_status=session["context_status"],
        model_profile_id=session["model_profile_id"],
    )


@router.post("/start", response_model=SessionStartResponse)
def start_session(payload: SessionStartRequest, request: Request) -> SessionStartResponse:
    return accept_session_starts([payload], request)[0]


@router.post("/batch-start", response_model=SessionBatchStartResponse)
def batch_start_sessions(
    payload: SessionBatchStartRequest,
    request: Request,
) -> SessionBatchStartResponse:
    return SessionBatchStartResponse(sessions=accept_session_starts(payload.sessions, request))


@router.post("/image-batch-start", response_model=SessionBatchStartResponse)
def batch_start_image_sessions(
    payload: ImageSessionBatchStartRequest,
    request: Request,
) -> SessionBatchStartResponse:
    try:
        profile = request.app.state.model_profiles.get(payload.model_profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="请选择一个可用模型") from exc
    if not profile["is_multimodal"]:
        raise HTTPException(status_code=400, detail="图片拆题必须使用多模态答疑模型")

    content_type, image_bytes, _ = decode_problem_image(payload.source_image_data_url)
    starts: list[SessionStartRequest] = []
    for index, item in enumerate(payload.items, start=1):
        cropped = crop_diagram_data_url(
            image_bytes,
            content_type,
            item.bbox.model_dump(mode="json"),
        )
        if cropped is None:
            raise HTTPException(status_code=400, detail=f"第 {index} 个题目框太小或超出图片范围")
        starts.append(
            SessionStartRequest(
                session_id=item.session_id,
                client_message_id=item.client_message_id,
                grade_band=payload.grade_band,
                subject=payload.subject,
                model_profile_id=payload.model_profile_id,
                paper_id=payload.paper_id,
                message=f"上传了一张框选题目图片（第 {index} 题）",
                problem_text="",
                student_initial_thought="",
                problem_image_data_url=cropped,
            )
        )
    return SessionBatchStartResponse(sessions=accept_session_starts(starts, request))


@router.get("/history", response_model=SessionHistoryListResponse)
def list_session_history(request: Request) -> SessionHistoryListResponse:
    rows = request.app.state.sessions.list_history()
    return SessionHistoryListResponse(
        sessions=[
            {
                "session_id": row["id"],
                "restored_from": row["restored_from"],
                "paper_id": row["paper_id"],
                "paper_name": row["paper_name"],
                # Keep complete math delimiters; the frontend applies visual ellipsis.
                "title": (
                    row["problem_text"].strip()
                    or (row["first_student_message"] or "").strip()
                    or "新答疑"
                ).replace("\n", " "),
                "grade_band": row["grade_band"],
                "model_profile_id": row["model_profile_id"],
                "model_display_name": row["model_display_name"],
                "message_count": row["message_count"],
                "checkpoint_count": row["checkpoint_count"],
                "state_hint": row["phase"],
                "context_status": row["context_status"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    )


def session_detail_response(request: Request, session) -> SessionRestoreResponse:
    messages = request.app.state.sessions.list_messages(session["id"])
    checkpoints = request.app.state.sessions.list_checkpoints(session["id"])
    pending = next((row for row in reversed(checkpoints) if row["answered_at"] is None), None)
    pending_payload = checkpoint_public_payload(pending) if pending else None
    pending_card_rows = request.app.state.sessions.list_pending_cards(session["id"])
    pending_card_row = pending_card_rows[-1] if pending_card_rows else None
    pending_card_payload = (
        card_from_row(pending_card_row).model_dump(mode="json")
        if pending_card_row is not None
        else None
    )
    return SessionRestoreResponse(
        session_id=session["id"],
        restored_from=session["restored_from"],
        paper_id=session["paper_id"],
        paper_name=(
            request.app.state.sessions.get_exam_paper(session["paper_id"])["name"]
            if session["paper_id"]
            else None
        ),
        state_hint=session["phase"],
        context_status=session["context_status"],
        breakpoint_description=session["breakpoint_description"],
        model_profile_id=session["model_profile_id"],
        grade_band=session["grade_band"],
        problem_text=session["problem_text"],
        student_initial_thought=session["student_initial_thought"],
        problem_image_data_url=session["problem_image_data_url"],
        messages=restored_messages(messages, checkpoints),
        pending_checkpoint=pending_payload,
        pending_card=pending_card_payload,
        pending_cards=[card_from_row(row).model_dump(mode="json") for row in pending_card_rows],
    )


@router.get("/{session_id}", response_model=SessionRestoreResponse)
def get_session(session_id: str, request: Request) -> SessionRestoreResponse:
    try:
        session = request.app.state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SQLite 中不存在该历史会话") from exc
    return session_detail_response(request, session)


@router.get("/{session_id}/run", response_model=SessionRunStatusResponse)
async def get_session_run_status(
    session_id: str,
    request: Request,
) -> SessionRunStatusResponse:
    try:
        request.app.state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SQLite 中不存在该历史会话") from exc
    coordinator_status = await request.app.state.chat_streams.status(session_id)
    active_row = request.app.state.sessions.latest_active_run(session_id)
    run_row = active_row or request.app.state.sessions.latest_run(session_id)
    return SessionRunStatusResponse(
        active=bool(active_row is not None and coordinator_status["active"]),
        running=bool(
            active_row is not None
            and active_row["status"] == "running"
            and coordinator_status["running"]
        ),
        run=run_from_row(run_row) if run_row is not None else None,
    )


@router.post("/{session_id}/interrupt", response_model=SessionInterruptResponse)
async def interrupt_session(
    session_id: str,
    request: Request,
) -> SessionInterruptResponse:
    try:
        request.app.state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SQLite 中不存在该历史会话") from exc

    targets = await request.app.state.chat_streams.request_interrupt(session_id)
    error = {
        "code": "explicit_interrupt",
        "message": "用户通过 interrupt 接口显式中断本轮生成。",
        "type": "RunInterrupted",
        "retryable": True,
    }
    for handle in targets:
        request.app.state.sessions.mark_run_interrupted(
            handle.run_id,
            error,
        )
    request.app.state.chat_streams.cancel_execution_tasks(targets)
    status = await request.app.state.chat_streams.status(session_id)
    return SessionInterruptResponse(
        interrupted=bool(targets),
        active=status["active"],
        run_ids=[handle.run_id for handle in targets],
    )


@router.delete("", status_code=204)
async def delete_all_sessions(request: Request) -> Response:
    if await request.app.state.chat_streams.has_active_streams():
        raise HTTPException(status_code=409, detail="仍有答疑正在生成，请等待完成后再清空全部会话")
    request.app.state.sessions.delete_all_sessions()
    logger = getattr(request.app.state, "session_logger", None)
    if logger is not None:
        logger.delete_all()
    return Response(status_code=204)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str, request: Request) -> Response:
    try:
        request.app.state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SQLite 中不存在该历史会话") from exc
    if await request.app.state.chat_streams.has_session_streams(session_id):
        raise HTTPException(status_code=409, detail="该会话仍有答疑正在生成，请先中断或等待完成")

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
    source_messages = request.app.state.sessions.list_messages(payload.session_id)
    if not profile["is_multimodal"] and (
        source["problem_image_data_url"] or messages_have_images(source_messages)
    ):
        raise HTTPException(status_code=400, detail="该历史会话包含图片，必须选择支持图片识别的模型")

    session = request.app.state.sessions.restore(payload.session_id, payload.model_profile_id)
    messages = request.app.state.sessions.list_messages(session["id"])
    checkpoints = request.app.state.sessions.list_checkpoints(session["id"])
    pending = next((row for row in reversed(checkpoints) if row["answered_at"] is None), None)
    pending_payload = checkpoint_public_payload(pending) if pending else None
    pending_card_rows = request.app.state.sessions.list_pending_cards(session["id"])
    pending_card_row = pending_card_rows[-1] if pending_card_rows else None
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
        paper_id=session["paper_id"],
        paper_name=(
            request.app.state.sessions.get_exam_paper(session["paper_id"])["name"]
            if session["paper_id"]
            else None
        ),
        state_hint=session["phase"],
        context_status=session["context_status"],
        breakpoint_description=session["breakpoint_description"],
        model_profile_id=session["model_profile_id"],
        grade_band=session["grade_band"],
        problem_text=session["problem_text"],
        student_initial_thought=session["student_initial_thought"],
        problem_image_data_url=session["problem_image_data_url"],
        messages=restored_messages(messages, checkpoints),
        pending_checkpoint=pending_payload,
        pending_card=pending_card_payload,
        pending_cards=[card_from_row(row).model_dump(mode="json") for row in pending_card_rows],
    )
