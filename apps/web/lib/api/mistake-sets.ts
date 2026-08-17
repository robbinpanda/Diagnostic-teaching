import { API_BASE, JSON_HEADERS, responseError } from "./http";
import { apiContracts, mistakeSetSchema, responseContract } from "./contracts";
import type { MistakeSet } from "./types";


export async function fetchMistakeSets(): Promise<MistakeSet[]> {
  const response = await fetch(`${API_BASE}/api/mistake-sets`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "错题集加载失败");
  const payload = await responseContract(response, apiContracts.mistakeSets, "错题集列表");
  return payload.mistake_sets;
}


export async function createMistakeSet(input: {
  name: string;
  card_ids: string[];
}): Promise<MistakeSet> {
  const response = await fetch(`${API_BASE}/api/mistake-sets`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response, "错题集保存失败");
  return responseContract(response, mistakeSetSchema, "创建错题集");
}


export async function deleteMistakeSets(mistakeSetIds: string[]): Promise<void> {
  const response = await fetch(`${API_BASE}/api/mistake-sets/bulk-delete`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ mistake_set_ids: mistakeSetIds })
  });
  if (!response.ok) throw await responseError(response, "批量删除错题集失败");
}
