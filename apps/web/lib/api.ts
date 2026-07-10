export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8010";

export type ModelProfile = {
  id: string;
  display_name: string;
  provider: "openai" | "openai_compatible" | "local_demo";
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
  last_test_status?: string | null;
  last_test_latency_ms?: number | null;
};

export type Checkpoint = {
  id: string;
  question: string;
  options: Array<{ id: string; text: string }>;
  unknown_option: { id: string; text: string };
  tested_point: string;
  difficulty: "easy" | "medium";
};

export type SseEvent =
  | { event: "decision"; data: { state_hint?: string; action?: string; wait_for_student?: boolean; message?: string; breakpoint?: string; confidence?: number; action_index?: number } }
  | { event: "message_delta"; data: { text: string; action_index?: number } }
  | { event: "checkpoint_ready"; data: Checkpoint }
  | { event: "message_done"; data: { ok: boolean; action_index?: number; wait_for_student?: boolean; will_continue?: boolean } }
  | { event: "error"; data: { message: string } }
  | { event: string; data: Record<string, unknown> };

export async function fetchProfiles(): Promise<ModelProfile[]> {
  const response = await fetch(`${API_BASE}/api/model-profiles`, { cache: "no-store" });
  if (!response.ok) throw new Error("模型列表加载失败");
  const payload = await response.json();
  return payload.profiles;
}

export async function createModelProfile(input: {
  display_name: string;
  provider: "openai" | "openai_compatible" | "local_demo";
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
    provider: "openai" | "openai_compatible" | "local_demo";
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
  provider: "openai" | "openai_compatible" | "local_demo";
  base_url: string;
  api_key?: string;
  model: string;
  max_output_tokens: number;
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ ok: boolean; latency_ms: number | null; message: string }>;
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
  return response.json();
}

export async function streamChat(
  input: {
    session_id: string;
    message?: string;
    checkpoint_answer?: {
      checkpoint_id: string;
      selected_option_id: string;
      is_correct: boolean;
      event: string;
    } | null;
  },
  onEvent: (event: SseEvent) => void
) {
  const response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok || !response.body) throw new Error("答疑流启动失败");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const eventLine = part.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.replace("event:", "").trim();
      const data = JSON.parse(dataLine.replace("data:", "").trim());
      onEvent({ event, data } as SseEvent);
    }
  }
}
