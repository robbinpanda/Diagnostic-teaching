import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { ExamPaper } from "./types";

export async function fetchExamPapers(): Promise<ExamPaper[]> {
  const response = await fetch(`${API_BASE}/api/exam-papers`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "试卷列表加载失败");
  const payload = await response.json();
  return payload.papers;
}

export async function createExamPaper(name: string): Promise<ExamPaper> {
  const response = await fetch(`${API_BASE}/api/exam-papers`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw await responseError(response, "试卷创建失败");
  return response.json();
}
