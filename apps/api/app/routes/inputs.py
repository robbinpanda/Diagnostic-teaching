from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.schemas import (
    CardDismissedContinueInputRequest,
    SessionInputAcceptRequest,
    SessionInputAcceptResponse,
    StudentMessageInputRequest,
)
from app.services.input_acceptance import (
    IdempotencyConflictError,
    InputAcceptanceService,
    InputStateConflictError,
    InputValidationError,
    InputWorkflowConflictError,
)

router = APIRouter(prefix="/api/sessions", tags=["session-inputs"])


def input_response(result) -> SessionInputAcceptResponse:
    row = result.input_row
    return SessionInputAcceptResponse(
        input_id=row["id"],
        kind=row["kind"],
        status="accepted" if result.accepted else "duplicate",
        idempotency_key=row["idempotency_key"],
        created_at=row["created_at"],
        message_id=row["message_id"],
        action_id=result.result.get("action_id"),
        in_reply_to_action_id=result.result.get("in_reply_to_action_id"),
        card_id=row["card_id"],
        card_saved_at=result.result.get("card_saved_at"),
        folder_id=result.result.get("folder_id"),
    )


@router.post("/{session_id}/inputs", response_model=SessionInputAcceptResponse)
def accept_session_input(
    session_id: str,
    payload: SessionInputAcceptRequest,
    request: Request,
    response: Response,
) -> SessionInputAcceptResponse:
    service = InputAcceptanceService(request.app.state.sessions)
    try:
        if isinstance(payload, StudentMessageInputRequest):
            result = service.accept_student_message(
                session_id,
                client_message_id=payload.client_message_id,
                message=payload.message,
            )
        elif isinstance(payload, CardDismissedContinueInputRequest):
            result = service.accept_card_dismissed_continue(
                session_id,
                client_command_id=payload.client_command_id,
                card_id=payload.card_id,
                folder_id=payload.folder_id,
            )
        else:  # pragma: no cover - protected by the discriminated schema
            raise InputValidationError("不支持的输入类型")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话、卡片或输入不存在") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="输入资源不属于当前会话") from exc
    except InputValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except InputWorkflowConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "WORKFLOW_INPUT_BLOCKED",
                "message": "请先关闭并保存当前学习卡片，再提交新消息",
            },
        ) from exc
    except IdempotencyConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "IDEMPOTENCY_KEY_CONFLICT",
                "message": "同一客户端 ID 已用于不同输入",
            },
        ) from exc
    except InputStateConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "INPUT_ALREADY_ACCEPTED",
                "message": "该一次性控制命令已被接纳",
            },
        ) from exc

    response.status_code = 201 if result.accepted else 200
    if result.accepted and result.message_row is not None:
        row = result.message_row
        logger = getattr(request.app.state, "session_logger", None)
        if logger is not None:
            logger.log_message(
                session_id=session_id,
                message_id=row["id"],
                role=row["role"],
                action_id=row["action_id"],
                action=row["action"],
                in_reply_to_action_id=row["in_reply_to_action_id"],
                content=row["content"],
            )
    return input_response(result)
