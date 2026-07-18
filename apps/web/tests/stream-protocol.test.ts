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
