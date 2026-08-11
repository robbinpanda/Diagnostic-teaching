import { API_BASE, JSON_HEADERS, responseError } from "./http";
import {
  problemImageAnalysisResultSchema,
  problemImageDetectionResultSchema,
  responseContract
} from "./contracts";
import type { ProblemImageAnalysisResult, ProblemImageDetectionResult } from "./types";

type ProblemImageInput = {
  model_profile_id: string;
  image_base64: string;
  content_type: string;
  filename?: string;
};

export async function detectProblemImageRegions(
  input: ProblemImageInput
): Promise<ProblemImageDetectionResult> {
  const response = await fetch(`${API_BASE}/api/problem-images/detect`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, problemImageDetectionResultSchema, "题图区域检测");
}

export async function analyzeProblemImage(
  input: ProblemImageInput
): Promise<ProblemImageAnalysisResult> {
  const response = await fetch(`${API_BASE}/api/problem-images/analyze`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, problemImageAnalysisResultSchema, "题图分析");
}
