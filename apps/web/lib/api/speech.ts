import { responseContract, speechTranscriptionSchema } from "./contracts";
import { API_BASE, responseError } from "./http";
import type { SpeechTranscription } from "./types";

export type { SpeechStreamEvent, SpeechTranscription } from "./types";

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
    throw await responseError(response, `本地语音识别失败（${response.status}）`);
  }
  return responseContract(response, speechTranscriptionSchema, "语音转写");
}
