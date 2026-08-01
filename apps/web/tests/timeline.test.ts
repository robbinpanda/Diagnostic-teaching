import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalStreamEvent, StreamEventKind } from "../lib/stream-protocol";
import {
  createTimelineState,
  timelineReducer,
  type TimelineState
} from "../lib/timeline";
import { cardFixture, checkpointFixture } from "./fixtures";

function startRun(sessionId = "session-a", runId = "run-1") {
  return timelineReducer(
    { ...createTimelineState(sessionId), messages: [] },
    { type: "run_started", sessionId, runId }
  );
}

function streamEvent(
  kind: StreamEventKind,
  data: CanonicalStreamEvent["data"],
  extra: Partial<Omit<CanonicalStreamEvent, "kind" | "data">> = {}
): CanonicalStreamEvent {
  return {
    kind,
    data,
    sessionId: "session-a",
    runId: "run-1",
    ...extra
  } as CanonicalStreamEvent;
}

function reduceEvent(state: TimelineState, event: CanonicalStreamEvent) {
  return timelineReducer(state, { type: "stream_event", event });
}

test("timeline stitches retry output and finalizes one action deterministically", () => {
  let state = startRun();
  state = reduceEvent(state, streamEvent("message_delta", { text: "旧", action_index: 0 }, { sequence: 1 }));
  state = reduceEvent(state, streamEvent("message_reset", { action_index: 0 }, { sequence: 2 }));
  state = reduceEvent(state, streamEvent("message_delta", { text: "新", action_index: 0 }, { sequence: 3 }));
  state = reduceEvent(state, streamEvent("decision", {
    message: "新答案",
    action: "EXPLAIN_LOCAL",
    action_index: 0
  }, { sequence: 4 }));
  state = reduceEvent(state, streamEvent("message_done", { ok: true, action_index: 0 }, { sequence: 5 }));

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, "新答案");
  assert.equal(state.messages[0].action, "EXPLAIN_LOCAL");
  assert.equal(state.messages[0].streamState, "complete");
});

test("sequenced duplicates and late events are ignored after message_done", () => {
  let state = startRun();
  state = reduceEvent(state, streamEvent("message_delta", { text: "答", action_index: 0 }, { sequence: 1 }));
  state = reduceEvent(state, streamEvent("message_done", { ok: true, action_index: 0 }, { sequence: 2 }));
  const completed = state;

  state = reduceEvent(state, streamEvent("message_done", { ok: true, action_index: 0 }, { sequence: 2 }));
  state = reduceEvent(state, streamEvent("message_delta", { text: "迟到", action_index: 0 }, { sequence: 3, actionIndex: 0 }));

  assert.deepEqual(state.messages, completed.messages);
  assert.equal(state.run?.lastSequence, 3);
});

test("duplicate reset/error and late decision events have terminal behavior", () => {
  let state = startRun();
  state = reduceEvent(state, streamEvent("message_delta", { text: "旧", action_index: 0 }));
  state = reduceEvent(state, streamEvent("message_reset", { action_index: 0 }));
  const onceReset = state;
  state = reduceEvent(state, streamEvent("message_reset", { action_index: 0 }));
  assert.deepEqual(state.messages, onceReset.messages);

  state = reduceEvent(state, streamEvent("decision", {
    message: "最终内容",
    action: "ASK_OPEN_QUESTION",
    action_index: 0
  }, { eventId: "decision-1", actionIndex: 0 }));
  state = reduceEvent(state, streamEvent("message_done", { ok: true, action_index: 0 }, { actionIndex: 0 }));
  const completed = state.messages;
  state = reduceEvent(state, streamEvent("decision", {
    message: "迟到改写",
    action: "SUMMARIZE",
    action_index: 0
  }, { actionIndex: 0 }));
  assert.deepEqual(state.messages, completed);

  state = timelineReducer(state, { type: "run_started", sessionId: "session-a", runId: "run-2" });
  state = reduceEvent(state, streamEvent("error", { message: "失败" }, { runId: "run-2" }));
  const failed = state;
  state = reduceEvent(state, streamEvent("error", { message: "重复失败" }, { runId: "run-2" }));
  assert.deepEqual(state, failed);
});

test("event ids make delta delivery idempotent while legacy deltas stay arrival ordered", () => {
  let state = startRun();
  const identified = streamEvent("message_delta", { text: "A", action_index: 0 }, { eventId: "event-1" });
  state = reduceEvent(state, identified);
  state = reduceEvent(state, identified);
  state = reduceEvent(state, streamEvent("message_delta", { text: "B", action_index: 0 }));
  state = reduceEvent(state, streamEvent("message_delta", { text: "B", action_index: 0 }));

  assert.equal(state.messages[0].text, "ABB");
});

test("wrong-session and obsolete-run events cannot mutate the active timeline", () => {
  let state = startRun();
  const baseline = state;
  state = reduceEvent(state, streamEvent("message_delta", { text: "wrong" }, { sessionId: "session-b" }));
  state = reduceEvent(state, streamEvent("message_delta", { text: "old" }, { runId: "run-old" }));
  assert.deepEqual(state, baseline);
});

test("checkpoint and card signals are first-wins and duplicate-safe", () => {
  let state = startRun();
  state = reduceEvent(state, streamEvent("checkpoint_ready", checkpointFixture, { eventId: "checkpoint-1" }));
  state = reduceEvent(state, streamEvent("checkpoint_ready", checkpointFixture, { eventId: "checkpoint-1" }));
  state = reduceEvent(state, streamEvent("card_ready", cardFixture, { eventId: "card-1" }));

  assert.equal(state.pendingInteraction?.kind, "checkpoint");
  if (state.pendingInteraction?.kind === "checkpoint") {
    assert.equal(state.pendingInteraction.checkpoint.id, checkpointFixture.id);
  }
});

test("a failed run can be replaced by a clean recovery run", () => {
  let state = startRun();
  state = reduceEvent(state, streamEvent("error", { message: "网络错误" }));
  assert.equal(state.run?.status, "failed");
  assert.equal(state.lastError, "网络错误");

  state = timelineReducer(state, { type: "run_started", sessionId: "session-a", runId: "run-2" });
  state = reduceEvent(state, streamEvent("message_delta", { text: "已恢复" }, { runId: "run-2" }));
  state = timelineReducer(state, { type: "run_completed", sessionId: "session-a", runId: "run-2" });

  assert.equal(state.run?.status, "completed");
  assert.equal(state.lastError, null);
  assert.equal(state.messages.at(-1)?.text, "已恢复");
});

test("student-message interruption preserves visible partial explanation", () => {
  let state = createTimelineState("session-a");
  state = timelineReducer(state, { type: "run_started", sessionId: "session-a", runId: "run-1" });
  state = reduceEvent(state, streamEvent("message_delta", { text: "先看这一部分" }));

  state = timelineReducer(state, {
    type: "run_cancelled",
    sessionId: "session-a",
    runId: "run-1",
    preservePartial: true
  });

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, "先看这一部分");
  assert.equal(state.messages[0].action, "INTERRUPTED_EXPLANATION");
  assert.equal(state.messages[0].streamState, "complete");
});
