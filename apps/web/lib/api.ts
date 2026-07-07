export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type ModelProfile = {
  id: string;
  display_name: string;
  provider: "openai" | "openai_compatible" | "local_demo";
  base_url_host: string;
  model: string;
  tags: string[];
  status: string;
  key_state: "saved";
  masked_api_key: string;
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
  | { event: "decision"; data: Record<string, unknown> }
  | { event: "message_delta"; data: { text: string } }
  | { event: "checkpoint_ready"; data: Checkpoint }
  | { event: "message_done"; data: { ok: boolean } }
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
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function testModelProfile(input: {
  provider: "openai" | "openai_compatible" | "local_demo";
  base_url: string;
  api_key: string;
  model: string;
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ ok: boolean; latency_ms: number | null; message: string }>;
}

export async function createSession(input: {
  grade_band: "junior" | "senior";
  subject: "math";
  model_profile_id: string;
  problem_text: string;
  student_initial_thought: string;
}) {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ session_id: string; phase: string; model_profile_id: string }>;
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
