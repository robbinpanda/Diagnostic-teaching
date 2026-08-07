import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { MistakeSet } from "./types";


export async function fetchMistakeSets(): Promise<MistakeSet[]> {
  const response = await fetch(`${API_BASE}/api/mistake-sets`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "错题集加载失败");
  const payload = await response.json();
  return payload.mistake_sets;
}


export async function createMistakeSet(input: {
  name: string;
  session_ids: string[];
}): Promise<MistakeSet> {
  const response = await fetch(`${API_BASE}/api/mistake-sets`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response, "错题集保存失败");
  return response.json();
}
