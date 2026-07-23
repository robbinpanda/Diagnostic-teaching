from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import (
    ProblemTextAnalyzeRequest,
    ProblemTextAnalyzeResponse,
    SplitTextProblem,
)
from app.core.teaching_controller import extract_json_object
from app.llm.provider import LlmProfile, analyze_problem_text

router = APIRouter(prefix="/api/problem-intake", tags=["problem intake"])


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


def normalize_text_problems(data: dict[str, Any]) -> list[SplitTextProblem]:
    raw_problems = data.get("problems")
    if not isinstance(raw_problems, list):
        return []
    problems: list[SplitTextProblem] = []
    for raw in raw_problems[:20]:
        if not isinstance(raw, dict):
            continue
        problem_text = str(raw.get("problem_text") or "").strip()
        thought = str(raw.get("student_initial_thought") or "").strip()
        if not problem_text:
            continue
        problems.append(
            SplitTextProblem(
                problem_text=problem_text[:20_000],
                student_initial_thought=thought[:20_000],
            )
        )
    return problems


@router.post("/analyze-text", response_model=ProblemTextAnalyzeResponse)
async def analyze_text(
    payload: ProblemTextAnalyzeRequest,
    request: Request,
) -> ProblemTextAnalyzeResponse:
    try:
        row = request.app.state.model_profiles.get(payload.model_profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="模型配置不存在") from exc

    try:
        raw = await analyze_problem_text(profile_from_row(request, row), payload.text.strip())
        data = extract_json_object(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="拆题模型返回格式不完整，请重试") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "文字拆题失败") from exc

    problems = normalize_text_problems(data)
    if not problems:
        raise HTTPException(status_code=422, detail="没有识别到可创建答疑的数学题")
    return ProblemTextAnalyzeResponse(problems=problems)
