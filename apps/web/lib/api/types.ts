export type ModelProfile = {
  id: string;
  display_name: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  base_url_host: string;
  model: string;
  tags: string[];
  status: string;
  key_state: "saved";
  masked_api_key: string;
  timeout_ms: number;
  temperature: number;
  max_output_tokens: number;
  is_multimodal: boolean;
  managed: boolean;
  reasoning_effort: ReasoningEffort;
  reasoning_effort_options: ReasoningEffort[];
  reasoning_control: string;
  reasoning_control_description: string;
  last_test_status?: string | null;
  last_test_latency_ms?: number | null;
};

export type ReasoningEffort = "none" | "low" | "high";

export type Checkpoint = {
  id: string;
  question: string;
  options: Array<{ id: string; text: string }>;
  unknown_option: { id: string; text: string };
  tested_point: string;
  difficulty: "easy" | "medium";
};

export type ProblemBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectedProblemRegion = {
  id: string;
  label: string;
  bbox: ProblemBoundingBox;
};

export type SplitTextProblem = {
  problem_text: string;
  student_initial_thought: string;
};

export type AnsweredCheckpoint = {
  checkpoint: Checkpoint;
  selected_option_id: string;
  is_correct: boolean;
};

export type KnowledgeCardContent = {
  type: "knowledge_card";
  title: string;
  knowledge_point: string;
  core_idea: string;
  derivation_steps: Array<{ title: string; content: string }>;
  when_to_use: string[];
  common_mistakes: string[];
  connection_to_problem: string;
};

export type ProblemCardContent = {
  type: "problem_card";
  title: string;
  problem_summary: string;
  solution_overview: string;
  solution_steps: Array<{ step: number; title: string; reasoning: string; result: string }>;
  pitfalls: string[];
  how_to_think: string[];
  final_answer: string;
};

export type StudyCard = {
  id: string;
  session_id: string;
  card_type: "knowledge_card" | "problem_card";
  source_action_id: string;
  source_message_id: string;
  content: KnowledgeCardContent | ProblemCardContent;
  folder_id?: string | null;
  created_at: string;
  saved_at?: string | null;
  deferred_at?: string | null;
};

export type CardFolder = {
  id: string;
  name: string;
  parent_id?: string | null;
  is_system: boolean;
  default_card_type?: "knowledge_card" | "problem_card" | null;
  created_at: string;
  updated_at: string;
};

type SseEventPayload =
  | { event: "run_started"; data: { run_id: string; attempt: number; status: "running" } }
  | { event: "decision"; data: { state_hint?: string; action?: string; action_id?: string; wait_for_student?: boolean; message?: string; breakpoint?: string; confidence?: number; action_index?: number } }
  | { event: "message_delta"; data: { text: string; action_index?: number } }
  | { event: "message_reset"; data: { action_index?: number } }
  | { event: "progress"; data: { stage: string; label: string; action_index?: number; elapsed_ms?: number } }
  | { event: "checkpoint_ready"; data: Checkpoint }
  | { event: "card_ready"; data: StudyCard }
  | { event: "message_done"; data: { ok: boolean; action_index?: number; wait_for_student?: boolean; will_continue?: boolean; awaiting_card_dismissal?: boolean; continue_after_card?: boolean } }
  | { event: "run_interrupted"; data: { run_id: string; status: "interrupted" } }
  | { event: "error"; data: { message: string } }
  | { event: string; data: Record<string, unknown> };

export type SseEvent = SseEventPayload & { id?: string };

export type SessionHistoryItem = {
  session_id: string;
  restored_from?: string | null;
  paper_id?: string | null;
  paper_name?: string | null;
  title: string;
  grade_band: "junior" | "senior";
  model_profile_id: string;
  model_display_name: string;
  message_count: number;
  checkpoint_count: number;
  state_hint: string;
  context_status: "need_problem" | "need_thought" | "ready";
  created_at: string;
  updated_at: string;
};

export type RestoredSession = {
  session_id: string;
  restored_from?: string | null;
  paper_id?: string | null;
  paper_name?: string | null;
  state_hint: string;
  context_status: "need_problem" | "need_thought" | "ready";
  breakpoint_description?: string | null;
  model_profile_id: string;
  grade_band: "junior" | "senior";
  problem_text: string;
  student_initial_thought: string;
  problem_image_data_url?: string | null;
  messages: Array<{
    id: string;
    role: "student" | "assistant";
    text: string;
    action_id?: string | null;
    action: string;
    client_message_id?: string | null;
    image_data_url?: string | null;
    checkpoint_result?: AnsweredCheckpoint | null;
  }>;
  pending_checkpoint?: Checkpoint | null;
  pending_card?: StudyCard | null;
  pending_cards?: StudyCard[];
};

export type SessionStartResult = {
  status: "accepted" | "duplicate";
  session_id: string;
  state_hint: string;
  context_status: "need_problem" | "need_thought" | "ready";
  model_profile_id: string;
  problem_text: string;
  student_initial_thought: string;
  message_id: string;
  action_id: string;
};

export type SessionStartInput = {
  session_id: string;
  client_message_id: string;
  grade_band: "junior" | "senior";
  subject: "math";
  model_profile_id: string;
  paper_id?: string | null;
  message: string;
  problem_text: string;
  student_initial_thought: string;
  problem_image_data_url?: string | null;
};

export type ExamPaper = {
  id: string;
  name: string;
  session_count: number;
  created_at: string;
  updated_at: string;
};

export type SessionInputAcceptance = {
  input_id: string;
  kind: "STUDENT_MESSAGE" | "CARD_DISMISSED_CONTINUE";
  status: "accepted" | "duplicate";
  idempotency_key: string;
  created_at: string;
  message_id?: string | null;
  action_id?: string | null;
  in_reply_to_action_id?: string | null;
  card_id?: string | null;
  card_saved_at?: string | null;
  folder_id?: string | null;
  card_discarded?: boolean;
  deferred_card_id?: string | null;
  card_deferred_at?: string | null;
};

export type SessionRun = {
  run_id: string;
  session_id: string;
  attempt: number;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  queued_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at: string;
  last_committed_action_index: number;
  error?: {
    code?: string;
    message?: string;
    type?: string;
    retryable?: boolean;
  } | null;
};

export type SessionRunStatus = {
  active: boolean;
  running: boolean;
  run?: SessionRun | null;
};
