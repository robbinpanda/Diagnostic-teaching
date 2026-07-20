import { API_BASE, JSON_HEADERS, responseError } from "./http";

export async function analyzeProblemImage(input: {
  model_profile_id: string;
  image_base64: string;
  content_type: string;
  filename?: string;
}) {
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
