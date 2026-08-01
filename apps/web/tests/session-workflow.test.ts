import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionWorkflowState,
  isComposerBlocked,
  sessionWorkflowReducer
} from "../lib/session-workflow";
import { cardFixture, checkpointFixture } from "./fixtures";

test("checkpoint stays interactive while submissions remain mutually exclusive", () => {
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
  assert.equal(isComposerBlocked(state), false);

  state = sessionWorkflowReducer(state, { type: "checkpoint_submit_started" });
  assert.equal(isComposerBlocked(state), true);
  state = sessionWorkflowReducer(state, { type: "checkpoint_submit_failed", message: "请重试" });
  assert.equal(state.mode, "checkpoint");
  assert.equal(state.phase, "ready");
  assert.equal(state.error, "请重试");

  state = sessionWorkflowReducer(state, { type: "checkpoint_submit_started" });
  state = sessionWorkflowReducer(state, { type: "checkpoint_submitted" });
  assert.deepEqual(state, createSessionWorkflowState());
});

test("a restored pending card does not take ownership of the conversation workflow", () => {
  let state = sessionWorkflowReducer(createSessionWorkflowState(), {
    type: "session_loaded",
    pendingCard: cardFixture,
    now: 100
  });
  assert.equal(state.mode, "composer");
  assert.equal(isComposerBlocked(state), false);

  state = sessionWorkflowReducer(state, {
    type: "run_started",
    sessionId: "session-a",
    runId: "run-1"
  });
  assert.equal(state.mode, "run");
  assert.equal(isComposerBlocked(state), false);
  state = sessionWorkflowReducer(state, {
    type: "message_done",
    sessionId: "session-a",
    runId: "run-1"
  });
  assert.equal(state.mode, "run");
  state = sessionWorkflowReducer(state, {
    type: "run_finished",
    sessionId: "session-a",
    runId: "run-1"
  });
  assert.equal(state.mode, "composer");
  assert.equal(isComposerBlocked(state), false);
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

test("a background run does not take ownership of the foreground workflow", () => {
  const state = sessionWorkflowReducer(createSessionWorkflowState(), {
    type: "run_started",
    sessionId: "background-session",
    runId: "background-run",
    foreground: false
  });

  assert.deepEqual(state, createSessionWorkflowState());
});
