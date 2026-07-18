import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionWorkflowState,
  sessionWorkflowReducer
} from "../lib/session-workflow";
import { cardFixture, checkpointFixture } from "./fixtures";

test("run, checkpoint and composer states are mutually exclusive", () => {
  let state = createSessionWorkflowState();
  state = sessionWorkflowReducer(state, { type: "run_started", sessionId: "session-a", runId: "run-1" });
  state = sessionWorkflowReducer(state, {
    type: "checkpoint_ready",
    sessionId: "session-a",
    runId: "run-1",
    checkpoint: checkpointFixture,
    now: 100
  });
  assert.equal(state.mode, "checkpoint");

  state = sessionWorkflowReducer(state, {
    type: "card_buffered",
    sessionId: "session-a",
    runId: "run-1",
    card: cardFixture
  });
  assert.equal(state.mode, "checkpoint");

  state = sessionWorkflowReducer(state, { type: "checkpoint_submit_started" });
  state = sessionWorkflowReducer(state, { type: "checkpoint_submit_failed", message: "请重试" });
  assert.equal(state.mode, "checkpoint");
  assert.equal(state.phase, "ready");
  assert.equal(state.error, "请重试");

  state = sessionWorkflowReducer(state, { type: "checkpoint_submit_started" });
  state = sessionWorkflowReducer(state, { type: "checkpoint_submitted" });
  assert.deepEqual(state, createSessionWorkflowState());
});

test("card is buffered until message_done and saving recovers from errors", () => {
  let state = sessionWorkflowReducer(createSessionWorkflowState(), {
    type: "run_started",
    sessionId: "session-a",
    runId: "run-1"
  });
  state = sessionWorkflowReducer(state, {
    type: "card_buffered",
    sessionId: "session-a",
    runId: "run-1",
    card: cardFixture
  });
  assert.equal(state.mode, "run");

  state = sessionWorkflowReducer(state, { type: "message_done", sessionId: "session-a", runId: "run-1" });
  assert.equal(state.mode, "card");
  state = sessionWorkflowReducer(state, { type: "card_save_started" });
  state = sessionWorkflowReducer(state, { type: "card_save_failed", message: "保存失败" });
  assert.equal(state.mode, "card");
  assert.equal(state.phase, "ready");
  assert.equal(state.error, "保存失败");
});

test("stream errors return to composer and allow a recovery run", () => {
  let state = sessionWorkflowReducer(createSessionWorkflowState(), {
    type: "run_started",
    sessionId: "session-a",
    runId: "run-1"
  });
  state = sessionWorkflowReducer(state, {
    type: "run_failed",
    sessionId: "session-a",
    runId: "run-1",
    message: "连接中断"
  });
  assert.equal(state.mode, "composer");
  assert.equal(state.error, "连接中断");

  state = sessionWorkflowReducer(state, { type: "error_cleared" });
  state = sessionWorkflowReducer(state, { type: "run_started", sessionId: "session-a", runId: "run-2" });
  assert.equal(state.mode, "run");
  assert.equal(state.error, null);
});
