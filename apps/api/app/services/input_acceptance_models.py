from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

STUDENT_MESSAGE = "STUDENT_MESSAGE"
CHECKPOINT_ANSWER = "CHECKPOINT_ANSWER"
CARD_DISMISSED_CONTINUE = "CARD_DISMISSED_CONTINUE"


class IdempotencyConflictError(Exception):
    """The same client key was reused for a different durable input."""


class InputStateConflictError(Exception):
    """A one-shot workflow input was already accepted in another form."""


class InputValidationError(Exception):
    """The submitted input does not satisfy the current workflow contract."""


class InputWorkflowConflictError(Exception):
    """The input is valid in isolation but blocked by current session state."""


@dataclass(frozen=True)
class AcceptedSessionInput:
    input_row: sqlite3.Row
    accepted: bool
    result: dict
    message_row: sqlite3.Row | None = None
    card_row: sqlite3.Row | None = None
    checkpoint_row: sqlite3.Row | None = None


@dataclass(frozen=True)
class StartedSession:
    session_row: sqlite3.Row
    input_row: sqlite3.Row
    message_row: sqlite3.Row
    accepted: bool


def canonical_json(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_json(value: str | None) -> dict:
    if not value:
        return {}
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}
