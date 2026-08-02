export type StreamCancellationReason = "session-change" | "unmount" | "user" | "student-message" | "superseded";

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
  private activeBySession = new Map<string, ActiveStreamRecord>();

  get current(): ActiveStream | null {
    const active = Array.from(this.activeBySession.values()).at(-1);
    if (!active) return null;
    return { sessionId: active.sessionId, runId: active.runId };
  }

  get activeSessionIds() {
    return Array.from(this.activeBySession.keys());
  }

  currentFor(sessionId: string): ActiveStream | null {
    const active = this.activeBySession.get(sessionId);
    if (!active) return null;
    return { sessionId: active.sessionId, runId: active.runId };
  }

  cancel(sessionId: string, reason: StreamCancellationReason): ActiveStream | null {
    const active = this.activeBySession.get(sessionId);
    if (!active) return null;
    active.reason = reason;
    this.activeBySession.delete(sessionId);
    active.controller.abort(reason);
    return { sessionId: active.sessionId, runId: active.runId };
  }

  cancelAll(reason: StreamCancellationReason) {
    return this.activeSessionIds
      .map((sessionId) => this.cancel(sessionId, reason))
      .filter((stream): stream is ActiveStream => Boolean(stream));
  }

  async start<T>(input: {
    sessionId: string;
    runId: string;
    execute: (signal: AbortSignal, emit: (event: T) => void) => Promise<void>;
    onEvent: (event: T) => void;
  }): Promise<StreamExecutionResult> {
    this.cancel(input.sessionId, "superseded");
    const record: ActiveStreamRecord = {
      sessionId: input.sessionId,
      runId: input.runId,
      controller: new AbortController()
    };
    this.activeBySession.set(input.sessionId, record);

    const emit = (event: T) => {
      if (this.activeBySession.get(input.sessionId) !== record || record.controller.signal.aborted) return;
      input.onEvent(event);
    };

    try {
      await input.execute(record.controller.signal, emit);
      if (record.controller.signal.aborted || this.activeBySession.get(input.sessionId) !== record) {
        return {
          status: "cancelled",
          stream: { sessionId: record.sessionId, runId: record.runId },
          reason: record.reason ?? "superseded"
        };
      }
      this.activeBySession.delete(input.sessionId);
      return {
        status: "completed",
        stream: { sessionId: record.sessionId, runId: record.runId }
      };
    } catch (error) {
      if (record.controller.signal.aborted || isAbortError(error)) {
        if (this.activeBySession.get(input.sessionId) === record) {
          this.activeBySession.delete(input.sessionId);
        }
        return {
          status: "cancelled",
          stream: { sessionId: record.sessionId, runId: record.runId },
          reason: record.reason ?? "superseded"
        };
      }
      if (this.activeBySession.get(input.sessionId) === record) {
        this.activeBySession.delete(input.sessionId);
      }
      throw error;
    }
  }
}
