from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import (
    ExamPaperCreateRequest,
    ExamPaperListResponse,
    ExamPaperPublic,
)
from app.storage.exam_paper_repository import ManagedPaperFolderConflictError

router = APIRouter(prefix="/api/exam-papers", tags=["exam-papers"])


def paper_from_row(row) -> ExamPaperPublic:
    return ExamPaperPublic(
        id=row["id"],
        name=row["name"],
        card_folder_id=row["card_folder_id"],
        # sqlite3.Row membership checks values, so key lookup must use keys().
        session_count=row["session_count"] if "session_count" in row.keys() else 0,  # noqa: SIM118
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=ExamPaperListResponse)
def list_exam_papers(request: Request) -> ExamPaperListResponse:
    return ExamPaperListResponse(
        papers=[paper_from_row(row) for row in request.app.state.sessions.list_exam_papers()]
    )


@router.post("", response_model=ExamPaperPublic, status_code=201)
def create_exam_paper(payload: ExamPaperCreateRequest, request: Request) -> ExamPaperPublic:
    try:
        row = request.app.state.sessions.create_exam_paper(payload.name)
    except ManagedPaperFolderConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return paper_from_row(row)
