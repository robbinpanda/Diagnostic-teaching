import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { DetectedProblemRegion } from "./types";

type ProblemImageInput = {
  model_profile_id: string;
  image_base64: string;
  content_type: string;
  filename?: string;
};

export async function detectProblemImageRegions(input: ProblemImageInput) {
  const response = await fetch(`${API_BASE}/api/problem-images/detect`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<{
    problems: DetectedProblemRegion[];
    image_width: number;
    image_height: number;
  }>;
}

export async function analyzeProblemImage(input: ProblemImageInput) {
  const response = await fetch(`${API_BASE}/api/problem-images/analyze`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<{
    problem_text: string;
    student_work_summary: string;
    answer_text: string;
    correctness: "correct" | "incorrect" | "unknown" | "not_present";
    mistake_summary: string;
    needs_diagram: boolean;
    diagram_image_data_url?: string | null;
    diagram_note?: string | null;
  }>;
}
