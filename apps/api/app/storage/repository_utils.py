from __future__ import annotations

import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def initial_context_status(problem_text: str, student_initial_thought: str) -> str:
    if not problem_text.strip():
        return "need_problem"
    if not student_initial_thought.strip():
        return "need_thought"
    return "ready"


def host_from_url(value: str) -> str:
    return urlparse(value).netloc or value
