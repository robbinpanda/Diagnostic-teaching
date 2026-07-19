export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8010";

export const JSON_HEADERS = { "Content-Type": "application/json" };

export async function responseError(response: Response, fallback?: string): Promise<Error> {
  const detail = await response.text();
  return new Error(detail || fallback || `请求失败（${response.status}）`);
}
