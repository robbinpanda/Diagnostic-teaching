from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import CheckpointAnswerRequest, CheckpointAnswerResponse
from app.services.input_acceptance import (
    IdempotencyConflictError,
    InputAcceptanceService,
    InputStateConflictError,
    InputValidationError,
)

router = APIRouter(prefix="/api/checkpoints", tags=["checkpoints"])


@router.post("/{checkpoint_id}/answer", response_model=CheckpointAnswerResponse)
def answer_checkpoint(
    checkpoint_id: str,
    payload: CheckpointAnswerRequest,
    request: Request,
) -> CheckpointAnswerResponse:
    service = InputAcceptanceService(request.app.state.sessions)
    try:
        accepted = service.accept_checkpoint_answer(
            checkpoint_id,
            session_id=payload.session_id,
            selected_option_id=payload.selected_option_id,
            elapsed_ms=payload.elapsed_ms,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="检查点不存在") from exc
    except PermissionError:
        raise HTTPException(status_code=400, detail="检查点不属于当前会话")
    except InputValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (IdempotencyConflictError, InputStateConflictError) as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "CHECKPOINT_ANSWER_CONFLICT",
                "message": "该检查点已用不同答案提交",
            },
        ) from exc

    result = accepted.result
    student_row = accepted.message_row
    row = accepted.checkpoint_row

    logger = getattr(request.app.state, "session_logger", None)
    if accepted.accepted and logger is not None and student_row is not None and row is not None:
        metadata = json.loads(student_row["metadata_json"] or "{}")
        checkpoint_result = metadata.get("checkpoint_result", {})
        logger.log_message(
            session_id=payload.session_id,
            message_id=student_row["id"],
            role="student",
            action_id=student_row["action_id"],
            action=student_row["action"],
            in_reply_to_action_id=student_row["in_reply_to_action_id"],
            content=student_row["content"],
        )
        logger.log_checkpoint_answer(
            session_id=payload.session_id,
            checkpoint_id=checkpoint_id,
            question=row["question"],
            selected_option_id=payload.selected_option_id,
            selected_text=checkpoint_result.get("selected_text", ""),
            is_correct=bool(result["is_correct"]),
            misconception=checkpoint_result.get("misconception"),
            elapsed_ms=checkpoint_result.get("elapsed_ms", payload.elapsed_ms),
            event=result["event"],
            next_state_hint=result["next_state_hint"],
        )

    return CheckpointAnswerResponse(
        input_id=accepted.input_row["id"],
        status="accepted" if accepted.accepted else "duplicate",
        is_correct=bool(result["is_correct"]),
        elapsed_ms=result["elapsed_ms"],
        event=result["event"],
        next_state_hint=result["next_state_hint"],
        student_message=result["student_message"],
        action_id=result["action_id"],
    )
