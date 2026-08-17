import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiContractError,
  ChatStreamClosedError,
  ChatStreamTerminalError,
  fetchSessionRunStatus,
  modelProfileLabel,
  streamChat
} from "../lib/api";

test("model labels use the intended middle-dot separator", () => {
  assert.equal(
    modelProfileLabel({ display_name: "火山方舟", model: "deepseek-v4-pro" }),
    "火山方舟 · deepseek-v4-pro"
  );
  assert.equal(
    modelProfileLabel({ display_name: "opencodefree-mimo", model: "mimo", managed: true }),
    "opencodefree-mimo"
  );
});

test("streamChat forwards AbortSignal to fetch", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;

  globalThis.fetch = ((_input: URL | RequestInfo, init?: RequestInit) => {
    receivedSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("cancelled", "AbortError"));
      }, { once: true });
    });
  }) as typeof fetch;

  try {
    const pending = streamChat({ session_id: "session-a" }, () => {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy requests omit after_seq and replay requests add it only when explicit", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      "event: stream_complete\ndata: {\"run_id\":\"run-1\",\"status\":\"completed\",\"last_committed_action_index\":0}\n\n",
      {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
      }
    );
  }) as typeof fetch;

  try {
    await streamChat({ session_id: "session-a", client_run_id: "stable-run" }, () => {});
    await streamChat(
      { session_id: "session-a" },
      () => {},
      { replayCursor: { afterSeq: 12 } }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal("after_seq" in bodies[0], false);
  assert.equal(bodies[0].client_run_id, "stable-run");
  assert.equal(bodies[1].after_seq, 12);
});

test("streamChat rejects a clean EOF without an explicit terminal event", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    "event: message_done\ndata: {\"ok\":true}\n\n",
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  )) as typeof fetch;

  try {
    await assert.rejects(
      streamChat({ session_id: "session-eof" }, () => {}),
      (error: unknown) => error instanceof ChatStreamClosedError && error.retryable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChat treats an explicit provider error as terminal failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    "event: error\ndata: {\"message\":\"busy\",\"code\":\"provider_error\",\"retryable\":true}\n\n",
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  )) as typeof fetch;

  try {
    await assert.rejects(
      streamChat({ session_id: "session-error" }, () => {}),
      (error: unknown) => (
        error instanceof ChatStreamTerminalError
        && error.code === "provider_error"
        && error.retryable
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChat rejects malformed payloads for known SSE events", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    "event: message_delta\ndata: {\"text\":42}\n\n",
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  )) as typeof fetch;

  try {
    await assert.rejects(
      streamChat({ session_id: "session-invalid-event" }, () => {}),
      ApiContractError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run status lookup uses a no-store session-scoped request", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedCache: RequestCache | undefined;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedCache = init?.cache;
    return Response.json({ active: false, running: false, run: null });
  }) as typeof fetch;

  try {
    assert.deepEqual(await fetchSessionRunStatus("session-refresh"), {
      active: false,
      running: false,
      run: null
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(requestedUrl, /\/api\/sessions\/session-refresh\/run$/);
  assert.equal(requestedCache, "no-store");
});

test("run status lookup rejects a backend payload that violates its contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    active: true,
    running: true,
    run: { run_id: 42 }
  })) as typeof fetch;

  try {
    await assert.rejects(fetchSessionRunStatus("session-invalid"), ApiContractError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
