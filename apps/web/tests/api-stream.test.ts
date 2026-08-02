import assert from "node:assert/strict";
import test from "node:test";
import { fetchSessionRunStatus, modelProfileLabel, streamChat } from "../lib/api";

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
    return new Response("event: message_done\ndata: {\"ok\":true}\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  }) as typeof fetch;

  try {
    await streamChat({ session_id: "session-a" }, () => {});
    await streamChat(
      { session_id: "session-a" },
      () => {},
      { replayCursor: { afterSeq: 12 } }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal("after_seq" in bodies[0], false);
  assert.equal(bodies[1].after_seq, 12);
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
