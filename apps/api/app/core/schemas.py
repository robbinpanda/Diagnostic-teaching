from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, HttpUrl


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
    max_output_tokens: int = Field(default=8000, ge=100, le=64000)
    is_multimodal: bool = False


class ModelProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    provider: Provider | None = None
    base_url: HttpUrl | None = None
    api_key: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1, max_length=120)
    tags: list[str] | None = None
    timeout_ms: int | None = Field(default=None, ge=1000, le=120000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=100, le=64000)
    is_multimodal: bool | None = None


class ModelProfileTestRequest(BaseModel):
    profile_id: str | None = None
    provider: Provider = "openai_compatible"
    base_url: HttpUrl
    api_key: str | None = Field(default=None, min_length=1)
    model: str = Field(min_length=1)
    timeout_ms: int = Field(default=15000, ge=1000, le=60000)
    max_output_tokens: int = Field(default=8000, ge=100, le=64000)


class ModelProfilePublic(BaseModel):
    id: str
    display_name: str
    provider: Provider
    base_url: str
    base_url_host: str
    model: str
    tags: list[str]
    status: str
    key_state: Literal["saved"]
    masked_api_key: str
    timeout_ms: int
    temperature: float
    max_output_tokens: int
    is_multimodal: bool
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


class ProblemImageAnalyzeRequest(BaseModel):
    model_profile_id: str
    image_base64: str = Field(min_length=1)
    content_type: str = "image/png"
    filename: str | None = None


class ProblemImageAnalyzeResponse(BaseModel):
    problem_text: str
    student_work_summary: str = ""
    answer_text: str = ""
    correctness: Literal["correct", "incorrect", "unknown", "not_present"] = "unknown"
    mistake_summary: str = ""
    needs_diagram: bool = False
    diagram_image_data_url: str | None = None
    diagram_note: str | None = None


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade_band: Literal["junior", "senior"]
    subject: Literal["math"] = "math"
    model_profile_id: str
    problem_text: str = Field(min_length=1)
    student_initial_thought: str = ""
    problem_image_data_url: str | None = Field(default=None, max_length=17_000_000)


class SessionCreateResponse(BaseModel):
    session_id: str
    state_hint: str
    model_profile_id: str


class SessionHistoryItem(BaseModel):
    session_id: str
    restored_from: str | None = None
    title: str
    grade_band: Literal["junior", "senior"]
    model_profile_id: str
    model_display_name: str
    message_count: int
    checkpoint_count: int
    state_hint: str
    created_at: str
    updated_at: str


class SessionHistoryListResponse(BaseModel):
    sessions: list[SessionHistoryItem]


class SessionRestoreRequest(BaseModel):
    session_id: str
    model_profile_id: str


class SessionRestoredMessage(BaseModel):
    id: str
    role: Literal["student", "assistant"]
    text: str
    action_id: str | None = None
    action: str


class SessionRestoreResponse(BaseModel):
    session_id: str
    restored_from: str
    state_hint: str
    breakpoint_description: str | None = None
    model_profile_id: str
    grade_band: Literal["junior", "senior"]
    problem_text: str
    student_initial_thought: str
    problem_image_data_url: str | None = None
    messages: list[SessionRestoredMessage]
    pending_checkpoint: dict[str, Any] | None = None
    pending_card: dict[str, Any] | None = None


class ChatStreamRequest(BaseModel):
    session_id: str
    message: str | None = None
    # 仅兼容旧前端；新流程由 checkpoint answer 接口原子写入 CHECKPOINT_RESPONSE。
    checkpoint_answer: dict[str, Any] | None = None


class CheckpointAnswerRequest(BaseModel):
    session_id: str
    selected_option_id: str
    elapsed_ms: int = Field(ge=0)


class CheckpointAnswerResponse(BaseModel):
    is_correct: bool
    event: Literal["CHECKPOINT_CORRECT", "CHECKPOINT_WRONG", "CHECKPOINT_UNKNOWN"]
    next_state_hint: str
    student_message: str
    action_id: str


class TutorKnowledgeCardStep(BaseModel):
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)


class TutorKnowledgeCard(BaseModel):
    type: Literal["knowledge_card"] = "knowledge_card"
    title: str = Field(min_length=1)
    knowledge_point: str = Field(min_length=1)
    core_idea: str = Field(min_length=1)
    derivation_steps: list[TutorKnowledgeCardStep] = Field(min_length=1)
    when_to_use: list[str] = Field(min_length=1)
    common_mistakes: list[str] = Field(default_factory=list)
    connection_to_problem: str = Field(min_length=1)


class TutorProblemCardStep(BaseModel):
    step: int = Field(ge=1)
    title: str = Field(min_length=1)
    reasoning: str = Field(min_length=1)
    result: str = Field(min_length=1)


class TutorProblemCard(BaseModel):
    type: Literal["problem_card"] = "problem_card"
    title: str = Field(min_length=1)
    problem_summary: str = Field(min_length=1)
    solution_overview: str = Field(min_length=1)
    solution_steps: list[TutorProblemCardStep] = Field(min_length=1)
    pitfalls: list[str] = Field(default_factory=list)
    how_to_think: list[str] = Field(min_length=1)
    final_answer: str = Field(min_length=1)


TutorCardContent = TutorKnowledgeCard | TutorProblemCard


class StudyCardPublic(BaseModel):
    id: str
    session_id: str
    card_type: Literal["knowledge_card", "problem_card"]
    source_action_id: str
    source_message_id: str
    content: TutorCardContent
    created_at: str
    saved_at: str | None = None


class StudyCardListResponse(BaseModel):
    cards: list[StudyCardPublic]


class StudyCardSaveRequest(BaseModel):
    session_id: str


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
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    state_hint: str = Field(default="diagnosing", validation_alias=AliasChoices("state_hint", "phase"))
    action: str
    message: str
    breakpoint_description: str | None = None
    breakpoint_confidence: float | None = None
    checkpoint: TutorCheckpoint | None = None
    knowledge_card: TutorKnowledgeCard | None = None
    problem_card: TutorProblemCard | None = None
    wait_for_student: bool = False
    debug: dict[str, Any] = {}

    @property
    def phase(self) -> str:
        return self.state_hint
