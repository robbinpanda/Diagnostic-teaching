from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, HttpUrl

Provider = Literal["openai", "openai_compatible", "anthropic", "local_demo"]
ContextStatus = Literal["need_problem", "need_thought", "ready"]
ReasoningEffort = Literal["none", "low", "high"]


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
    reasoning_effort: ReasoningEffort = "low"
    reasoning_effort_options: list[ReasoningEffort] | None = Field(
        default=None,
        min_length=1,
    )


class ModelProfileBatchItem(BaseModel):
    model: str = Field(min_length=1, max_length=120)
    is_multimodal: bool = False
    reasoning_effort_options: list[ReasoningEffort] | None = Field(
        default=None,
        min_length=1,
    )


class ModelProfileBatchCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    provider: Provider = "openai_compatible"
    base_url: HttpUrl
    api_key: str = Field(min_length=1)
    models: list[ModelProfileBatchItem] = Field(min_length=1, max_length=20)
    tags: list[str] = []
    timeout_ms: int = Field(default=30000, ge=1000, le=120000)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_output_tokens: int = Field(default=8000, ge=100, le=64000)
    reasoning_effort: ReasoningEffort = "low"


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
    reasoning_effort: ReasoningEffort | None = None
    reasoning_effort_options: list[ReasoningEffort] | None = Field(
        default=None,
        min_length=1,
    )


class ModelProfileReasoningUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reasoning_effort: ReasoningEffort


class ModelProfileTestRequest(BaseModel):
    profile_id: str | None = None
    provider: Provider = "openai_compatible"
    base_url: HttpUrl
    api_key: str | None = Field(default=None, min_length=1)
    model: str = Field(min_length=1)
    timeout_ms: int = Field(default=15000, ge=1000, le=60000)
    max_output_tokens: int = Field(default=8000, ge=100, le=64000)
    probe_multimodal: bool = False
    require_multimodal: bool = False


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
    managed: bool = False
    reasoning_effort: ReasoningEffort = "low"
    reasoning_effort_options: list[ReasoningEffort] = Field(
        default_factory=lambda: ["none", "low", "high"]
    )
    reasoning_control: str = "none"
    reasoning_control_description: str = ""
    last_test_status: str | None = None
    last_test_latency_ms: int | None = None


class ModelProfileListResponse(BaseModel):
    profiles: list[ModelProfilePublic]
    require_user_selection: bool = True


class ModelProfileBatchCreateResponse(BaseModel):
    profiles: list[ModelProfilePublic]


class ModelProfileBatchDelete(BaseModel):
    profile_ids: list[str] = Field(min_length=1, max_length=20)


class ModelProfileBatchDeleteResponse(BaseModel):
    deleted_profile_ids: list[str]


class ModelProfileCreateResponse(BaseModel):
    id: str
    display_name: str
    provider: Provider
    status: str
    masked_api_key: str


class ModelProfileReasoningProbeResult(BaseModel):
    effort: ReasoningEffort
    ok: bool
    latency_ms: int | None = None
    message: str


class ModelProfileTestResponse(BaseModel):
    ok: bool
    latency_ms: int | None = None
    message: str
    reasoning_effort_options: list[ReasoningEffort] = Field(default_factory=list)
    reasoning_effort_results: list[ModelProfileReasoningProbeResult] = Field(
        default_factory=list
    )
    multimodal_ok: bool | None = None
    multimodal_latency_ms: int | None = None
    multimodal_message: str | None = None


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


class ProblemBoundingBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class DetectedProblemRegion(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=80)
    bbox: ProblemBoundingBox


class ProblemImageDetectResponse(BaseModel):
    problems: list[DetectedProblemRegion] = Field(min_length=1, max_length=20)
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)


class ProblemTextAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_profile_id: str
    text: str = Field(min_length=1, max_length=20_000)


class SplitTextProblem(BaseModel):
    problem_text: str = Field(min_length=1, max_length=20_000)
    student_initial_thought: str = Field(default="", max_length=20_000)


class ProblemTextAnalyzeResponse(BaseModel):
    problems: list[SplitTextProblem] = Field(min_length=1, max_length=20)


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade_band: Literal["junior", "senior"]
    subject: Literal["math"] = "math"
    model_profile_id: str
    problem_text: str = Field(default="", max_length=20_000)
    student_initial_thought: str = Field(default="", max_length=20_000)
    problem_image_data_url: str | None = Field(default=None, max_length=17_000_000)


class SessionCreateResponse(BaseModel):
    session_id: str
    state_hint: str
    context_status: ContextStatus
    model_profile_id: str


class SessionStartRequest(SessionCreate):
    """Create a formal session and durably admit its first student message."""

    session_id: str = Field(pattern=r"^sess_[0-9a-f]{32}$")
    client_message_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=20_000)

class SessionStartResponse(BaseModel):
    status: Literal["accepted", "duplicate"]
    session_id: str
    state_hint: str
    context_status: ContextStatus
    model_profile_id: str
    problem_text: str
    student_initial_thought: str
    message_id: str
    action_id: str


class SessionBatchStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessions: list[SessionStartRequest] = Field(min_length=1, max_length=20)


class SessionBatchStartResponse(BaseModel):
    sessions: list[SessionStartResponse]


class ImageSessionStartItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(pattern=r"^sess_[0-9a-f]{32}$")
    client_message_id: str = Field(min_length=1, max_length=128)
    bbox: ProblemBoundingBox


class ImageSessionBatchStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade_band: Literal["junior", "senior"]
    subject: Literal["math"] = "math"
    model_profile_id: str
    source_image_data_url: str = Field(min_length=1, max_length=17_000_000)
    items: list[ImageSessionStartItem] = Field(min_length=1, max_length=20)


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
    context_status: ContextStatus
    created_at: str
    updated_at: str


class SessionHistoryListResponse(BaseModel):
    sessions: list[SessionHistoryItem]


class SessionEventPublic(BaseModel):
    schema_version: Literal[1] = 1
    id: str
    session_id: str
    seq: int = Field(ge=1)
    type: str
    data: dict[str, Any]
    created_at: str


class SessionEventHistoryResponse(BaseModel):
    schema_version: Literal[1] = 1
    session_id: str
    after_seq: int = Field(ge=0)
    next_after_seq: int = Field(ge=0)
    latest_seq: int = Field(ge=0)
    has_more: bool
    events: list[SessionEventPublic]


class SessionRestoreRequest(BaseModel):
    session_id: str
    model_profile_id: str


class SessionRestoredCheckpointResult(BaseModel):
    checkpoint: dict[str, Any]
    selected_option_id: str
    is_correct: bool


class SessionRestoredMessage(BaseModel):
    id: str
    role: Literal["student", "assistant"]
    text: str
    action_id: str | None = None
    action: str
    client_message_id: str | None = None
    checkpoint_result: SessionRestoredCheckpointResult | None = None


class SessionRestoreResponse(BaseModel):
    session_id: str
    restored_from: str | None = None
    state_hint: str
    context_status: ContextStatus
    breakpoint_description: str | None = None
    model_profile_id: str
    grade_band: Literal["junior", "senior"]
    problem_text: str
    student_initial_thought: str
    problem_image_data_url: str | None = None
    messages: list[SessionRestoredMessage]
    pending_checkpoint: dict[str, Any] | None = None
    pending_card: dict[str, Any] | None = None


RunStatus = Literal["queued", "running", "completed", "failed", "interrupted"]


class SessionRunPublic(BaseModel):
    run_id: str
    session_id: str
    attempt: int
    status: RunStatus
    queued_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str
    last_committed_action_index: int = -1
    error: dict[str, Any] | None = None


class SessionRunStatusResponse(BaseModel):
    active: bool
    running: bool
    run: SessionRunPublic | None = None


class SessionInterruptResponse(BaseModel):
    interrupted: bool
    active: bool
    run_ids: list[str] = Field(default_factory=list)


class ChatStreamRequest(BaseModel):
    session_id: str
    message: str | None = None
    client_message_id: str | None = Field(default=None, min_length=1, max_length=128)
    # 仅兼容旧前端；新流程由 checkpoint answer 接口原子写入 CHECKPOINT_RESPONSE。
    checkpoint_answer: dict[str, Any] | None = None


class StudentMessageInputRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["STUDENT_MESSAGE"]
    client_message_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=20_000)


class CardDismissedContinueInputRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["CARD_DISMISSED_CONTINUE"]
    client_command_id: str = Field(min_length=1, max_length=128)
    card_id: str = Field(min_length=1, max_length=128)
    folder_id: str | None = Field(default=None, min_length=1, max_length=128)
    content: TutorKnowledgeCard | None = None
    save_to_library: bool = True


SessionInputAcceptRequest = Annotated[
    StudentMessageInputRequest | CardDismissedContinueInputRequest,
    Field(discriminator="kind"),
]


class SessionInputAcceptResponse(BaseModel):
    input_id: str
    kind: Literal["STUDENT_MESSAGE", "CARD_DISMISSED_CONTINUE"]
    status: Literal["accepted", "duplicate"]
    idempotency_key: str
    created_at: str
    message_id: str | None = None
    action_id: str | None = None
    in_reply_to_action_id: str | None = None
    card_id: str | None = None
    card_saved_at: str | None = None
    folder_id: str | None = None
    card_discarded: bool = False


class CheckpointAnswerRequest(BaseModel):
    session_id: str
    selected_option_id: str
    elapsed_ms: int = Field(ge=0)


class CheckpointAnswerResponse(BaseModel):
    input_id: str
    status: Literal["accepted", "duplicate"]
    is_correct: bool
    elapsed_ms: int
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


class StudyCardUpdateRequest(BaseModel):
    content: TutorKnowledgeCard


class StudyCardPublic(BaseModel):
    id: str
    session_id: str
    card_type: Literal["knowledge_card", "problem_card"]
    source_action_id: str
    source_message_id: str
    content: TutorCardContent
    folder_id: str | None = None
    created_at: str
    saved_at: str | None = None


class StudyCardListResponse(BaseModel):
    cards: list[StudyCardPublic]


class StudyCardSaveRequest(BaseModel):
    session_id: str
    folder_id: str | None = Field(default=None, min_length=1, max_length=128)


class StudyCardPlacementRequest(BaseModel):
    folder_id: str = Field(min_length=1, max_length=128)


class CardFolderPublic(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    is_system: bool = False
    default_card_type: Literal["knowledge_card", "problem_card"] | None = None
    created_at: str
    updated_at: str


class CardFolderListResponse(BaseModel):
    folders: list[CardFolderPublic]


class CardFolderCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    parent_id: str | None = Field(default=None, min_length=1, max_length=128)


class CardFolderUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    parent_id: str | None = Field(default=None, min_length=1, max_length=128)


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
    context_status: ContextStatus = "ready"
    problem_summary: str | None = Field(default=None, max_length=20_000)
    student_thought_summary: str | None = Field(default=None, max_length=20_000)
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
