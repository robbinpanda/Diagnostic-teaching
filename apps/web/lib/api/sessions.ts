import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type {
  RestoredSession,
  SessionHistoryItem,
  SessionInputAcceptance,
  SessionStartInput,
  SessionStartResult
} from "./types";

export async function startSession(input: SessionStartInput): Promise<SessionStartResult> {
  const response = await fetch(`${API_BASE}/api/sessions/start`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function batchStartSessions(
  sessions: SessionStartInput[]
): Promise<{ sessions: SessionStartResult[] }> {
  const response = await fetch(`${API_BASE}/api/sessions/batch-start`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessions })
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function batchStartImageSessions(input: {
  grade_band: "junior" | "senior";
  subject: "math";
  model_profile_id: string;
  source_image_data_url: string;
  items: Array<{
    session_id: string;
    client_message_id: string;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
}): Promise<{ sessions: SessionStartResult[] }> {
  const response = await fetch(`${API_BASE}/api/sessions/image-batch-start`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function fetchSessionHistory(): Promise<SessionHistoryItem[]> {
  const response = await fetch(`${API_BASE}/api/sessions/history`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "历史会话加载失败");
  const payload = await response.json();
  return payload.sessions;
}

export async function fetchSession(sessionId: string): Promise<RestoredSession> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function deleteSession(sessionId: string) {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: "DELETE" });
  if (!response.ok) throw await responseError(response);
}

export async function deleteAllSessions() {
  const response = await fetch(`${API_BASE}/api/sessions`, { method: "DELETE" });
  if (!response.ok) throw await responseError(response);
}

export async function answerCheckpoint(input: {
  checkpointId: string;
  session_id: string;
  selected_option_id: string;
  elapsed_ms: number;
}) {
  const response = await fetch(`${API_BASE}/api/checkpoints/${input.checkpointId}/answer`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      session_id: input.session_id,
      selected_option_id: input.selected_option_id,
      elapsed_ms: input.elapsed_ms
    })
  });
  if (!response.ok) throw await responseError(response);
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

export async function acceptStudentMessage(input: {
  session_id: string;
  client_message_id: string;
  message: string;
}): Promise<SessionInputAcceptance> {
  const response = await fetch(`${API_BASE}/api/sessions/${input.session_id}/inputs`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      kind: "STUDENT_MESSAGE",
      client_message_id: input.client_message_id,
      message: input.message
    })
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function dismissKnowledgeCardAndContinue(input: {
  session_id: string;
  client_command_id: string;
  card_id: string;
  folder_id?: string | null;
}): Promise<SessionInputAcceptance> {
  const response = await fetch(`${API_BASE}/api/sessions/${input.session_id}/inputs`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      kind: "CARD_DISMISSED_CONTINUE",
      client_command_id: input.client_command_id,
      card_id: input.card_id,
      folder_id: input.folder_id || null
    })
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function interruptSession(sessionId: string): Promise<{
  interrupted: boolean;
  active: boolean;
  run_ids: string[];
}> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/interrupt`, {
    method: "POST"
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
