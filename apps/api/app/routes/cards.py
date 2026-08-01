from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.schemas import (
    StudyCardListResponse,
    StudyCardPlacementRequest,
    StudyCardPublic,
    StudyCardSaveRequest,
    StudyCardUpdateRequest,
)

router = APIRouter(prefix="/api/cards", tags=["cards"])


def card_from_row(row) -> StudyCardPublic:
    return StudyCardPublic(
        id=row["id"],
        session_id=row["session_id"],
        card_type=row["card_type"],
        source_action_id=row["source_action_id"],
        source_message_id=row["source_message_id"],
        content=json.loads(row["content_json"]),
        folder_id=row["folder_id"],
        created_at=row["created_at"],
        saved_at=row["saved_at"],
        deferred_at=row["deferred_at"],
    )


@router.get("", response_model=StudyCardListResponse)
def list_cards(
    request: Request,
    card_type: Literal["knowledge_card", "problem_card"] | None = None,
) -> StudyCardListResponse:
    rows = request.app.state.sessions.list_cards()
    if card_type:
        rows = [row for row in rows if row["card_type"] == card_type]
    return StudyCardListResponse(cards=[card_from_row(row) for row in rows])


@router.post("/{card_id}/save", response_model=StudyCardPublic)
def save_card(card_id: str, payload: StudyCardSaveRequest, request: Request) -> StudyCardPublic:
    try:
        row = request.app.state.sessions.save_card(
            card_id,
            session_id=payload.session_id,
            folder_id=payload.folder_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="卡片不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="卡片不属于当前会话") from exc
    return card_from_row(row)


@router.post("/{card_id}/copy", response_model=StudyCardPublic, status_code=201)
def copy_card(
    card_id: str,
    payload: StudyCardPlacementRequest,
    request: Request,
) -> StudyCardPublic:
    try:
        row = request.app.state.sessions.copy_card(card_id, folder_id=payload.folder_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="卡片或目标文件夹不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail="待归档卡片不能复制") from exc
    return card_from_row(row)


@router.patch("/{card_id}/move", response_model=StudyCardPublic)
def move_card(
    card_id: str,
    payload: StudyCardPlacementRequest,
    request: Request,
) -> StudyCardPublic:
    try:
        row = request.app.state.sessions.move_card(card_id, folder_id=payload.folder_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="卡片或目标文件夹不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail="待归档卡片不能移动") from exc
    return card_from_row(row)

@router.put("/{card_id}", response_model=StudyCardPublic)
def update_card(card_id: str, payload: StudyCardUpdateRequest, request: Request) -> StudyCardPublic:
    try:
        row = request.app.state.sessions.update_saved_knowledge_card(
            card_id,
            content=payload.content.model_dump(),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="卡片不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail="待归档知识卡片必须先在对话中确认") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="只有已归档知识卡片支持修改") from exc
    return card_from_row(row)


@router.delete("", status_code=204)
async def delete_all_cards(request: Request) -> Response:
    if await request.app.state.chat_streams.has_active_streams():
        raise HTTPException(status_code=409, detail="仍有答疑正在生成，请等待完成后再清空全部卡片")
    request.app.state.sessions.delete_all_cards()
    return Response(status_code=204)


@router.delete("/{card_id}", status_code=204)
def delete_card(
    card_id: str,
    request: Request,
) -> Response:
    try:
        request.app.state.sessions.delete_card(card_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="卡片不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail="待归档卡片不能从全局卡片库删除") from exc
    return Response(status_code=204)
