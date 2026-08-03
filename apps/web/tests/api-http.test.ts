import assert from "node:assert/strict";
import test from "node:test";
import { ApiResponseError, isApiResponseError, responseError } from "../lib/api/http";

test("API errors expose HTTP status and unwrap FastAPI detail", async () => {
  const error = await responseError(new Response(
    JSON.stringify({ detail: "SQLite 中不存在该历史会话" }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  ));

  assert.ok(error instanceof ApiResponseError);
  assert.equal(error.status, 404);
  assert.equal(error.message, "SQLite 中不存在该历史会话");
  assert.equal(isApiResponseError(error, 404), true);
  assert.equal(isApiResponseError(error, 409), false);
});

test("API errors preserve non-JSON response text", async () => {
  const error = await responseError(new Response("upstream unavailable", { status: 502 }));

  assert.equal(error.status, 502);
  assert.equal(error.message, "upstream unavailable");
});
