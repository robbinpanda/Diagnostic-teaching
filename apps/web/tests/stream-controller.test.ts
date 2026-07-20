import assert from "node:assert/strict";
import test from "node:test";
import { StreamController } from "../lib/stream-controller";

function resolveWhenAborted(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

test("cancellation aborts transport and blocks late callbacks", async () => {
  const controller = new StreamController();
  const received: string[] = [];
  let emitOld: ((value: string) => void) | undefined;
  let oldSignal: AbortSignal | undefined;

  const pending = controller.start<string>({
    sessionId: "session-a",
    runId: "run-1",
    async execute(signal, emit) {
      oldSignal = signal;
      emitOld = emit;
      await resolveWhenAborted(signal);
    },
    onEvent: (value) => received.push(value)
  });

  controller.cancel("session-a", "session-change");
  emitOld?.("late");
  const result = await pending;

  assert.equal(oldSignal?.aborted, true);
  assert.deepEqual(received, []);
  assert.equal(result.status, "cancelled");
  if (result.status === "cancelled") assert.equal(result.reason, "session-change");
});

test("different sessions keep streaming concurrently", async () => {
  const controller = new StreamController();
  const received: string[] = [];
  let emitA: ((value: string) => void) | undefined;
  let emitB: ((value: string) => void) | undefined;
  let finishA: (() => void) | undefined;
  let finishB: (() => void) | undefined;

  const runA = controller.start<string>({
    sessionId: "session-a",
    runId: "run-a",
    execute(_signal, emit) {
      emitA = emit;
      return new Promise<void>((resolve) => { finishA = resolve; });
    },
    onEvent: (value) => received.push(`a:${value}`)
  });

  const runB = controller.start<string>({
    sessionId: "session-b",
    runId: "run-b",
    execute(_signal, emit) {
      emitB = emit;
      return new Promise<void>((resolve) => { finishB = resolve; });
    },
    onEvent: (value) => received.push(`b:${value}`)
  });
  emitA?.("first");
  emitB?.("second");
  assert.deepEqual(controller.activeSessionIds.sort(), ["session-a", "session-b"]);
  finishA?.();
  finishB?.();

  const [resultA, resultB] = await Promise.all([runA, runB]);
  assert.equal(resultA.status, "completed");
  assert.equal(resultB.status, "completed");
  assert.deepEqual(received, ["a:first", "b:second"]);
});

test("a newer run only supersedes the same session", async () => {
  const controller = new StreamController();
  let oldSignal: AbortSignal | undefined;

  const oldRun = controller.start({
    sessionId: "session-a",
    runId: "run-1",
    async execute(signal) {
      oldSignal = signal;
      await resolveWhenAborted(signal);
    },
    onEvent() {}
  });
  const newRun = controller.start({
    sessionId: "session-a",
    runId: "run-2",
    async execute() {},
    onEvent() {}
  });

  const [oldResult, newResult] = await Promise.all([oldRun, newRun]);
  assert.equal(oldSignal?.aborted, true);
  assert.equal(oldResult.status, "cancelled");
  assert.equal(newResult.status, "completed");
});

test("stopping one session leaves another session connected", async () => {
  const controller = new StreamController();
  let signalB: AbortSignal | undefined;
  let finishB: (() => void) | undefined;

  const runA = controller.start({
    sessionId: "session-a",
    runId: "run-a",
    async execute(signal) {
      await resolveWhenAborted(signal);
    },
    onEvent() {}
  });
  const runB = controller.start({
    sessionId: "session-b",
    runId: "run-b",
    execute(signal) {
      signalB = signal;
      return new Promise<void>((resolve) => { finishB = resolve; });
    },
    onEvent() {}
  });

  controller.cancel("session-a", "user");
  assert.equal(signalB?.aborted, false);
  assert.deepEqual(controller.activeSessionIds, ["session-b"]);
  finishB?.();

  const [resultA, resultB] = await Promise.all([runA, runB]);
  assert.equal(resultA.status, "cancelled");
  assert.equal(resultB.status, "completed");
});

test("a transport error clears ownership so the next run can recover", async () => {
  const controller = new StreamController();
  await assert.rejects(() => controller.start({
    sessionId: "session-a",
    runId: "run-1",
    async execute() {
      throw new Error("transport failed");
    },
    onEvent() {}
  }), /transport failed/);
  assert.equal(controller.current, null);

  const result = await controller.start({
    sessionId: "session-a",
    runId: "run-2",
    async execute() {},
    onEvent() {}
  });
  assert.equal(result.status, "completed");
});
