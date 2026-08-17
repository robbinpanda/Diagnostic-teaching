import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  ApiContractError,
  parseSpeechStreamEvent,
  parseSseEvent,
  responseContract,
  sessionRunStatusSchema
} from "../lib/api/contracts";
import { cardFixture, checkpointFixture } from "./fixtures";

test("response contracts reject invalid JSON with endpoint context", async () => {
  await assert.rejects(
    responseContract(new Response("not-json"), z.object({ ok: z.boolean() }), "测试接口"),
    (error: unknown) => (
      error instanceof ApiContractError
      && error.contract === "测试接口"
      && error.message.includes("不是合法 JSON")
    )
  );
});

test("response contracts report the malformed field instead of trusting a cast", async () => {
  await assert.rejects(
    responseContract(
      Response.json({ active: "yes", running: false, run: null }),
      sessionRunStatusSchema,
      "会话运行状态"
    ),
    (error: unknown) => (
      error instanceof ApiContractError
      && error.contract === "会话运行状态"
      && error.issues.some((issue) => issue.startsWith("active:"))
    )
  );
});

test("SSE contracts validate known event payloads and retain replay metadata", () => {
  const event = parseSseEvent(
    "message_delta",
    JSON.stringify({ text: "第一步", action_index: 2, seq: 17 }),
    "17"
  );

  assert.deepEqual(event, {
    event: "message_delta",
    data: { text: "第一步", action_index: 2, seq: 17 },
    id: "17"
  });
  assert.throws(
    () => parseSseEvent("message_delta", JSON.stringify({ text: 42 })),
    ApiContractError
  );
  assert.deepEqual(
    parseSseEvent("checkpoint_ready", JSON.stringify(checkpointFixture)).data,
    checkpointFixture
  );
  assert.deepEqual(
    parseSseEvent("card_ready", JSON.stringify(cardFixture)).data,
    cardFixture
  );
});

test("speech stream contracts reject unknown or incomplete variants", () => {
  assert.deepEqual(parseSpeechStreamEvent(JSON.stringify({ type: "done" })), { type: "done" });
  assert.throws(
    () => parseSpeechStreamEvent(JSON.stringify({ type: "partial", text: "缺少时长" })),
    ApiContractError
  );
  assert.throws(
    () => parseSpeechStreamEvent(JSON.stringify({ type: "mystery" })),
    ApiContractError
  );
});
