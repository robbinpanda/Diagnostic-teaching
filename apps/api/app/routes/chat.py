from __future__ import annotations

import asyncio
import json
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.schemas import ChatStreamRequest
from app.core.teaching_controller import NONBLOCKING_ACTIONS, generate_tutor_turn_stream
from app.llm.provider import LlmProfile
from app.routes.cards import card_from_row
from app.services.input_acceptance import (
    IdempotencyConflictError,
    InputAcceptanceService,
    InputStateConflictError,
    InputValidationError,
)
from app.storage.repositories import new_id


router = APIRouter(prefix="/api/chat", tags=["chat"])

MAX_NONBLOCKING_ACTIONS = 3


class SessionStreamCoordinator:
    """Tracks active chat streams so one session has only one writer at a time."""

    def __init__(self) -> None:
        self._guard = asyncio.Lock()
        self._active_session_ids: set[str] = set()

    async def try_start(self, session_id: str) -> bool:
        async with self._guard:
            if session_id in self._active_session_ids:
                return False
            self._active_session_ids.add(session_id)
            return True

    async def finish(self, session_id: str) -> None:
        async with self._guard:
            self._active_session_ids.discard(session_id)

    async def has_active_streams(self) -> bool:
        async with self._guard:
            return bool(self._active_session_ids)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


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


@router.post("/stream")
async def chat_stream(payload: ChatStreamRequest, request: Request) -> StreamingResponse:
    try:
        session = request.app.state.sessions.get(payload.session_id)
        profile_row = request.app.state.model_profiles.get(session["model_profile_id"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话或模型不存在") from exc
    if session["problem_image_data_url"] and not profile_row["is_multimodal"]:
        raise HTTPException(status_code=400, detail="该会话包含题图，必须使用支持图片识别的多模态模型")
    if request.app.state.sessions.latest_pending_card(payload.session_id) is not None:
        raise HTTPException(status_code=409, detail="请先关闭并保存当前学习卡片，再继续答疑")

    try:
        accepted_input = None
        input_service = InputAcceptanceService(request.app.state.sessions)
        if payload.checkpoint_answer:
            checkpoint_id = str(payload.checkpoint_answer.get("checkpoint_id", ""))
            selected_option_id = str(payload.checkpoint_answer.get("selected_option_id", ""))
            if not checkpoint_id or not selected_option_id:
                raise InputValidationError("旧版 checkpoint_answer 缺少检查点或选项 ID")
            accepted_input = input_service.accept_checkpoint_answer(
                checkpoint_id,
                session_id=payload.session_id,
                selected_option_id=selected_option_id,
                elapsed_ms=max(0, int(payload.checkpoint_answer.get("elapsed_ms", 0))),
            )
        elif payload.message and payload.message.strip():
            accepted_input = input_service.accept_student_message(
                payload.session_id,
                client_message_id=payload.client_message_id or f"legacy:{uuid.uuid4().hex}",
                message=payload.message,
            )
        if accepted_input is not None and accepted_input.accepted and accepted_input.message_row is not None:
            student_row = accepted_input.message_row
            logger = getattr(request.app.state, "session_logger", None)
            if logger is not None:
                logger.log_message(
                    session_id=payload.session_id,
                    message_id=student_row["id"],
                    role="student",
                    action_id=student_row["action_id"],
                    action=student_row["action"],
                    in_reply_to_action_id=student_row["in_reply_to_action_id"],
                    content=student_row["content"],
                )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话或检查点不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="检查点不属于当前会话") from exc
    except InputValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IdempotencyConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "IDEMPOTENCY_KEY_CONFLICT", "message": "同一客户端 ID 已用于不同输入"},
        ) from exc
    except InputStateConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "CHECKPOINT_ANSWER_CONFLICT", "message": "检查点答案冲突"},
        ) from exc

    coordinator: SessionStreamCoordinator = request.app.state.chat_streams
    if not await coordinator.try_start(payload.session_id):
        raise HTTPException(
            status_code=409,
            detail="输入已可靠接纳；该会话已有一个答疑请求正在生成，请稍后仅重试生成",
        )

    run_id = new_id("run")
    event_repository = request.app.state.sessions.events
    try:
        event_repository.append(
            payload.session_id,
            "run.started",
            {
                "run_id": run_id,
                "has_student_message": bool(
                    accepted_input is not None and accepted_input.message_row is not None
                ),
                "input_id": (
                    accepted_input.input_row["id"] if accepted_input is not None else None
                ),
            },
        )
    except Exception as exc:
        message = str(exc).strip() or exc.__class__.__name__
        try:
            event_repository.append_many(
                payload.session_id,
                [
                    (
                        "error.occurred",
                        {"run_id": run_id, "code": exc.__class__.__name__, "message": message},
                    ),
                    (
                        "run.completed",
                        {
                            "run_id": run_id,
                            "status": "failed",
                            "stop_reason": "request_setup_failed",
                            "action_count": 0,
                        },
                    ),
                    ("session.idle", {"run_id": run_id, "reason": "request_setup_failed"}),
                ],
            )
        except Exception:
            pass
        await coordinator.finish(payload.session_id)
        raise

    async def event_stream():
        terminal_events_written = False
        action_count = 0
        try:
            initial_history = request.app.state.sessions.list_messages(payload.session_id)
            nonblocking_streak = 0
            for row in reversed(initial_history):
                if row["role"] == "assistant" and row["action"] in NONBLOCKING_ACTIONS:
                    nonblocking_streak += 1
                    continue
                break
            action_index = 0
            while True:
                current_session = request.app.state.sessions.get(payload.session_id)
                history = request.app.state.sessions.list_messages(payload.session_id)
                force_blocking = nonblocking_streak >= MAX_NONBLOCKING_ACTIONS
                gen = generate_tutor_turn_stream(
                    profile_from_row(request, profile_row),
                    current_session,
                    history,
                    logger=getattr(request.app.state, "session_logger", None),
                    nonblocking_streak=nonblocking_streak,
                    force_blocking=force_blocking,
                )
                turn = None
                async for kind, value in gen:
                    if kind == "message_delta":
                        yield sse("message_delta", {"text": value, "action_index": action_index})
                    elif kind == "message_reset":
                        yield sse("message_reset", {"action_index": action_index})
                    elif kind == "turn":
                        turn = value
                if turn is None:
                    message = "本轮未拿到任何 teaching turn"
                    event_repository.append_many(
                        payload.session_id,
                        [
                            (
                                "error.occurred",
                                {"run_id": run_id, "code": "missing_turn", "message": message},
                            ),
                            (
                                "run.completed",
                                {
                                    "run_id": run_id,
                                    "status": "failed",
                                    "stop_reason": "missing_turn",
                                    "action_count": action_count,
                                },
                            ),
                            ("session.idle", {"run_id": run_id, "reason": "missing_turn"}),
                        ],
                    )
                    terminal_events_written = True
                    yield sse("error", {"message": message})
                    return

                assistant_row, checkpoint_row, card_row = request.app.state.sessions.record_tutor_action(
                    payload.session_id,
                    turn,
                    action_index=action_index,
                    run_id=run_id,
                )
                action_count += 1
                action_id = assistant_row["action_id"]
                checkpoint_payload = None
                if turn.checkpoint:
                    checkpoint_payload = turn.checkpoint.model_dump()
                    checkpoint_payload["id"] = checkpoint_row["id"]
                card_payload = (
                    card_from_row(card_row).model_dump(mode="json")
                    if card_row is not None
                    else None
                )

                logger = getattr(request.app.state, "session_logger", None)
                if logger is not None:
                    logger.log_message(
                        session_id=payload.session_id,
                        message_id=assistant_row["id"],
                        role="assistant",
                        action_id=assistant_row["action_id"],
                        action=assistant_row["action"],
                        in_reply_to_action_id=assistant_row["in_reply_to_action_id"],
                        content=assistant_row["content"],
                    )
                yield sse(
                    "decision",
                    {
                        "state_hint": turn.state_hint,
                        "action": turn.action,
                        "action_id": action_id,
                        "wait_for_student": turn.wait_for_student,
                        "message": turn.message,
                        "breakpoint": turn.breakpoint_description,
                        "confidence": turn.breakpoint_confidence,
                        "action_index": action_index,
                    },
                )
                if checkpoint_payload:
                    for option in checkpoint_payload["options"]:
                        option.pop("is_correct", None)
                        option.pop("misconception", None)
                    yield sse("checkpoint_ready", checkpoint_payload)
                if card_payload:
                    yield sse("card_ready", card_payload)

                awaiting_card_dismissal = card_payload is not None
                should_stop = (
                    turn.wait_for_student
                    or turn.action == "SUMMARIZE"
                    or awaiting_card_dismissal
                )
                if should_stop:
                    stop_reason = (
                        "card_ready"
                        if awaiting_card_dismissal
                        else "summarized"
                        if turn.action == "SUMMARIZE"
                        else "wait_for_student"
                    )
                    event_repository.append_many(
                        payload.session_id,
                        [
                            (
                                "run.completed",
                                {
                                    "run_id": run_id,
                                    "status": "succeeded",
                                    "stop_reason": stop_reason,
                                    "action_count": action_count,
                                },
                            ),
                            ("session.idle", {"run_id": run_id, "reason": stop_reason}),
                        ],
                    )
                    terminal_events_written = True
                yield sse(
                    "message_done",
                    {
                        "ok": True,
                        "action_index": action_index,
                        "wait_for_student": turn.wait_for_student,
                        "will_continue": not should_stop,
                        "awaiting_card_dismissal": awaiting_card_dismissal,
                        "continue_after_card": turn.knowledge_card is not None,
                    },
                )
                if should_stop:
                    return

                nonblocking_streak = (
                    nonblocking_streak + 1 if turn.action in NONBLOCKING_ACTIONS else 0
                )
                action_index += 1
        except (asyncio.CancelledError, GeneratorExit):
            if not terminal_events_written:
                try:
                    event_repository.append_many(
                        payload.session_id,
                        [
                            (
                                "run.completed",
                                {
                                    "run_id": run_id,
                                    "status": "cancelled",
                                    "stop_reason": "stream_disconnected",
                                    "action_count": action_count,
                                },
                            ),
                            (
                                "session.idle",
                                {"run_id": run_id, "reason": "stream_disconnected"},
                            ),
                        ],
                    )
                    terminal_events_written = True
                except Exception:
                    pass
            raise
        except Exception as exc:  # pragma: no cover - surfaced to UI
            message = str(exc).strip() or exc.__class__.__name__ or "答疑请求失败，请重试"
            if not terminal_events_written:
                try:
                    event_repository.append_many(
                        payload.session_id,
                        [
                            (
                                "error.occurred",
                                {"run_id": run_id, "code": exc.__class__.__name__, "message": message},
                            ),
                            (
                                "run.completed",
                                {
                                    "run_id": run_id,
                                    "status": "failed",
                                    "stop_reason": "error",
                                    "action_count": action_count,
                                },
                            ),
                            ("session.idle", {"run_id": run_id, "reason": "error"}),
                        ],
                    )
                    terminal_events_written = True
                except Exception:
                    pass
            yield sse("error", {"message": message})
        finally:
            if not terminal_events_written:
                try:
                    event_repository.append(
                        payload.session_id,
                        "session.idle",
                        {"run_id": run_id, "reason": "stream_closed"},
                    )
                except Exception:
                    pass
            await coordinator.finish(payload.session_id)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
