from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.schemas import (
    ExamPaperCreateRequest,
    ExamPaperListResponse,
    ExamPaperPublic,
)

router = APIRouter(prefix="/api/exam-papers", tags=["exam-papers"])


def paper_from_row(row) -> ExamPaperPublic:
    return ExamPaperPublic(
        id=row["id"],
        name=row["name"],
        session_count=row["session_count"] if "session_count" in row.keys() else 0,
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
    return paper_from_row(request.app.state.sessions.create_exam_paper(payload.name))
