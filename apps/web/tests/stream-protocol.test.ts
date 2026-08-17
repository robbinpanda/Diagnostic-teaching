import assert from "node:assert/strict";
import test from "node:test";
import { createStreamEventAdapter, replayCursorFromSequence } from "../lib/stream-protocol";

test("adapter preserves optional server sequence without inventing one for legacy events", () => {
  const adapter = createStreamEventAdapter({ sessionId: "session-a", runId: "run-1" });
  const sequenced = adapter.adapt({
    event: "message_delta",
    id: "42",
    data: { text: "A", action_index: 3 }
  });
  const legacy = adapter.adapt({ event: "message_delta", data: { text: "B" } });

  assert.equal(sequenced?.sequence, 42);
  assert.equal(sequenced?.eventId, "42");
  assert.equal(sequenced?.actionIndex, 3);
  assert.equal(legacy?.sequence, undefined);
  assert.deepEqual(replayCursorFromSequence(sequenced?.sequence), { afterSeq: 42 });
});

test("adapter ignores unknown events until a protocol mapping is defined", () => {
  const adapter = createStreamEventAdapter({ sessionId: "session-a", runId: "run-1" });
  assert.equal(adapter.adapt({ event: "future_event", data: {} }), null);
});

test("adapter recognizes an explicit server interruption", () => {
  const adapter = createStreamEventAdapter({ sessionId: "session-a", runId: "run-1" });
  const event = adapter.adapt({
    event: "run_interrupted",
    data: { run_id: "server-run-1", status: "interrupted" }
  });

  assert.equal(event?.kind, "run_interrupted");
  assert.equal(event?.sessionId, "session-a");
  assert.equal(event?.runId, "run-1");
});

test("adapter recognizes the durable completed terminal", () => {
  const adapter = createStreamEventAdapter({ sessionId: "session-a", runId: "run-1" });
  const event = adapter.adapt({
    event: "stream_complete",
    data: {
      run_id: "server-run-1",
      status: "completed",
      last_committed_action_index: 2
    }
  });

  assert.equal(event?.kind, "stream_complete");
  assert.equal(
    (event?.data as { last_committed_action_index?: number }).last_committed_action_index,
    2
  );
});

test("adapter recognizes safe progress events", () => {
  const adapter = createStreamEventAdapter({ sessionId: "session-a", runId: "run-1" });
  const event = adapter.adapt({
    event: "progress",
    data: {
      stage: "checking_thought",
      label: "正在核对你的思路",
      action_index: 0,
      elapsed_ms: 2300
    }
  });

  assert.equal(event?.kind, "progress");
  assert.equal(event?.actionIndex, 0);
});
