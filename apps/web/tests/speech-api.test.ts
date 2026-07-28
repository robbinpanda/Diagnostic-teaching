import assert from "node:assert/strict";
import test from "node:test";
import { speechStreamUrl } from "../lib/api/speech";

test("speechStreamUrl maps local HTTP APIs to WebSocket", () => {
  assert.equal(
    speechStreamUrl("http://127.0.0.1:8010"),
    "ws://127.0.0.1:8010/api/speech/stream"
  );
  assert.equal(
    speechStreamUrl("https://example.test/backend/"),
    "wss://example.test/backend/api/speech/stream"
  );
});
