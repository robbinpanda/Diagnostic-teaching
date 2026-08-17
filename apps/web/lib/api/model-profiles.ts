import { API_BASE, JSON_HEADERS, responseError } from "./http";
import {
  apiContracts,
  modelProfileSchema,
  modelProfileTestResultSchema,
  responseContract
} from "./contracts";
import type { ModelProfile, ModelProfileTestResult, ReasoningEffort } from "./types";

export function modelProfileLabel(profile: Pick<ModelProfile, "display_name" | "model">) {
  return `${profile.display_name} · ${profile.model}`;
}

export async function fetchProfiles(): Promise<ModelProfile[]> {
  const response = await fetch(`${API_BASE}/api/model-profiles`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "模型列表加载失败");
  const payload = await responseContract(response, apiContracts.profiles, "模型配置列表");
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
    reasoning_effort_options?: ReasoningEffort[];
  }
) {
  const response = await fetch(`${API_BASE}/api/model-profiles/${profileId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, modelProfileSchema, "更新模型配置");
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
  return responseContract(response, modelProfileSchema, "更新模型推理强度");
}

export async function testModelProfile(input: {
  profile_id?: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  api_key?: string;
  model: string;
  timeout_ms?: number;
  temperature: number;
  max_output_tokens: number;
  probe_multimodal?: boolean;
  require_multimodal?: boolean;
}): Promise<ModelProfileTestResult> {
  const response = await fetch(`${API_BASE}/api/model-profiles/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, modelProfileTestResultSchema, "测试模型配置");
}

export async function createModelProfiles(input: {
  display_name: string;
  provider: "openai" | "openai_compatible" | "anthropic" | "local_demo";
  base_url: string;
  api_key: string;
  models: Array<{
    model: string;
    is_multimodal: boolean;
    reasoning_effort_options?: ReasoningEffort[];
  }>;
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
  return responseContract(response, apiContracts.profiles, "批量创建模型配置");
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
  return responseContract(response, apiContracts.deletedProfileIds, "批量删除模型配置");
}
