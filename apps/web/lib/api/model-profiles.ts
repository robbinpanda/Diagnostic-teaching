import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { ModelProfile, ReasoningEffort } from "./types";

export function modelProfileLabel(profile: Pick<ModelProfile, "display_name" | "model"> & Partial<Pick<ModelProfile, "managed">>) {
  return profile.managed ? profile.display_name : `${profile.display_name} · ${profile.model}`;
}

export async function fetchProfiles(): Promise<ModelProfile[]> {
  const response = await fetch(`${API_BASE}/api/model-profiles`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "模型列表加载失败");
  const payload = await response.json();
  return payload.profiles;
}

export async function updateModelProfile(
  profileId: string,
  input: {
    display_name: string;
    provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
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
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<ModelProfile>;
}

export async function updateModelProfileReasoning(
  profileId: string,
  reasoningEffort: ReasoningEffort
) {
  const response = await fetch(`${API_BASE}/api/model-profiles/${profileId}/reasoning`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ reasoning_effort: reasoningEffort })
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<ModelProfile>;
}

export async function testModelProfile(input: {
  profile_id?: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  api_key?: string;
  model: string;
  timeout_ms?: number;
  max_output_tokens: number;
  probe_multimodal?: boolean;
  require_multimodal?: boolean;
  reasoning_effort?: ReasoningEffort;
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<{
    ok: boolean;
    latency_ms: number | null;
    message: string;
    multimodal_ok?: boolean | null;
    multimodal_latency_ms?: number | null;
    multimodal_message?: string | null;
  }>;
}

export async function createModelProfiles(input: {
  display_name: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  api_key: string;
  models: Array<{ model: string; is_multimodal: boolean }>;
  tags: string[];
  timeout_ms: number;
  temperature: number;
  max_output_tokens: number;
}) {
  const response = await fetch(`${API_BASE}/api/model-profiles/batch`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<{ profiles: ModelProfile[] }>;
}

export async function deleteModelProfile(profileId: string) {
  const response = await fetch(`${API_BASE}/api/model-profiles/${profileId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await responseError(response);
}

export async function deleteModelProfiles(profileIds: string[]) {
  const response = await fetch(`${API_BASE}/api/model-profiles/batch-delete`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ profile_ids: profileIds })
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<{ deleted_profile_ids: string[] }>;
}
