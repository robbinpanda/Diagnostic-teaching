export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8010";

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
  last_test_status?: string | null;
  last_test_latency_ms?: number | null;
};

export function modelProfileLabel(profile: Pick<ModelProfile, "display_name" | "model"> & Partial<Pick<ModelProfile, "managed">>) {
  return profile.managed ? profile.display_name : `${profile.display_name} · ${profile.model}`;
}

export type Checkpoint = {
  id: string;
  question: string;
  options: Array<{ id: string; text: string }>;
  unknown_option: { id: string; text: string };
  tested_point: string;
  difficulty: "easy" | "medium";
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
  created_at: string;
  saved_at?: string | null;
};

type SseEventPayload =
  | { event: "run_started"; data: { run_id: string; attempt: number; status: "running" } }
  | { event: "decision"; data: { state_hint?: string; action?: string; action_id?: string; wait_for_student?: boolean; message?: string; breakpoint?: string; confidence?: number; action_index?: number } }
  | { event: "message_delta"; data: { text: string; action_index?: number } }
  | { event: "message_reset"; data: { action_index?: number } }
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
  title: string;
  grade_band: "junior" | "senior";
  model_profile_id: string;
  model_display_name: string;
  message_count: number;
  checkpoint_count: number;
  state_hint: string;
  created_at: string;
  updated_at: string;
};

export type RestoredSession = {
  session_id: string;
  restored_from?: string | null;
  state_hint: string;
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
  }>;
  pending_checkpoint?: Checkpoint | null;
  pending_card?: StudyCard | null;
};

export type SessionIntakeResult = {
  status: "needs_problem" | "needs_thought" | "ready";
  assistant_message: string;
  problem_text: string;
  student_initial_thought: string;
  session_id?: string | null;
  state_hint?: string | null;
  model_profile_id: string;
};

export async function fetchProfiles(): Promise<ModelProfile[]> {
  const response = await fetch(`${API_BASE}/api/model-profiles`, { cache: "no-store" });
  if (!response.ok) throw new Error("模型列表加载失败");
  const payload = await response.json();
  return payload.profiles;
}

export async function createModelProfile(input: {
  display_name: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  api_key: string;
  model: string;
  tags: string[];
  timeout_ms: number;
  temperature: number;
  max_output_tokens: number;
  is_multimodal: boolean;
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function updateModelProfile(
  profileId: string,
  input: {
    display_name: string;
    provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
    base_url: string;
    api_key?: string;
    model: string;
    tags: string[];
    timeout_ms: number;
    temperature: number;
    max_output_tokens: number;
    is_multimodal: boolean;
  }
) {
  const response = await fetch(`${API_BASE}/api/model-profiles/${profileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<ModelProfile>;
}

export async function testModelProfile(input: {
  profile_id?: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  api_key?: string;
  model: string;
  timeout_ms?: number;
  max_output_tokens: number;
  probe_multimodal?: boolean;
  require_multimodal?: boolean;
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{
    ok: boolean;
    latency_ms: number | null;
    message: string;
    multimodal_ok?: boolean | null;
    multimodal_latency_ms?: number | null;
    multimodal_message?: string | null;
  }>;
}

export async function analyzeProblemImage(input: {
  model_profile_id: string;
  image_base64: string;
  content_type: string;
  filename?: string;
}) {
  const response = await fetch(`${API_BASE}/api/problem-images/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{
    problem_text: string;
    student_work_summary: string;
    answer_text: string;
    correctness: "correct" | "incorrect" | "unknown" | "not_present";
    mistake_summary: string;
    needs_diagram: boolean;
    diagram_image_data_url?: string | null;
    diagram_note?: string | null;
  }>;
}

export async function deleteModelProfile(profileId: string) {
  const response = await fetch(`${API_BASE}/api/model-profiles/${profileId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function createSession(input: {
  grade_band: "junior" | "senior";
  subject: "math";
  model_profile_id: string;
  problem_text: string;
  student_initial_thought: string;
  problem_image_data_url?: string | null;
}) {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ session_id: string; state_hint: string; model_profile_id: string }>;
}

export async function intakeSession(input: {
  grade_band: "junior" | "senior";
  subject: "math";
  model_profile_id: string;
  message?: string;
  problem_text?: string;
  student_initial_thought?: string;
  problem_image_data_url?: string | null;
}): Promise<SessionIntakeResult> {
  const response = await fetch(`${API_BASE}/api/sessions/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function createModelProfiles(input: {
  display_name: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  api_key: string;
  models: Array<{ model: string; is_multimodal: boolean }>;
  tags: string[];
  timeout_ms: number;
  temperature: number;
  max_output_tokens: number;
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ profiles: ModelProfile[] }>;
}

export async function fetchSessionHistory(): Promise<SessionHistoryItem[]> {
  const response = await fetch(`${API_BASE}/api/sessions/history`, { cache: "no-store" });
  if (!response.ok) throw new Error("历史会话加载失败");
  const payload = await response.json();
  return payload.sessions;
}

export async function fetchSession(sessionId: string): Promise<RestoredSession> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function deleteSession(sessionId: string) {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function deleteAllSessions() {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function restoreSession(input: { session_id: string; model_profile_id: string }): Promise<RestoredSession> {
  const response = await fetch(`${API_BASE}/api/sessions/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function answerCheckpoint(input: {
  checkpointId: string;
  session_id: string;
  selected_option_id: string;
  elapsed_ms: number;
}) {
  const response = await fetch(`${API_BASE}/api/checkpoints/${input.checkpointId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: input.session_id,
      selected_option_id: input.selected_option_id,
      elapsed_ms: input.elapsed_ms
    })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{
    input_id: string;
    status: "accepted" | "duplicate";
    is_correct: boolean;
    elapsed_ms: number;
    event: "CHECKPOINT_CORRECT" | "CHECKPOINT_WRONG" | "CHECKPOINT_UNKNOWN";
    next_state_hint: string;
    student_message: string;
    action_id: string;
  }>;
}

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
};

export async function acceptStudentMessage(input: {
  session_id: string;
  client_message_id: string;
  message: string;
}): Promise<SessionInputAcceptance> {
  const response = await fetch(`${API_BASE}/api/sessions/${input.session_id}/inputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "STUDENT_MESSAGE",
      client_message_id: input.client_message_id,
      message: input.message
    })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function dismissKnowledgeCardAndContinue(input: {
  session_id: string;
  client_command_id: string;
  card_id: string;
}): Promise<SessionInputAcceptance> {
  const response = await fetch(`${API_BASE}/api/sessions/${input.session_id}/inputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "CARD_DISMISSED_CONTINUE",
      client_command_id: input.client_command_id,
      card_id: input.card_id
    })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function fetchCards(
  cardType?: "knowledge_card" | "problem_card"
): Promise<StudyCard[]> {
  const params = new URLSearchParams();
  if (cardType) params.set("card_type", cardType);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/api/cards${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error("学习卡片加载失败");
  const payload = await response.json();
  return payload.cards;
}

export async function saveCard(cardId: string, sessionId: string): Promise<StudyCard> {
  const response = await fetch(`${API_BASE}/api/cards/${cardId}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function deleteCard(cardId: string) {
  const response = await fetch(`${API_BASE}/api/cards/${cardId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function deleteAllCards() {
  const response = await fetch(`${API_BASE}/api/cards`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function streamChat(
  input: {
    session_id: string;
    message?: string;
    client_message_id?: string;
    checkpoint_answer?: {
      checkpoint_id: string;
      selected_option_id: string;
      is_correct: boolean;
      event: string;
    } | null;
  },
  onEvent: (event: SseEvent) => void,
  options: {
    signal?: AbortSignal;
    replayCursor?: { afterSeq?: number };
  } = {}
) {
  const body = options.replayCursor?.afterSeq === undefined
    ? input
    : { ...input, after_seq: options.replayCursor.afterSeq };
  const response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || "答疑流启动失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function emitFrame(frame: string) {
    const lines = frame.split(/\r?\n/);
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLines = lines.filter((line) => line.startsWith("data:"));
    const idLine = lines.find((line) => line.startsWith("id:"));
    if (!eventLine || dataLines.length === 0) return;
    const event = eventLine.slice("event:".length).trim();
    const dataText = dataLines.map((line) => line.slice("data:".length).trimStart()).join("\n");
    const data = JSON.parse(dataText);
    const id = idLine?.slice("id:".length).trim();
    onEvent({ event, data, ...(id ? { id } : {}) } as SseEvent);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) emitFrame(part);
  }
  buffer += decoder.decode();
  if (buffer.trim()) emitFrame(buffer);
}

export async function interruptSession(sessionId: string): Promise<{
  interrupted: boolean;
  active: boolean;
  run_ids: string[];
}> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/interrupt`, {
    method: "POST"
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
