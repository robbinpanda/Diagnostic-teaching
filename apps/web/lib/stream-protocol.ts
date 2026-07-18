import type { Checkpoint, SseEvent, StudyCard } from "./api";

export type StreamEventKind =
  | "decision"
  | "message_delta"
  | "message_reset"
  | "checkpoint_ready"
  | "card_ready"
  | "message_done"
  | "error";

export type StreamDecision = {
  state_hint?: string;
  action?: string;
  action_id?: string;
  wait_for_student?: boolean;
  message?: string;
  breakpoint?: string;
  confidence?: number;
  action_index?: number;
};

export type StreamMessageDone = {
  ok: boolean;
  action_index?: number;
  wait_for_student?: boolean;
  will_continue?: boolean;
  awaiting_card_dismissal?: boolean;
  continue_after_card?: boolean;
};

export type StreamEventData = {
  decision: StreamDecision;
  message_delta: { text: string; action_index?: number };
  message_reset: { action_index?: number };
  checkpoint_ready: Checkpoint;
  card_ready: StudyCard;
  message_done: StreamMessageDone;
  error: { message: string; action_index?: number };
};

export type CanonicalStreamEvent<K extends StreamEventKind = StreamEventKind> = {
  kind: K;
  sessionId: string;
  runId: string;
  data: StreamEventData[K];
  actionIndex?: number;
  sequence?: number;
  eventId?: string;
};

export type StreamReplayCursor = {
  afterSeq?: number;
};

export type StreamEventAdapter = {
  adapt(event: SseEvent): CanonicalStreamEvent | null;
};

const KNOWN_EVENTS = new Set<StreamEventKind>([
  "decision",
  "message_delta",
  "message_reset",
  "checkpoint_ready",
  "card_ready",
  "message_done",
  "error"
]);

function optionalInteger(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function eventMetadata(event: SseEvent) {
  const data = event.data as Record<string, unknown>;
  const id = typeof event.id === "string" && event.id.trim() ? event.id.trim() : undefined;
  return {
    actionIndex: optionalInteger(data.action_index),
    sequence: optionalInteger(data.seq) ?? optionalInteger(id),
    eventId: id
  };
}

export function createStreamEventAdapter(input: {
  sessionId: string;
  runId: string;
}): StreamEventAdapter {
  return {
    adapt(event) {
      if (!KNOWN_EVENTS.has(event.event as StreamEventKind)) return null;
      const metadata = eventMetadata(event);
      return {
        kind: event.event as StreamEventKind,
        sessionId: input.sessionId,
        runId: input.runId,
        data: event.data as StreamEventData[StreamEventKind],
        ...metadata
      };
    }
  };
}

export function replayCursorFromSequence(sequence?: number): StreamReplayCursor {
  return sequence === undefined ? {} : { afterSeq: sequence };
}
