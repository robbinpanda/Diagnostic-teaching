from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.schemas import ChatStreamRequest
from app.core.teaching_controller import NONBLOCKING_ACTIONS, generate_tutor_turn_stream
from app.llm.provider import LlmProfile, LlmProviderError
from app.routes.cards import card_from_row
from app.services.input_acceptance import (
    IdempotencyConflictError,
    InputAcceptanceService,
    InputStateConflictError,
    InputValidationError,
    InputWorkflowConflictError,
)
from app.services.session_stream_coordinator import (
    RunInterrupted,
    SessionRunHandle,
    SessionStreamCoordinator,
    coordinated_generation,
)
from app.storage.repositories import RunStateConflict

router = APIRouter(prefix="/api/chat", tags=["chat"])

__all__ = [
    "RunInterrupted",
    "SessionRunHandle",
    "SessionStreamCoordinator",
    "coordinated_generation",
    "router",
]

MAX_NONBLOCKING_ACTIONS = 3


def _pending_card_blocks(row) -> bool:
    return row is not None and row["deferred_at"] is None


def _history_has_image(message_rows) -> bool:
    for row in message_rows:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        image_data_url = metadata.get("image_data_url")
        if isinstance(image_data_url, str) and image_data_url.startswith("data:image/"):
            return True
    return False


def run_error(
    code: str,
    message: str,
    *,
    error_type: str,
    retryable: bool,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "type": error_type,
        "retryable": retryable,
    }


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
        reasoning_effort=row["reasoning_effort"],
    )


def _accept_legacy_stream_input(
    payload: ChatStreamRequest,
    request: Request,
    *,
    run_id: str,
):
    service = InputAcceptanceService(request.app.state.sessions)
    if payload.checkpoint_answer:
        checkpoint_id = str(payload.checkpoint_answer.get("checkpoint_id", ""))
        selected_option_id = str(payload.checkpoint_answer.get("selected_option_id", ""))
        if not checkpoint_id or not selected_option_id:
            raise InputValidationError("旧版 checkpoint_answer 缺少检查点或选项 ID")
        return service.accept_checkpoint_answer(
            checkpoint_id,
            session_id=payload.session_id,
            selected_option_id=selected_option_id,
            elapsed_ms=max(0, int(payload.checkpoint_answer.get("elapsed_ms", 0))),
            run_id=run_id,
        )
    if payload.message and payload.message.strip():
        return service.accept_student_message(
            payload.session_id,
            client_message_id=payload.client_message_id or f"legacy:{uuid.uuid4().hex}",
            message=payload.message,
            run_id=run_id,
        )
    return None


@router.post("/stream")
async def chat_stream(payload: ChatStreamRequest, request: Request) -> StreamingResponse:
    try:
        session = request.app.state.sessions.get(payload.session_id)
        profile_row = request.app.state.model_profiles.get(session["model_profile_id"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话或模型不存在") from exc
    if not profile_row["is_multimodal"]:
        history = request.app.state.sessions.list_messages(payload.session_id)
        if session["problem_image_data_url"] or _history_has_image(history):
            raise HTTPException(status_code=400, detail="该会话包含图片，必须使用支持图片识别的多模态模型")
    pending_card = request.app.state.sessions.latest_pending_card(payload.session_id)
    has_legacy_student_message = bool(payload.message and payload.message.strip())
    if _pending_card_blocks(pending_card) and not has_legacy_student_message:
        raise HTTPException(status_code=409, detail="请先关闭并保存当前学习卡片，再继续答疑")

    coordinator: SessionStreamCoordinator = request.app.state.chat_streams
    run_row = None
    try:
        run_row = request.app.state.sessions.create_run(payload.session_id)
        handle = await coordinator.enqueue(payload.session_id, run_row["id"])
    except asyncio.CancelledError:
        if run_row is not None:
            request.app.state.sessions.mark_run_failed(
                run_row["id"],
                run_error(
                    "client_disconnected",
                    "客户端在 run 排队登记完成前停止请求。",
                    error_type="ClientDisconnected",
                    retryable=True,
                ),
            )
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    except Exception as exc:
        if run_row is not None:
            request.app.state.sessions.mark_run_failed(
                run_row["id"],
                run_error(
                    "coordinator_error",
                    str(exc).strip() or "run 排队失败",
                    error_type=exc.__class__.__name__,
                    retryable=True,
                ),
            )
        raise HTTPException(status_code=500, detail="答疑 run 排队失败，请重试") from exc

    async def event_stream():
        terminal = False
        try:
            await coordinator.start(handle)
            if handle.interrupt_requested:
                raise RunInterrupted(handle.run_id)
            running_row = request.app.state.sessions.mark_run_running(handle.run_id)
            yield sse(
                "run_started",
                {
                    "run_id": running_row["id"],
                    "attempt": running_row["attempt"],
                    "status": running_row["status"],
                },
            )

            pending_card = request.app.state.sessions.latest_pending_card(payload.session_id)
            if _pending_card_blocks(pending_card) and not has_legacy_student_message:
                raise InputWorkflowConflictError("请先关闭并保存当前学习卡片，再继续答疑")
            accepted_input = _accept_legacy_stream_input(
                payload,
                request,
                run_id=handle.run_id,
            )
            if (
                accepted_input is not None
                and accepted_input.accepted
                and accepted_input.message_row is not None
            ):
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

            initial_history = request.app.state.sessions.list_messages(payload.session_id)
            nonblocking_streak = 0
            for row in reversed(initial_history):
                if row["role"] == "assistant" and row["action"] in NONBLOCKING_ACTIONS:
                    nonblocking_streak += 1
                    continue
                break
            action_index = 0
            while True:
                if handle.interrupt_requested:
                    raise RunInterrupted(handle.run_id)
                current_session = request.app.state.sessions.get(payload.session_id)
                history = request.app.state.sessions.list_messages(payload.session_id)
                force_blocking = nonblocking_streak >= MAX_NONBLOCKING_ACTIONS
                generation = generate_tutor_turn_stream(
                    profile_from_row(request, profile_row),
                    current_session,
                    history,
                    logger=getattr(request.app.state, "session_logger", None),
                    nonblocking_streak=nonblocking_streak,
                    force_blocking=force_blocking,
                )
                turn = None
                provider_response = None
                async for kind, value in coordinated_generation(coordinator, handle, generation):
                    if kind == "progress":
                        yield sse(
                            "progress",
                            {**value, "action_index": action_index},
                        )
                    elif kind == "message_delta":
                        yield sse("message_delta", {"text": value, "action_index": action_index})
                    elif kind == "message_reset":
                        yield sse("message_reset", {"action_index": action_index})
                    elif kind == "provider_response":
                        provider_response = {
                            "provider": profile_row["provider"],
                            "model_profile_id": profile_row["id"],
                            "model": profile_row["model"],
                            "id": value,
                        }
                    elif kind == "turn":
                        turn = value
                if handle.interrupt_requested:
                    raise RunInterrupted(handle.run_id)
                if turn is None:
                    raise RuntimeError("本轮未拿到任何 teaching turn")

                try:
                    assistant_row, checkpoint_row, card_row = (
                        request.app.state.sessions.record_tutor_action(
                            payload.session_id,
                            turn,
                            action_index=action_index,
                            run_id=handle.run_id,
                            provider_response=provider_response,
                        )
                    )
                except RunStateConflict as exc:
                    if exc.status == "interrupted" or handle.interrupt_requested:
                        raise RunInterrupted(handle.run_id) from exc
                    raise
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

                awaiting_card_dismissal = card_payload is not None
                should_stop = (
                    turn.wait_for_student
                    or turn.action == "SUMMARIZE"
                    or awaiting_card_dismissal
                )
                if should_stop:
                    completed_row = request.app.state.sessions.mark_run_completed(handle.run_id)
                    if completed_row["status"] != "completed":
                        if completed_row["status"] == "interrupted" or handle.interrupt_requested:
                            raise RunInterrupted(handle.run_id)
                        raise RunStateConflict(handle.run_id, completed_row["status"])
                    terminal = True
                    await coordinator.mark_completed(handle)

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
                        "run_id": handle.run_id,
                    },
                )
                if checkpoint_payload:
                    for option in checkpoint_payload["options"]:
                        option.pop("is_correct", None)
                        option.pop("misconception", None)
                    yield sse("checkpoint_ready", checkpoint_payload)
                if card_payload:
                    yield sse("card_ready", card_payload)
                yield sse(
                    "message_done",
                    {
                        "ok": True,
                        "action_index": action_index,
                        "wait_for_student": turn.wait_for_student,
                        "will_continue": not should_stop,
                        "awaiting_card_dismissal": awaiting_card_dismissal,
                        "continue_after_card": turn.knowledge_card is not None,
                        "run_id": handle.run_id,
                    },
                )
                if should_stop:
                    return

                nonblocking_streak = (
                    nonblocking_streak + 1 if turn.action in NONBLOCKING_ACTIONS else 0
                )
                action_index += 1
        except RunInterrupted:
            error = run_error(
                "explicit_interrupt",
                "本轮生成已由用户显式中断。",
                error_type="RunInterrupted",
                retryable=True,
            )
            request.app.state.sessions.mark_run_interrupted(handle.run_id, error)
            terminal = True
            yield sse("run_interrupted", {"run_id": handle.run_id, "status": "interrupted"})
        except asyncio.CancelledError:
            error = run_error(
                "client_disconnected",
                "客户端停止读取响应，服务端已取消本次执行。",
                error_type="ClientDisconnected",
                retryable=True,
            )
            request.app.state.sessions.mark_run_failed(handle.run_id, error)
            terminal = True
            raise
        except Exception as exc:
            message = str(exc).strip() or exc.__class__.__name__ or "答疑请求失败，请重试"
            if isinstance(exc, LlmProviderError):
                code = "provider_error"
            elif isinstance(
                exc,
                (
                    IdempotencyConflictError,
                    InputStateConflictError,
                    InputValidationError,
                    InputWorkflowConflictError,
                ),
            ):
                code = "input_error"
            else:
                code = "run_failed"
            error = run_error(
                code,
                message,
                error_type=exc.__class__.__name__,
                retryable=code != "input_error",
            )
            request.app.state.sessions.mark_run_failed(handle.run_id, error)
            terminal = True
            yield sse("error", {"message": message, "run_id": handle.run_id, "code": code})
        finally:
            if not terminal:
                error = run_error(
                    "stream_closed",
                    "响应流在完成前关闭，服务端已清理本次执行。",
                    error_type="StreamClosed",
                    retryable=True,
                )
                request.app.state.sessions.mark_run_failed(handle.run_id, error)
            await coordinator.finish(handle)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"X-Run-Id": handle.run_id},
    )
