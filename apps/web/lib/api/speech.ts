import { API_BASE } from "./http";

export type SpeechTranscription = {
  text: string;
  duration_seconds: number;
  language: string | null;
  emotion: string | null;
  event: string | null;
};

export type SpeechStreamEvent =
  | {
    type: "ready";
    sample_rate: number;
    partial_interval_ms: number;
    commit_silence_ms: number;
  }
  | ({ type: "partial" | "final" } & SpeechTranscription)
  | { type: "empty"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

export function speechStreamUrl(
  apiBase = API_BASE,
  pageOrigin = typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin
): string {
  const url = new URL(apiBase, pageOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/speech/stream`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function transcribeSpeech(audio: Blob): Promise<SpeechTranscription> {
  const response = await fetch(`${API_BASE}/api/speech/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: audio
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `本地语音识别失败（${response.status}）`);
  }
  return response.json();
}
