import { API_BASE, JSON_HEADERS, responseError } from "./http";
import { apiContracts, responseContract } from "./contracts";

export async function analyzeProblemText(input: {
  model_profile_id: string;
  text: string;
}) {
  const response = await fetch(`${API_BASE}/api/problem-intake/analyze-text`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return responseContract(response, apiContracts.splitTextProblems, "文本拆题");
}
