export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8010");

export const JSON_HEADERS = { "Content-Type": "application/json" };

export class ApiResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

function responseDetail(body: string) {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && "detail" in parsed) {
      const detail = (parsed as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (
        detail
        && typeof detail === "object"
        && "message" in detail
        && typeof (detail as { message?: unknown }).message === "string"
      ) {
        return (detail as { message: string }).message;
      }
    }
  } catch {
    // Non-JSON provider/proxy errors should remain readable as plain text.
  }
  return body;
}

export function isApiResponseError(error: unknown, status?: number): error is ApiResponseError {
  return error instanceof ApiResponseError && (status === undefined || error.status === status);
}

export async function responseError(
  response: Response,
  fallback?: string
): Promise<ApiResponseError> {
  const detail = responseDetail(await response.text());
  return new ApiResponseError(
    response.status,
    detail || fallback || `请求失败（${response.status}）`
  );
}
