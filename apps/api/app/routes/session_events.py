from __future__ import annotations

import asyncio
import json
from time import monotonic

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.core.schemas import SessionEventHistoryResponse, SessionEventPublic
from app.storage.session_events import (
    DEFAULT_EVENT_HISTORY_LIMIT,
    MAX_EVENT_HISTORY_LIMIT,
    SESSION_EVENT_SCHEMA_VERSION,
    event_from_row,
)


router = APIRouter(prefix="/api/sessions", tags=["session-events"])
EVENT_STREAM_POLL_SECONDS = 0.1
EVENT_STREAM_KEEPALIVE_SECONDS = 15.0


def _require_session(request: Request, session_id: str) -> None:
    try:
        request.app.state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SQLite 中不存在该历史会话") from exc


def _event_sse(row) -> str:
    envelope = event_from_row(row)
    return (
        f"id: {envelope['seq']}\n"
        "event: session_event\n"
        f"data: {json.dumps(envelope, ensure_ascii=False, separators=(',', ':'))}\n\n"
    )


@router.get("/{session_id}/events", response_model=SessionEventHistoryResponse)
def list_session_events(
    session_id: str,
    request: Request,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=DEFAULT_EVENT_HISTORY_LIMIT, ge=1, le=MAX_EVENT_HISTORY_LIMIT),
) -> SessionEventHistoryResponse:
    _require_session(request, session_id)
    repository = request.app.state.sessions.events
    rows = repository.list(session_id, after_seq=after_seq, limit=limit + 1)
    has_more = len(rows) > limit
    page = rows[:limit]
    next_after_seq = page[-1]["seq"] if page else after_seq
    return SessionEventHistoryResponse(
        schema_version=SESSION_EVENT_SCHEMA_VERSION,
        session_id=session_id,
        after_seq=after_seq,
        next_after_seq=next_after_seq,
        latest_seq=repository.latest_seq(session_id),
        has_more=has_more,
        events=[SessionEventPublic.model_validate(event_from_row(row)) for row in page],
    )


@router.get("/{session_id}/events/stream")
async def stream_session_events(
    session_id: str,
    request: Request,
    after_seq: int | None = Query(default=None, ge=0),
    follow: bool = Query(default=True),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    """Replay durable events after a cursor, then optionally follow new events."""

    _require_session(request, session_id)
    cursor = after_seq
    if cursor is None:
        try:
            cursor = int(last_event_id) if last_event_id is not None else 0
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Last-Event-ID 必须是非负 seq") from exc
        if cursor < 0:
            raise HTTPException(status_code=400, detail="Last-Event-ID 必须是非负 seq")

    repository = request.app.state.sessions.events

    async def event_stream():
        nonlocal cursor
        last_output_at = monotonic()
        while True:
            rows = repository.list(
                session_id,
                after_seq=cursor,
                limit=MAX_EVENT_HISTORY_LIMIT,
            )
            if rows:
                for row in rows:
                    cursor = row["seq"]
                    last_output_at = monotonic()
                    yield _event_sse(row)
                continue
            if not follow or await request.is_disconnected():
                return
            try:
                request.app.state.sessions.get(session_id)
            except KeyError:
                return
            if monotonic() - last_output_at >= EVENT_STREAM_KEEPALIVE_SECONDS:
                last_output_at = monotonic()
                yield ": keep-alive\n\n"
            await asyncio.sleep(EVENT_STREAM_POLL_SECONDS)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
