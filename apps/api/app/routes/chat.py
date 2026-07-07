from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.schemas import ChatStreamRequest
from app.core.teaching_controller import generate_tutor_turn
from app.llm.provider import LlmProfile

router = APIRouter(prefix="/api/chat", tags=["chat"])


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
        request.app.state.sessions.add_message(payload.session_id, "student", payload.message.strip())

    async def event_stream():
        try:
            history = request.app.state.sessions.list_messages(payload.session_id)
            turn = await generate_tutor_turn(profile_from_row(request, profile_row), session, history)
            request.app.state.sessions.update_phase(
                payload.session_id,
                turn.phase,
                turn.breakpoint_description,
                turn.breakpoint_confidence,
            )
            yield sse(
                "decision",
                {
                    "phase": turn.phase,
                    "action": turn.action,
                    "breakpoint": turn.breakpoint_description,
                    "confidence": turn.breakpoint_confidence,
                },
            )
            for idx in range(0, len(turn.message), 18):
                yield sse("message_delta", {"text": turn.message[idx : idx + 18]})
                await asyncio.sleep(0)
            request.app.state.sessions.add_message(
                payload.session_id,
                "assistant",
                turn.message,
                {
                    "phase": turn.phase,
                    "action": turn.action,
                    "breakpoint": turn.breakpoint_description,
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
            yield sse("message_done", {"ok": True})
        except Exception as exc:  # pragma: no cover - surfaced to UI
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
