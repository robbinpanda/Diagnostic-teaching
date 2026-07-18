export type StreamCancellationReason = "session-change" | "unmount" | "user" | "superseded";

export type ActiveStream = {
  sessionId: string;
  runId: string;
};

export type StreamExecutionResult =
  | { status: "completed"; stream: ActiveStream }
  | { status: "cancelled"; stream: ActiveStream; reason: StreamCancellationReason };

type ActiveStreamRecord = ActiveStream & {
  controller: AbortController;
  reason?: StreamCancellationReason;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export class StreamController {
  private active?: ActiveStreamRecord;

  get current(): ActiveStream | null {
    if (!this.active) return null;
    return { sessionId: this.active.sessionId, runId: this.active.runId };
  }

  cancel(reason: StreamCancellationReason): ActiveStream | null {
    const active = this.active;
    if (!active) return null;
    active.reason = reason;
    this.active = undefined;
    active.controller.abort(reason);
    return { sessionId: active.sessionId, runId: active.runId };
  }

  async start<T>(input: {
    sessionId: string;
    runId: string;
    execute: (signal: AbortSignal, emit: (event: T) => void) => Promise<void>;
    onEvent: (event: T) => void;
  }): Promise<StreamExecutionResult> {
    this.cancel("superseded");
    const record: ActiveStreamRecord = {
      sessionId: input.sessionId,
      runId: input.runId,
      controller: new AbortController()
    };
    this.active = record;

    const emit = (event: T) => {
      if (this.active !== record || record.controller.signal.aborted) return;
      input.onEvent(event);
    };

    try {
      await input.execute(record.controller.signal, emit);
      if (record.controller.signal.aborted || this.active !== record) {
        return {
          status: "cancelled",
          stream: { sessionId: record.sessionId, runId: record.runId },
          reason: record.reason ?? "superseded"
        };
      }
      this.active = undefined;
      return {
        status: "completed",
        stream: { sessionId: record.sessionId, runId: record.runId }
      };
    } catch (error) {
      if (record.controller.signal.aborted || isAbortError(error)) {
        if (this.active === record) this.active = undefined;
        return {
          status: "cancelled",
          stream: { sessionId: record.sessionId, runId: record.runId },
          reason: record.reason ?? "superseded"
        };
      }
      if (this.active === record) this.active = undefined;
      throw error;
    }
  }
}
