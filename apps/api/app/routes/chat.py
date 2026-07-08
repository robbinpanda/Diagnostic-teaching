from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.schemas import ChatStreamRequest
from app.core.teaching_controller import NONBLOCKING_ACTIONS, generate_tutor_turn_stream
from app.llm.provider import LlmProfile

router = APIRouter(prefix="/api/chat", tags=["chat"])

MAX_NONBLOCKING_ACTIONS = 3


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

    if payload.message and payload.message.strip():
        request.app.state.sessions.add_message(
            payload.session_id,
            "student",
            payload.message.strip(),
            {"checkpoint_answer": payload.checkpoint_answer} if payload.checkpoint_answer else None,
        )

    async def event_stream():
        try:
            nonblocking_streak = 0
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
                        # 真打字机：LLM 一边生成一边把 message 字段的可见字符透传给前端
                        yield sse("message_delta", {"text": value, "action_index": action_index})
                    elif kind == "turn":
                        turn = value
                if turn is None:
                    yield sse("error", {"message": "本轮未拿到任何 teaching turn"})
                    return

                request.app.state.sessions.update_phase(
                    payload.session_id,
                    turn.state_hint,
                    turn.breakpoint_description,
                    turn.breakpoint_confidence,
                )
                yield sse(
                    "decision",
                    {
                        "state_hint": turn.state_hint,
                        "action": turn.action,
                        "wait_for_student": turn.wait_for_student,
                        "message": turn.message,
                        "breakpoint": turn.breakpoint_description,
                        "confidence": turn.breakpoint_confidence,
                        "action_index": action_index,
                    },
                )
                request.app.state.sessions.add_message(
                    payload.session_id,
                    "assistant",
                    turn.message,
                    {
                        "state_hint": turn.state_hint,
                        "action": turn.action,
                        "wait_for_student": turn.wait_for_student,
                        "breakpoint": turn.breakpoint_description,
                        "action_index": action_index,
                    },
                )
                if turn.checkpoint:
                    checkpoint_row = request.app.state.sessions.create_checkpoint(payload.session_id, turn.checkpoint)
                    checkpoint_payload = turn.checkpoint.model_dump()
                    checkpoint_payload["id"] = checkpoint_row["id"]
                    for option in checkpoint_payload["options"]:
                        option.pop("is_correct", None)
                        option.pop("misconception", None)
                    yield sse("checkpoint_ready", checkpoint_payload)

                should_stop = turn.wait_for_student or turn.action == "SUMMARIZE"
                yield sse(
                    "message_done",
                    {
                        "ok": True,
                        "action_index": action_index,
                        "wait_for_student": turn.wait_for_student,
                        "will_continue": not should_stop,
                    },
                )
                if should_stop:
                    return

                nonblocking_streak = nonblocking_streak + 1 if turn.action in NONBLOCKING_ACTIONS else 0
                action_index += 1
        except Exception as exc:  # pragma: no cover - surfaced to UI
            message = str(exc).strip() or exc.__class__.__name__ or "答疑请求失败，请重试"
            yield sse("error", {"message": message})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
