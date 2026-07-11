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
            session_id=payload.session_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="检查点不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="检查点不属于当前会话")

    options = json.loads(row["options_json"])["options"]
    selected = next((option for option in options if option["id"] == payload.selected_option_id), None)
    selected_text = selected["text"] if selected else payload.selected_option_id
    misconception = selected.get("misconception") if selected else None
    if payload.selected_option_id == "UNKNOWN":
        event = "CHECKPOINT_UNKNOWN"
        next_state_hint = "recovering"
    elif is_correct:
        event = "CHECKPOINT_CORRECT"
        next_state_hint = "scaffolding"
    else:
        event = "CHECKPOINT_WRONG"
        next_state_hint = "recovering"

    # 注意：这里不再向 messages 表写入 student_checkpoint 角色的消息。
    # 学生的选择会由前端通过 /api/chat/stream 的 message 字段以普通 student
    # 消息进入 AI 上下文，避免历史里出现语义模糊的非标准角色。
    # checkpoints 表本身已记录 selected_option_id / is_correct / elapsed_ms
    # 作为权威答题数据，此处只更新阶段，并写一条结构化诊断日志。
    request.app.state.sessions.update_phase(payload.session_id, next_state_hint, None, None)

    logger = getattr(request.app.state, "session_logger", None)
    if logger is not None:
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

    return CheckpointAnswerResponse(is_correct=is_correct, event=event, next_state_hint=next_state_hint)
