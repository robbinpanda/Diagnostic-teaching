import { API_BASE, JSON_HEADERS, responseError } from "./http";
import {
  apiContracts,
  checkpointAnswerResultSchema,
  responseContract,
  restoredSessionSchema,
  sessionInputAcceptanceSchema,
  sessionInterruptResultSchema,
  sessionRunStatusSchema,
  sessionStartResultSchema
} from "./contracts";
import type {
  CheckpointAnswerResult,
  KnowledgeCardContent,
  RestoredSession,
  SessionHistoryItem,
  SessionInputAcceptance,
  SessionInterruptResult,
  SessionRunStatus,
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
  return responseContract(response, sessionStartResultSchema, "启动会话");
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
  return responseContract(response, apiContracts.sessionStarts, "批量启动会话");
}

export async function batchStartImageSessions(input: {
  grade_band: "junior" | "senior";
  subject: "math";
  model_profile_id: string;
  paper_id: string;
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
  return responseContract(response, apiContracts.sessionStarts, "批量启动题图会话");
}

export async function fetchSessionHistory(): Promise<SessionHistoryItem[]> {
  const response = await fetch(`${API_BASE}/api/sessions/history`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "历史会话加载失败");
  const payload = await responseContract(response, apiContracts.sessionHistory, "历史会话列表");
  return payload.sessions;
}

export async function fetchSession(sessionId: string): Promise<RestoredSession> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, restoredSessionSchema, "恢复会话");
}

export async function fetchSessionRunStatus(sessionId: string): Promise<SessionRunStatus> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/run`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "会话运行状态加载失败");
  return responseContract(response, sessionRunStatusSchema, "会话运行状态");
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
}): Promise<CheckpointAnswerResult> {
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
  return responseContract(response, checkpointAnswerResultSchema, "提交检查点答案");
}

export async function acceptStudentMessage(input: {
  session_id: string;
  client_message_id: string;
  message: string;
  image_data_url?: string | null;
}): Promise<SessionInputAcceptance> {
  const response = await fetch(`${API_BASE}/api/sessions/${input.session_id}/inputs`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      kind: "STUDENT_MESSAGE",
      client_message_id: input.client_message_id,
      message: input.message,
      ...(input.image_data_url ? { image_data_url: input.image_data_url } : {})
    })
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, sessionInputAcceptanceSchema, "接纳学生消息");
}

export async function dismissKnowledgeCardAndContinue(input: {
  session_id: string;
  client_command_id: string;
  card_id: string;
  folder_id?: string | null;
  content?: KnowledgeCardContent;
  save_to_library?: boolean;
}): Promise<SessionInputAcceptance> {
  const response = await fetch(`${API_BASE}/api/sessions/${input.session_id}/inputs`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      kind: "CARD_DISMISSED_CONTINUE",
      client_command_id: input.client_command_id,
      card_id: input.card_id,
      ...(input.folder_id ? { folder_id: input.folder_id } : {}),
      ...(input.content ? { content: input.content } : {}),
      ...(input.save_to_library === false ? { save_to_library: false } : {})
    })
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, sessionInputAcceptanceSchema, "接纳卡片继续命令");
}

export async function interruptSession(sessionId: string): Promise<SessionInterruptResult> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/interrupt`, {
    method: "POST"
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, sessionInterruptResultSchema, "中断会话");
}
