import { z } from "zod";
import type {
  AnsweredCheckpoint,
  CardFolder,
  Checkpoint,
  CheckpointAnswerResult,
  DetectedProblemRegion,
  ExamPaper,
  KnowledgeCardContent,
  MistakeSet,
  ModelProfile,
  ModelProfileTestResult,
  ProblemCardContent,
  ProblemImageAnalysisResult,
  ProblemImageDetectionResult,
  RestoredSession,
  SessionHistoryItem,
  SessionInputAcceptance,
  SessionInterruptResult,
  SessionRun,
  SessionRunStatus,
  SessionStartResult,
  SpeechStreamEvent,
  SpeechTranscription,
  SplitTextProblem,
  SseEvent,
  StudyCard
} from "./types";

const nullableString = z.string().nullable();
const optionalNullableString = nullableString.optional();
const nonnegativeInteger = z.number().int().nonnegative();
const reasoningEffortSchema = z.enum(["none", "low", "high"]);

export class ApiContractError extends Error {
  readonly contract: string;
  readonly issues: string[];

  constructor(contract: string, issues: string[], options?: ErrorOptions) {
    super(`${contract} 响应格式无效：${issues.join("；")}`, options);
    this.name = "ApiContractError";
    this.contract = contract;
    this.issues = issues;
  }
}

function issueText(issue: z.core.$ZodIssue): string {
  const path = issue.path.length ? issue.path.join(".") : "<root>";
  return `${path}: ${issue.message}`;
}

export function parseContract<T>(
  schema: z.ZodType<T>,
  value: unknown,
  contract: string
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiContractError(contract, result.error.issues.map(issueText));
  }
  return result.data;
}

export function parseJsonContract<T>(
  schema: z.ZodType<T>,
  text: string,
  contract: string
): T {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiContractError(contract, ["<root>: 不是合法 JSON"], { cause });
  }
  return parseContract(schema, value, contract);
}

export async function responseContract<T>(
  response: Response,
  schema: z.ZodType<T>,
  contract: string
): Promise<T> {
  return parseJsonContract(schema, await response.text(), contract);
}

export const checkpointSchema: z.ZodType<Checkpoint> = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  unknown_option: z.object({ id: z.string(), text: z.string() }),
  tested_point: z.string(),
  difficulty: z.enum(["easy", "medium"])
});

const answeredCheckpointSchema: z.ZodType<AnsweredCheckpoint> = z.object({
  checkpoint: checkpointSchema,
  selected_option_id: z.string(),
  is_correct: z.boolean()
});

const knowledgeCardContentSchema: z.ZodType<KnowledgeCardContent> = z.object({
  type: z.literal("knowledge_card"),
  title: z.string(),
  knowledge_point: z.string(),
  core_idea: z.string(),
  derivation_steps: z.array(z.object({ title: z.string(), content: z.string() })),
  when_to_use: z.array(z.string()),
  common_mistakes: z.array(z.string()),
  connection_to_problem: z.string()
});

const problemCardContentSchema: z.ZodType<ProblemCardContent> = z.object({
  type: z.literal("problem_card"),
  title: z.string(),
  problem_summary: z.string(),
  solution_overview: z.string(),
  solution_steps: z.array(z.object({
    step: z.number(),
    title: z.string(),
    reasoning: z.string(),
    result: z.string()
  })),
  pitfalls: z.array(z.string()),
  how_to_think: z.array(z.string()),
  final_answer: z.string()
});

export const studyCardSchema: z.ZodType<StudyCard> = z.object({
  id: z.string(),
  session_id: z.string(),
  card_type: z.enum(["knowledge_card", "problem_card"]),
  source_action_id: z.string(),
  source_message_id: z.string(),
  content: z.union([knowledgeCardContentSchema, problemCardContentSchema]),
  folder_id: optionalNullableString,
  created_at: z.string(),
  saved_at: optionalNullableString,
  deferred_at: optionalNullableString
});

export const cardFolderSchema: z.ZodType<CardFolder> = z.object({
  id: z.string(),
  name: z.string(),
  parent_id: optionalNullableString,
  is_system: z.boolean(),
  default_card_type: z.enum(["knowledge_card", "problem_card"]).nullable().optional(),
  managed_kind: z.enum(["paper_archive_root", "paper_archive"]).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string()
});

export const modelProfileSchema: z.ZodType<ModelProfile> = z.object({
  id: z.string(),
  display_name: z.string(),
  provider: z.enum(["openai", "openai_compatible", "anthropic", "local_demo"]),
  base_url: z.string(),
  base_url_host: z.string(),
  model: z.string(),
  tags: z.array(z.string()),
  status: z.string(),
  key_state: z.literal("saved"),
  masked_api_key: z.string(),
  timeout_ms: z.number(),
  temperature: z.number(),
  max_output_tokens: z.number(),
  is_multimodal: z.boolean(),
  reasoning_effort: reasoningEffortSchema,
  reasoning_effort_options: z.array(reasoningEffortSchema),
  reasoning_control: z.string(),
  reasoning_control_description: z.string(),
  last_test_status: optionalNullableString,
  last_test_latency_ms: z.number().nullable().optional()
});

export const sessionStartResultSchema: z.ZodType<SessionStartResult> = z.object({
  status: z.enum(["accepted", "duplicate"]),
  session_id: z.string(),
  state_hint: z.string(),
  context_status: z.enum(["need_problem", "need_thought", "ready"]),
  model_profile_id: z.string(),
  problem_text: z.string(),
  student_initial_thought: z.string(),
  message_id: z.string(),
  action_id: z.string()
});

export const sessionHistoryItemSchema: z.ZodType<SessionHistoryItem> = z.object({
  session_id: z.string(),
  restored_from: optionalNullableString,
  paper_id: optionalNullableString,
  paper_name: optionalNullableString,
  title: z.string(),
  grade_band: z.enum(["junior", "senior"]),
  model_profile_id: z.string(),
  model_display_name: z.string(),
  message_count: nonnegativeInteger,
  checkpoint_count: nonnegativeInteger,
  state_hint: z.string(),
  context_status: z.enum(["need_problem", "need_thought", "ready"]),
  created_at: z.string(),
  updated_at: z.string()
});

export const restoredSessionSchema: z.ZodType<RestoredSession> = z.object({
  session_id: z.string(),
  restored_from: optionalNullableString,
  paper_id: optionalNullableString,
  paper_name: optionalNullableString,
  state_hint: z.string(),
  context_status: z.enum(["need_problem", "need_thought", "ready"]),
  breakpoint_description: optionalNullableString,
  model_profile_id: z.string(),
  grade_band: z.enum(["junior", "senior"]),
  problem_text: z.string(),
  student_initial_thought: z.string(),
  problem_image_data_url: optionalNullableString,
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(["student", "assistant"]),
    text: z.string(),
    action_id: optionalNullableString,
    action: z.string(),
    client_message_id: optionalNullableString,
    image_data_url: optionalNullableString,
    checkpoint_result: answeredCheckpointSchema.nullable().optional()
  })),
  pending_checkpoint: checkpointSchema.nullable().optional(),
  pending_card: studyCardSchema.nullable().optional(),
  pending_cards: z.array(studyCardSchema).optional()
});

export const sessionInputAcceptanceSchema: z.ZodType<SessionInputAcceptance> = z.object({
  input_id: z.string(),
  kind: z.enum(["STUDENT_MESSAGE", "CARD_DISMISSED_CONTINUE"]),
  status: z.enum(["accepted", "duplicate"]),
  idempotency_key: z.string(),
  created_at: z.string(),
  message_id: optionalNullableString,
  action_id: optionalNullableString,
  in_reply_to_action_id: optionalNullableString,
  card_id: optionalNullableString,
  card_saved_at: optionalNullableString,
  folder_id: optionalNullableString,
  card_discarded: z.boolean().optional(),
  deferred_card_id: optionalNullableString,
  card_deferred_at: optionalNullableString
});

const sessionRunSchema: z.ZodType<SessionRun> = z.object({
  run_id: z.string(),
  client_run_id: optionalNullableString,
  session_id: z.string(),
  attempt: nonnegativeInteger,
  status: z.enum(["queued", "running", "completed", "failed", "interrupted"]),
  queued_at: z.string(),
  started_at: optionalNullableString,
  finished_at: optionalNullableString,
  updated_at: z.string(),
  last_committed_action_index: z.number().int().min(-1),
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    type: z.string().optional(),
    retryable: z.boolean().optional()
  }).nullable().optional()
});

export const sessionRunStatusSchema: z.ZodType<SessionRunStatus> = z.object({
  active: z.boolean(),
  running: z.boolean(),
  run: sessionRunSchema.nullable().optional()
});

export const checkpointAnswerResultSchema: z.ZodType<CheckpointAnswerResult> = z.object({
  input_id: z.string(),
  status: z.enum(["accepted", "duplicate"]),
  is_correct: z.boolean(),
  elapsed_ms: z.number().nonnegative(),
  event: z.enum(["CHECKPOINT_CORRECT", "CHECKPOINT_WRONG", "CHECKPOINT_UNKNOWN"]),
  next_state_hint: z.string(),
  student_message: z.string(),
  action_id: z.string()
});

export const sessionInterruptResultSchema: z.ZodType<SessionInterruptResult> = z.object({
  interrupted: z.boolean(),
  active: z.boolean(),
  run_ids: z.array(z.string())
});

export const examPaperSchema: z.ZodType<ExamPaper> = z.object({
  id: z.string(),
  name: z.string(),
  card_folder_id: z.string(),
  session_count: nonnegativeInteger,
  created_at: z.string(),
  updated_at: z.string()
});

export const mistakeSetSchema: z.ZodType<MistakeSet> = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(z.object({
    id: z.string(),
    source_session_id: optionalNullableString,
    source_paper_name: optionalNullableString,
    title: z.string(),
    problem_text: z.string(),
    problem_image_data_url: optionalNullableString,
    problem_card: problemCardContentSchema.nullable().optional(),
    position: nonnegativeInteger,
    created_at: z.string()
  })),
  created_at: z.string(),
  updated_at: z.string()
});

const detectedProblemRegionSchema: z.ZodType<DetectedProblemRegion> = z.object({
  id: z.string(),
  label: z.string(),
  bbox: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1)
  })
});

const splitTextProblemSchema: z.ZodType<SplitTextProblem> = z.object({
  problem_text: z.string(),
  student_initial_thought: z.string()
});

export const problemImageDetectionResultSchema: z.ZodType<ProblemImageDetectionResult> = z.object({
  problems: z.array(detectedProblemRegionSchema),
  image_width: z.number().positive(),
  image_height: z.number().positive()
});

export const problemImageAnalysisResultSchema: z.ZodType<ProblemImageAnalysisResult> = z.object({
  problem_text: z.string(),
  student_work_summary: z.string(),
  answer_text: z.string(),
  correctness: z.enum(["correct", "incorrect", "unknown", "not_present"]),
  mistake_summary: z.string(),
  needs_diagram: z.boolean(),
  diagram_image_data_url: optionalNullableString,
  diagram_note: optionalNullableString
});

export const modelProfileTestResultSchema: z.ZodType<ModelProfileTestResult> = z.object({
  ok: z.boolean(),
  latency_ms: z.number().nullable(),
  message: z.string(),
  reasoning_effort_options: z.array(reasoningEffortSchema),
  reasoning_effort_results: z.array(z.object({
    effort: reasoningEffortSchema,
    ok: z.boolean(),
    latency_ms: z.number().nullable(),
    message: z.string()
  })),
  multimodal_ok: z.boolean().nullable().optional(),
  multimodal_latency_ms: z.number().nullable().optional(),
  multimodal_message: optionalNullableString
});

const speechTranscriptionObjectSchema = z.object({
  text: z.string(),
  duration_seconds: z.number().nonnegative(),
  language: nullableString,
  emotion: nullableString,
  event: nullableString
});
export const speechTranscriptionSchema: z.ZodType<SpeechTranscription> =
  speechTranscriptionObjectSchema;

export const speechStreamEventSchema: z.ZodType<SpeechStreamEvent> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    sample_rate: z.number().positive(),
    partial_interval_ms: z.number().positive(),
    commit_silence_ms: z.number().positive(),
    stream_segment_seconds: z.number().positive()
  }),
  speechTranscriptionObjectSchema.extend({ type: z.enum(["partial", "final"]) }),
  z.object({ type: z.literal("empty"), message: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") })
]);

export const apiContracts = {
  cards: z.object({ cards: z.array(studyCardSchema) }),
  cardFolders: z.object({ folders: z.array(cardFolderSchema) }),
  profiles: z.object({ profiles: z.array(modelProfileSchema) }),
  sessionStarts: z.object({ sessions: z.array(sessionStartResultSchema) }),
  sessionHistory: z.object({ sessions: z.array(sessionHistoryItemSchema) }),
  examPapers: z.object({ papers: z.array(examPaperSchema) }),
  mistakeSets: z.object({ mistake_sets: z.array(mistakeSetSchema) }),
  splitTextProblems: z.object({ problems: z.array(splitTextProblemSchema) }),
  deletedProfileIds: z.object({ deleted_profile_ids: z.array(z.string()) })
};

const recordSchema = z.record(z.string(), z.unknown());
const sseDataSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  run_started: z.object({
    run_id: z.string(),
    attempt: nonnegativeInteger,
    status: z.literal("running")
  }).passthrough(),
  decision: z.object({
    state_hint: z.string().optional(),
    action: z.string().optional(),
    action_id: z.string().optional(),
    wait_for_student: z.boolean().optional(),
    message: z.string().optional(),
    breakpoint: z.string().optional(),
    confidence: z.number().optional(),
    action_index: nonnegativeInteger.optional()
  }).passthrough(),
  message_delta: z.object({
    text: z.string(),
    action_index: nonnegativeInteger.optional()
  }).passthrough(),
  message_reset: z.object({ action_index: nonnegativeInteger.optional() }).passthrough(),
  progress: z.object({
    stage: z.string(),
    label: z.string(),
    action_index: nonnegativeInteger.optional(),
    elapsed_ms: z.number().nonnegative().optional()
  }).passthrough(),
  checkpoint_ready: checkpointSchema.and(recordSchema),
  card_ready: studyCardSchema.and(recordSchema),
  message_done: z.object({
    ok: z.boolean(),
    action_index: nonnegativeInteger.optional(),
    wait_for_student: z.boolean().optional(),
    will_continue: z.boolean().optional(),
    awaiting_card_dismissal: z.boolean().optional(),
    continue_after_card: z.boolean().optional()
  }).passthrough(),
  stream_complete: z.object({
    run_id: z.string(),
    status: z.literal("completed"),
    last_committed_action_index: nonnegativeInteger
  }).passthrough(),
  run_interrupted: z.object({
    run_id: z.string(),
    status: z.literal("interrupted")
  }).passthrough(),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    retryable: z.boolean().optional(),
    action_index: nonnegativeInteger.optional()
  }).passthrough()
};

export function parseSseEvent(event: string, dataText: string, id?: string): SseEvent {
  const rawData = parseJsonContract(z.unknown(), dataText, `SSE ${event}`);
  const data = parseContract(sseDataSchemas[event] ?? recordSchema, rawData, `SSE ${event}`);
  return { event, data, ...(id ? { id } : {}) } as SseEvent;
}

export function parseSpeechStreamEvent(raw: string): SpeechStreamEvent {
  return parseJsonContract(speechStreamEventSchema, raw, "语音流事件");
}
