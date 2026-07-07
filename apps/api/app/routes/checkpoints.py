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
        row, is_correct = request.app.state.sessions.answer_checkpoint(
            checkpoint_id,
            payload.selected_option_id,
            payload.elapsed_ms,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="检查点不存在") from exc

    if row["session_id"] != payload.session_id:
        raise HTTPException(status_code=400, detail="检查点不属于当前会话")

    options = json.loads(row["options_json"])["options"]
    selected = next((option for option in options if option["id"] == payload.selected_option_id), None)
    if payload.selected_option_id == "UNKNOWN":
        event = "CHECKPOINT_UNKNOWN"
        content = f"我选择了：我不知道。检查点：{row['question']}"
        next_phase = "recovering"
    elif is_correct:
        event = "CHECKPOINT_CORRECT"
        content = f"我选择了正确答案：{selected['text'] if selected else payload.selected_option_id}"
        next_phase = "scaffolding"
    else:
        event = "CHECKPOINT_WRONG"
        content = f"我选择了：{selected['text'] if selected else payload.selected_option_id}。这个选择可能对应的误区：{selected.get('misconception') if selected else '未知'}"
        next_phase = "recovering"

    request.app.state.sessions.add_message(
        payload.session_id,
        "student_checkpoint",
        content,
        {
            "checkpoint_id": checkpoint_id,
            "selected_option_id": payload.selected_option_id,
            "is_correct": is_correct,
            "event": event,
        },
    )
    request.app.state.sessions.update_phase(payload.session_id, next_phase, None, None)
    return CheckpointAnswerResponse(is_correct=is_correct, event=event, next_phase=next_phase)
