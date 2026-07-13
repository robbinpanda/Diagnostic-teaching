from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import CheckpointAnswerRequest, CheckpointAnswerResponse

router = APIRouter(prefix="/api/checkpoints", tags=["checkpoints"])


@router.post("/{checkpoint_id}/answer", response_model=CheckpointAnswerResponse)
def answer_checkpoint(
    checkpoint_id: str,
    payload: CheckpointAnswerRequest,
    request: Request,
) -> CheckpointAnswerResponse:
    try:
        existing = request.app.state.sessions.get_checkpoint(checkpoint_id)
        if existing["session_id"] != payload.session_id:
            raise PermissionError(checkpoint_id)
        if existing["answered_at"] is not None:
            raise FileExistsError(checkpoint_id)
        checkpoint_payload = json.loads(existing["options_json"])
        allowed = {
            option["id"] for option in checkpoint_payload.get("options", [])
        } | {checkpoint_payload.get("unknown_option", {}).get("id", "UNKNOWN")}
        if payload.selected_option_id not in allowed:
            raise ValueError(payload.selected_option_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="检查点不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="检查点不属于当前会话")
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="该检查点已经回答，不能重复覆盖") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="选择项不存在") from exc

    checkpoint_payload = json.loads(existing["options_json"])
    options = checkpoint_payload["options"]
    selected = next((option for option in options if option["id"] == payload.selected_option_id), None)
    unknown = checkpoint_payload.get("unknown_option", {"id": "UNKNOWN", "text": "我不知道"})
    selected_text = selected["text"] if selected else unknown["text"]
    misconception = selected.get("misconception") if selected else None
    is_correct = payload.selected_option_id == existing["correct_option_id"]
    if payload.selected_option_id == unknown["id"]:
        event = "CHECKPOINT_UNKNOWN"
        next_state_hint = "recovering"
    elif is_correct:
        event = "CHECKPOINT_CORRECT"
        next_state_hint = "scaffolding"
    else:
        event = "CHECKPOINT_WRONG"
        next_state_hint = "recovering"

    student_message = f"我在检查点「{existing['question']}」选了：{payload.selected_option_id} {selected_text}"
    checkpoint_result = {
        "checkpoint_id": checkpoint_id,
        "question": existing["question"],
        "selected_option_id": payload.selected_option_id,
        "selected_text": selected_text,
        "is_correct": bool(is_correct),
        "misconception": misconception,
        "elapsed_ms": payload.elapsed_ms,
        "event": event,
        "next_state_hint": next_state_hint,
    }
    try:
        row, is_correct, student_row = request.app.state.sessions.record_checkpoint_response(
            checkpoint_id,
            payload.selected_option_id,
            payload.elapsed_ms,
            session_id=payload.session_id,
            student_message=student_message,
            checkpoint_result=checkpoint_result,
            next_state_hint=next_state_hint,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="检查点不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="检查点不属于当前会话") from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="该检查点已经回答，不能重复覆盖") from exc

    logger = getattr(request.app.state, "session_logger", None)
    if logger is not None:
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
            selected_text=selected_text,
            is_correct=bool(is_correct),
            misconception=misconception,
            elapsed_ms=payload.elapsed_ms,
            event=event,
            next_state_hint=next_state_hint,
        )

    return CheckpointAnswerResponse(
        is_correct=is_correct,
        event=event,
        next_state_hint=next_state_hint,
        student_message=student_message,
        action_id=student_row["action_id"],
    )
