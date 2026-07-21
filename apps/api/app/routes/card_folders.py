from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.schemas import (
    CardFolderCreateRequest,
    CardFolderListResponse,
    CardFolderPublic,
    CardFolderUpdateRequest,
)
from app.storage.card_folder_repository import (
    CardFolderConflictError,
    CardFolderNotEmptyError,
    CardFolderProtectedError,
)

router = APIRouter(prefix="/api/card-folders", tags=["card-folders"])


def folder_from_row(row) -> CardFolderPublic:
    return CardFolderPublic(
        id=row["id"],
        name=row["name"],
        parent_id=row["parent_id"],
        is_system=bool(row["is_system"]),
        default_card_type=row["default_card_type"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=CardFolderListResponse)
def list_card_folders(request: Request) -> CardFolderListResponse:
    rows = request.app.state.sessions.list_card_folders()
    return CardFolderListResponse(folders=[folder_from_row(row) for row in rows])


@router.post("", response_model=CardFolderPublic, status_code=201)
def create_card_folder(
    payload: CardFolderCreateRequest,
    request: Request,
) -> CardFolderPublic:
    try:
        row = request.app.state.sessions.create_card_folder(
            name=payload.name,
            parent_id=payload.parent_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="上级文件夹不存在") from exc
    except CardFolderConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return folder_from_row(row)


@router.patch("/{folder_id}", response_model=CardFolderPublic)
def update_card_folder(
    folder_id: str,
    payload: CardFolderUpdateRequest,
    request: Request,
) -> CardFolderPublic:
    if not payload.model_fields_set:
        raise HTTPException(status_code=400, detail="没有可更新的文件夹字段")
    try:
        row = request.app.state.sessions.update_card_folder(
            folder_id,
            name=payload.name,
            parent_id=payload.parent_id,
            update_parent="parent_id" in payload.model_fields_set,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="文件夹或上级文件夹不存在") from exc
    except CardFolderProtectedError as exc:
        raise HTTPException(status_code=409, detail="默认文件夹不能重命名或移动") from exc
    except CardFolderConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return folder_from_row(row)


@router.delete("/{folder_id}", status_code=204)
def delete_card_folder(folder_id: str, request: Request) -> Response:
    try:
        request.app.state.sessions.delete_card_folder(folder_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="文件夹不存在") from exc
    except CardFolderProtectedError as exc:
        raise HTTPException(status_code=409, detail="默认文件夹不能删除") from exc
    except CardFolderNotEmptyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=204)
