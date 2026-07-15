from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.core.schemas import StudyCardListResponse, StudyCardPublic, StudyCardSaveRequest


router = APIRouter(prefix="/api/cards", tags=["cards"])


def card_from_row(row) -> StudyCardPublic:
    return StudyCardPublic(
        id=row["id"],
        session_id=row["session_id"],
        card_type=row["card_type"],
        source_action_id=row["source_action_id"],
        source_message_id=row["source_message_id"],
        content=json.loads(row["content_json"]),
        created_at=row["created_at"],
        saved_at=row["saved_at"],
    )


@router.get("", response_model=StudyCardListResponse)
def list_cards(
    request: Request,
    session_id: str = Query(min_length=1),
    card_type: Literal["knowledge_card", "problem_card"] | None = None,
) -> StudyCardListResponse:
    try:
        request.app.state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    rows = request.app.state.sessions.list_cards(session_id)
    if card_type:
        rows = [row for row in rows if row["card_type"] == card_type]
    return StudyCardListResponse(cards=[card_from_row(row) for row in rows])


@router.post("/{card_id}/save", response_model=StudyCardPublic)
def save_card(card_id: str, payload: StudyCardSaveRequest, request: Request) -> StudyCardPublic:
    try:
        row = request.app.state.sessions.save_card(card_id, session_id=payload.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="卡片不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="卡片不属于当前会话") from exc
    return card_from_row(row)


@router.delete("/{card_id}", status_code=204)
def delete_card(
    card_id: str,
    request: Request,
    session_id: str = Query(min_length=1),
) -> Response:
    try:
        request.app.state.sessions.delete_card(card_id, session_id=session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="卡片不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="卡片不属于当前会话") from exc
    return Response(status_code=204)
