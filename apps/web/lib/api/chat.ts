import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { SseEvent } from "./types";

export type ChatStreamTerminal =
  | { kind: "completed"; data: Record<string, unknown> }
  | { kind: "interrupted"; data: Record<string, unknown> };

export class ChatStreamClosedError extends Error {
  readonly code = "stream_closed";
  readonly retryable = true;

  constructor() {
    super("答疑流意外关闭，正在核对服务端状态");
    this.name = "ChatStreamClosedError";
  }
}

export class ChatStreamTerminalError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(data: Record<string, unknown>) {
    super(typeof data.message === "string" && data.message.trim()
      ? data.message
      : "答疑请求失败");
    this.name = "ChatStreamTerminalError";
    this.code = typeof data.code === "string" ? data.code : "run_failed";
    this.retryable = data.retryable === true;
  }
}

export async function streamChat(
  input: {
    session_id: string;
    client_run_id?: string;
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
): Promise<ChatStreamTerminal> {
  const body = options.replayCursor?.afterSeq === undefined
    ? input
    : { ...input, after_seq: options.replayCursor.afterSeq };
  const response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal: options.signal
  });
  if (!response.ok || !response.body) {
    throw await responseError(response, "答疑流启动失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal:
    | { kind: "completed" | "interrupted" | "error"; data: Record<string, unknown> }
    | null = null;

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
    if (!terminal && event === "stream_complete") terminal = { kind: "completed", data };
    if (!terminal && event === "run_interrupted") terminal = { kind: "interrupted", data };
    if (!terminal && event === "error") terminal = { kind: "error", data };
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
  const resolvedTerminal = terminal as (
    | { kind: "completed" | "interrupted" | "error"; data: Record<string, unknown> }
    | null
  );
  if (!resolvedTerminal) throw new ChatStreamClosedError();
  if (resolvedTerminal.kind === "error") {
    throw new ChatStreamTerminalError(resolvedTerminal.data);
  }
  return resolvedTerminal.kind === "completed"
    ? { kind: "completed", data: resolvedTerminal.data }
    : { kind: "interrupted", data: resolvedTerminal.data };
}
