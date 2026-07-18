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

  controller.cancel("session-change");
  emitOld?.("late");
  const result = await pending;

  assert.equal(oldSignal?.aborted, true);
  assert.deepEqual(received, []);
  assert.equal(result.status, "cancelled");
  if (result.status === "cancelled") assert.equal(result.reason, "session-change");
});

test("starting a new session isolates it from the superseded stream", async () => {
  const controller = new StreamController();
  const received: string[] = [];
  let emitOld: ((value: string) => void) | undefined;

  const oldRun = controller.start<string>({
    sessionId: "session-a",
    runId: "run-a",
    async execute(signal, emit) {
      emitOld = emit;
      await resolveWhenAborted(signal);
    },
    onEvent: (value) => received.push(`old:${value}`)
  });

  const newRun = controller.start<string>({
    sessionId: "session-b",
    runId: "run-b",
    async execute(_signal, emit) {
      emit("new");
    },
    onEvent: (value) => received.push(`new:${value}`)
  });
  emitOld?.("late");

  const [oldResult, newResult] = await Promise.all([oldRun, newRun]);
  assert.equal(oldResult.status, "cancelled");
  assert.equal(newResult.status, "completed");
  assert.deepEqual(received, ["new:new"]);
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
