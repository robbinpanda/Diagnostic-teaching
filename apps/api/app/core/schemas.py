from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


Provider = Literal["openai", "openai_compatible", "local_demo"]


class ModelProfileCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    provider: Provider = "openai_compatible"
    base_url: HttpUrl
    api_key: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=120)
    tags: list[str] = []
    timeout_ms: int = Field(default=30000, ge=1000, le=120000)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_output_tokens: int = Field(default=1200, ge=100, le=4000)


class ModelProfileTestRequest(BaseModel):
    provider: Provider = "openai_compatible"
    base_url: HttpUrl
    api_key: str = Field(min_length=1)
    model: str = Field(min_length=1)
    timeout_ms: int = Field(default=15000, ge=1000, le=60000)


class ModelProfilePublic(BaseModel):
    id: str
    display_name: str
    provider: Provider
    base_url_host: str
    model: str
    tags: list[str]
    status: str
    key_state: Literal["saved"]
    masked_api_key: str
    last_test_status: str | None = None
    last_test_latency_ms: int | None = None


class ModelProfileListResponse(BaseModel):
    profiles: list[ModelProfilePublic]
    require_user_selection: bool = True


class ModelProfileCreateResponse(BaseModel):
    id: str
    display_name: str
    provider: Provider
    status: str
    masked_api_key: str


class ModelProfileTestResponse(BaseModel):
    ok: bool
    latency_ms: int | None = None
    message: str


class SessionCreate(BaseModel):
    grade_band: Literal["junior", "senior"]
    subject: Literal["math"] = "math"
    model_profile_id: str
    problem_text: str = Field(min_length=1)
    student_initial_thought: str = ""


class SessionCreateResponse(BaseModel):
    session_id: str
    phase: str
    model_profile_id: str


class ChatStreamRequest(BaseModel):
    session_id: str
    message: str | None = None
    # 当本轮 student 消息其实是检查点答题时附带，用于落库 metadata 与 AI 上下文标记，role 仍记为 student
    checkpoint_answer: dict[str, Any] | None = None


class CheckpointAnswerRequest(BaseModel):
    session_id: str
    selected_option_id: str
    elapsed_ms: int = Field(ge=0)


class CheckpointAnswerResponse(BaseModel):
    is_correct: bool
    event: Literal["CHECKPOINT_CORRECT", "CHECKPOINT_WRONG", "CHECKPOINT_UNKNOWN"]
    next_phase: str


class TutorCheckpointOption(BaseModel):
    id: str
    text: str
    is_correct: bool
    misconception: str | None = None


class TutorCheckpoint(BaseModel):
    type: Literal["checkpoint_mc"] = "checkpoint_mc"
    question: str
    options: list[TutorCheckpointOption]
    unknown_option: dict[str, str] = {"id": "UNKNOWN", "text": "我不知道"}
    tested_point: str
    difficulty: Literal["easy", "medium"] = "easy"


class TutorTurn(BaseModel):
    phase: str = "diagnosing"
    action: str = "ASK_OPEN_QUESTION"
    message: str
    breakpoint_description: str | None = None
    breakpoint_confidence: float | None = None
    checkpoint: TutorCheckpoint | None = None
    debug: dict[str, Any] = {}
