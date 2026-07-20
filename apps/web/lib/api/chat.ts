import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { SseEvent } from "./types";

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
