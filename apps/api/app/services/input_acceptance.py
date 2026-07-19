from app.services.card_dismissal_acceptance import CardDismissalAcceptanceMixin
from app.services.checkpoint_acceptance import CheckpointAcceptanceMixin
from app.services.input_acceptance_base import InputAcceptanceBase
from app.services.input_acceptance_models import (
    CARD_DISMISSED_CONTINUE,
    CHECKPOINT_ANSWER,
    STUDENT_MESSAGE,
    AcceptedSessionInput,
    IdempotencyConflictError,
    InputStateConflictError,
    InputValidationError,
    InputWorkflowConflictError,
    StartedSession,
)
from app.services.session_start_acceptance import SessionStartAcceptanceMixin
from app.services.student_message_acceptance import StudentMessageAcceptanceMixin

__all__ = [
    "CARD_DISMISSED_CONTINUE",
    "CHECKPOINT_ANSWER",
    "STUDENT_MESSAGE",
    "AcceptedSessionInput",
    "IdempotencyConflictError",
    "InputAcceptanceService",
    "InputStateConflictError",
    "InputValidationError",
    "InputWorkflowConflictError",
    "StartedSession",
]


class InputAcceptanceService(
    SessionStartAcceptanceMixin,
    StudentMessageAcceptanceMixin,
    CardDismissalAcceptanceMixin,
    CheckpointAcceptanceMixin,
    InputAcceptanceBase,
):
    """Accept each input and its business mutation in one SQLite transaction."""
