from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import (
    MistakeSetCreateRequest,
    MistakeSetItemPublic,
    MistakeSetListResponse,
    MistakeSetPublic,
)
from app.storage.mistake_set_repository import (
    DuplicateMistakeSetSessionError,
    MistakeSetSourceNotFoundError,
)

router = APIRouter(prefix="/api/mistake-sets", tags=["mistake-sets"])


def mistake_set_from_rows(row, item_rows) -> MistakeSetPublic:
    return MistakeSetPublic(
        id=row["id"],
        name=row["name"],
        items=[
            MistakeSetItemPublic(
                id=item["id"],
                source_session_id=item["source_session_id"],
                source_paper_name=item["source_paper_name"],
                title=item["title"],
                problem_text=item["problem_text"],
                problem_image_data_url=item["problem_image_data_url"],
                position=item["position"],
                created_at=item["created_at"],
            )
            for item in item_rows
        ],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=MistakeSetListResponse)
def list_mistake_sets(request: Request) -> MistakeSetListResponse:
    return MistakeSetListResponse(
        mistake_sets=[
            mistake_set_from_rows(row, items)
            for row, items in request.app.state.sessions.list_mistake_sets()
        ]
    )


@router.get("/{mistake_set_id}", response_model=MistakeSetPublic)
def get_mistake_set(mistake_set_id: str, request: Request) -> MistakeSetPublic:
    try:
        row, items = request.app.state.sessions.get_mistake_set(mistake_set_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="错题集不存在") from exc
    return mistake_set_from_rows(row, items)


@router.post("", response_model=MistakeSetPublic, status_code=201)
def create_mistake_set(
    payload: MistakeSetCreateRequest,
    request: Request,
) -> MistakeSetPublic:
    try:
        row, items = request.app.state.sessions.create_mistake_set(
            payload.name,
            payload.session_ids,
        )
    except DuplicateMistakeSetSessionError as exc:
        raise HTTPException(
            status_code=400,
            detail="错题集不能重复选择同一题目",
        ) from exc
    except MistakeSetSourceNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="部分题目已经不存在，请刷新错题合集后重试",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return mistake_set_from_rows(row, items)
