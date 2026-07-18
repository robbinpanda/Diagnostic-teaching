from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.schemas import (
    SessionCreate,
    SessionCreateResponse,
    SessionHistoryListResponse,
    SessionInterruptResponse,
    SessionIntakeRequest,
    SessionIntakeResponse,
    SessionRestoreRequest,
    SessionRestoreResponse,
    SessionRestoredMessage,
    SessionRunPublic,
    SessionRunStatusResponse,
)
from app.routes.cards import card_from_row

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

INTAKE_LABEL_RE = re.compile(
    r"(?:^|\n)\s*(?P<label>题目|问题|题干|我的思路|思路|想法|尝试|我想到哪|我做到哪)\s*[:：]\s*",
    re.IGNORECASE,
)
THOUGHT_LABELS = {"我的思路", "思路", "想法", "尝试", "我想到哪", "我做到哪"}
THOUGHT_ONLY_RE = re.compile(
    r"^\s*(?:我|目前|现在|还没|没有|完全不会|不知道|没思路|卡在|做到|想到)",
    re.IGNORECASE,
)
INLINE_THOUGHT_RE = re.compile(
    r"(?:\n+|[。；;]\s*)(?P<thought>(?:我|目前|现在|还没|没有|完全不会|不知道|没思路|卡在).+)$",
    re.IGNORECASE | re.DOTALL,
)


def run_from_row(row) -> SessionRunPublic:
    return SessionRunPublic(
        run_id=row["id"],
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


def resolve_intake(
    message: str,
    problem_text: str = "",
    student_initial_thought: str = "",
) -> tuple[str, str]:
    """Merge one free-form composer turn into the two fields required by tutoring.

    Explicit labels win. Once one field has been collected, the next unlabeled turn
    fills the missing field, which makes the follow-up conversation deterministic.
    """

    problem = problem_text.strip()
    thought = student_initial_thought.strip()
    text = message.strip()
    if not text:
        return problem, thought

    matches = list(INTAKE_LABEL_RE.finditer(text))
    labeled_problem = ""
    labeled_thought = ""
    for index, match in enumerate(matches):
        value_start = match.end()
        value_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        value = text[value_start:value_end].strip()
        if not value:
            continue
        if match.group("label") in THOUGHT_LABELS:
            labeled_thought = value
        else:
            labeled_problem = value

    if labeled_problem:
        problem = labeled_problem
    if labeled_thought:
        thought = labeled_thought
    if matches:
        return problem, thought

    if problem and not thought:
        return problem, text
    if thought and not problem:
        return text, thought

    inline_thought = INLINE_THOUGHT_RE.search(text)
    if inline_thought and inline_thought.start("thought") > 0:
        possible_problem = text[: inline_thought.start()].strip(" \n。；;")
        possible_thought = inline_thought.group("thought").strip()
        if possible_problem and possible_thought:
            return possible_problem, possible_thought

    if THOUGHT_ONLY_RE.match(text):
        return problem, text
    return text, thought


def validate_session_profile(payload: SessionCreate, request: Request):
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


@router.post("", response_model=SessionCreateResponse)
def create_session(payload: SessionCreate, request: Request) -> SessionCreateResponse:
    session = persist_session(payload, request)
    return SessionCreateResponse(
        session_id=session["id"],
        state_hint=session["phase"],
        model_profile_id=session["model_profile_id"],
    )


@router.post("/intake", response_model=SessionIntakeResponse)
def intake_session(payload: SessionIntakeRequest, request: Request) -> SessionIntakeResponse:
    problem, thought = resolve_intake(
        payload.message,
        payload.problem_text,
        payload.student_initial_thought,
    )
    common = {
        "problem_text": problem,
        "student_initial_thought": thought,
        "model_profile_id": payload.model_profile_id,
    }
    if not problem:
        return SessionIntakeResponse(
            status="needs_problem",
            assistant_message=(
                "我先记下了你目前的想法。请把完整题目也发给我；可以直接粘贴文字，或点回形针上传题目图片。"
                if thought
                else "先把题目发给我吧。你可以直接粘贴文字，或点回形针上传题目图片。"
            ),
            **common,
        )
    if not thought:
        return SessionIntakeResponse(
            status="needs_thought",
            assistant_message="题目收到了。你已经想到哪一步、试过什么，或者具体卡在哪里？完全没思路也可以直接说。",
            **common,
        )

    session_payload = SessionCreate(
        grade_band=payload.grade_band,
        subject=payload.subject,
        model_profile_id=payload.model_profile_id,
        problem_text=problem,
        student_initial_thought=thought,
        problem_image_data_url=payload.problem_image_data_url,
    )
    session = persist_session(session_payload, request)
    return SessionIntakeResponse(
        status="ready",
        assistant_message="题目和你的思路都收到了，我们从你当前卡住的位置开始。",
        session_id=session["id"],
        state_hint=session["phase"],
        **common,
    )


@router.get("/history", response_model=SessionHistoryListResponse)
def list_session_history(request: Request) -> SessionHistoryListResponse:
    rows = request.app.state.sessions.list_history()
    return SessionHistoryListResponse(
        sessions=[
            {
                "session_id": row["id"],
                "restored_from": row["restored_from"],
                # Keep complete math delimiters; the frontend applies visual ellipsis.
                "title": row["problem_text"].strip().replace("\n", " "),
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


def session_detail_response(request: Request, session) -> SessionRestoreResponse:
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
    return SessionRestoreResponse(
        session_id=session["id"],
        restored_from=session["restored_from"],
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
        request.app.state.sessions.mark_run_interrupted(handle.run_id, error)
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
