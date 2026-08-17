import type { AnsweredCheckpoint, Checkpoint, StudyCard } from "./api";
import type { CanonicalStreamEvent, StreamDecision } from "./stream-protocol";

export type ChatMessage = {
  id: string;
  role: "student" | "assistant" | "system";
  text: string;
  action?: string;
  actionId?: string | null;
  imageUrl?: string | null;
  runId?: string;
  actionIndex?: number;
  streamState?: "streaming" | "complete";
  checkpointResult?: AnsweredCheckpoint;
};

type StreamActionBuffer = {
  messageId: string;
  text: string;
  action?: string;
  actionId?: string;
  retryBaseline: string;
  retryText: string;
  retrying: boolean;
  done: boolean;
};

export type TimelineRunState = {
  sessionId: string;
  runId: string;
  status: "streaming" | "completed" | "cancelled" | "failed";
  currentActionIndex: number;
  actions: Record<number, StreamActionBuffer>;
  seenEventIds: Record<string, true>;
  lastSequence?: number;
  sequenceGap?: { expected: number; received: number };
  progress?: { stage: string; label: string; elapsedMs?: number };
};

export type PendingTimelineInteraction =
  | { kind: "checkpoint"; checkpoint: Checkpoint }
  | { kind: "card"; card: StudyCard };

export type TimelineState = {
  sessionKey: string;
  messages: ChatMessage[];
  run: TimelineRunState | null;
  pendingInteraction: PendingTimelineInteraction | null;
  lastError: string | null;
};

export type TimelineAction =
  | { type: "session_reset"; sessionKey?: string }
  | {
      type: "session_loaded";
      sessionKey: string;
      messages: ChatMessage[];
      pendingCheckpoint?: Checkpoint | null;
      pendingCard?: StudyCard | null;
    }
  | { type: "session_bound"; previousSessionKey: string; sessionKey: string }
  | { type: "message_added"; sessionKey: string; message: ChatMessage }
  | { type: "run_started"; sessionId: string; runId: string }
  | { type: "stream_event"; event: CanonicalStreamEvent }
  | { type: "run_completed"; sessionId: string; runId: string }
  | { type: "run_failed"; sessionId: string; runId: string; message: string }
  | { type: "run_cancelled"; sessionId: string; runId: string }
  | { type: "interaction_cleared"; sessionKey: string };

export const DRAFT_SESSION_KEY = "draft";

export function createTimelineState(sessionKey = DRAFT_SESSION_KEY): TimelineState {
  return {
    sessionKey,
    messages: [],
    run: null,
    pendingInteraction: null,
    lastError: null
  };
}

function streamMessageId(runId: string, actionIndex: number) {
  return `stream:${runId}:${actionIndex}`;
}

function emptyActionBuffer(runId: string, actionIndex: number): StreamActionBuffer {
  return {
    messageId: streamMessageId(runId, actionIndex),
    text: "",
    retryBaseline: "",
    retryText: "",
    retrying: false,
    done: false
  };
}

function upsertAssistantMessage(
  messages: ChatMessage[],
  run: TimelineRunState,
  actionIndex: number,
  buffer: StreamActionBuffer
) {
  const existingIndex = messages.findIndex((message) => message.id === buffer.messageId);
  if (!buffer.text.trim()) {
    return existingIndex < 0 ? messages : messages.filter((message) => message.id !== buffer.messageId);
  }
  const message: ChatMessage = {
    id: buffer.messageId,
    role: "assistant",
    text: buffer.text,
    action: buffer.action,
    actionId: buffer.actionId,
    runId: run.runId,
    actionIndex,
    streamState: buffer.done ? "complete" : "streaming"
  };
  if (existingIndex < 0) return [...messages, message];
  return messages.map((item, index) => index === existingIndex ? message : item);
}

function resolveActionIndex(run: TimelineRunState, event: CanonicalStreamEvent) {
  if (event.actionIndex !== undefined) return event.actionIndex;
  const current = run.actions[run.currentActionIndex];
  if (current?.done && (event.kind === "message_delta" || event.kind === "decision" || event.kind === "message_reset")) {
    return run.currentActionIndex + 1;
  }
  return run.currentActionIndex;
}

function reconcileDecision(buffer: StreamActionBuffer, decision: StreamDecision) {
  let text = buffer.text;
  const finalText = decision.message;
  if (finalText?.trim()) {
    if (buffer.retrying || !text || finalText.startsWith(text) || finalText.length >= text.length) {
      text = finalText;
    }
  }
  return {
    ...buffer,
    text,
    action: decision.action ?? buffer.action,
    actionId: decision.action_id ?? buffer.actionId,
    retryBaseline: "",
    retryText: "",
    retrying: false
  };
}

function registerDelivery(run: TimelineRunState, event: CanonicalStreamEvent) {
  if (event.sequence !== undefined && run.lastSequence !== undefined && event.sequence <= run.lastSequence) {
    return null;
  }
  if (event.eventId && run.seenEventIds[event.eventId]) return null;

  const nextRun: TimelineRunState = {
    ...run,
    seenEventIds: event.eventId
      ? { ...run.seenEventIds, [event.eventId]: true }
      : run.seenEventIds
  };
  if (event.sequence !== undefined) {
    if (run.lastSequence !== undefined && event.sequence > run.lastSequence + 1) {
      nextRun.sequenceGap = { expected: run.lastSequence + 1, received: event.sequence };
    }
    nextRun.lastSequence = event.sequence;
  }
  return nextRun;
}

function applyStreamEvent(state: TimelineState, event: CanonicalStreamEvent): TimelineState {
  const activeRun = state.run;
  if (
    !activeRun ||
    activeRun.status !== "streaming" ||
    activeRun.sessionId !== event.sessionId ||
    activeRun.runId !== event.runId ||
    state.sessionKey !== event.sessionId
  ) return state;

  const registeredRun = registerDelivery(activeRun, event);
  if (!registeredRun) return state;

  const actionIndex = resolveActionIndex(registeredRun, event);
  const existingBuffer = registeredRun.actions[actionIndex] ?? emptyActionBuffer(registeredRun.runId, actionIndex);
  if (existingBuffer.done) return { ...state, run: registeredRun };

  const run: TimelineRunState = {
    ...registeredRun,
    currentActionIndex: Math.max(registeredRun.currentActionIndex, actionIndex),
    actions: { ...registeredRun.actions }
  };
  let messages = state.messages;
  let pendingInteraction = state.pendingInteraction;
  let lastError = state.lastError;
  let buffer = existingBuffer;

  switch (event.kind) {
    case "progress": {
      const nextProgress = event.data as {
        stage: string;
        label: string;
        elapsed_ms?: number;
      };
      run.progress = {
        stage: nextProgress.stage,
        label: nextProgress.label,
        elapsedMs: nextProgress.elapsed_ms
      };
      break;
    }
    case "message_delta": {
      const delta = event.data as { text: string };
      if (!delta.text) break;
      if (buffer.retrying) {
        const retryText = buffer.retryText + delta.text;
        if (buffer.retryBaseline.startsWith(retryText)) {
          buffer = { ...buffer, retryText };
        } else {
          buffer = {
            ...buffer,
            text: retryText,
            retryBaseline: "",
            retryText: "",
            retrying: false
          };
        }
      } else {
        buffer = { ...buffer, text: buffer.text + delta.text };
      }
      break;
    }
    case "message_reset":
      if (buffer.text && !buffer.retrying) {
        buffer = {
          ...buffer,
          retryBaseline: buffer.text,
          retryText: "",
          retrying: true
        };
      }
      break;
    case "decision":
      buffer = reconcileDecision(buffer, event.data as StreamDecision);
      break;
    case "checkpoint_ready": {
      const checkpoint = event.data as Checkpoint;
      if (!pendingInteraction) pendingInteraction = { kind: "checkpoint", checkpoint };
      break;
    }
    case "card_ready": {
      break;
    }
    case "message_done":
      buffer = {
        ...buffer,
        retryBaseline: "",
        retryText: "",
        retrying: false,
        done: true
      };
      break;
    case "stream_complete":
      break;
    case "run_interrupted":
      break;
    case "error": {
      const error = event.data as { message: string };
      lastError = error.message;
      if (buffer.retrying) {
        buffer = {
          ...buffer,
          text: "",
          retryBaseline: "",
          retryText: "",
          retrying: false
        };
      }
      run.status = "failed";
      break;
    }
  }

  run.actions[actionIndex] = buffer;
  messages = upsertAssistantMessage(messages, run, actionIndex, buffer);
  return { ...state, messages, run, pendingInteraction, lastError };
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case "session_reset":
      return createTimelineState(action.sessionKey);
    case "session_loaded":
      return {
        sessionKey: action.sessionKey,
        messages: action.messages,
        run: null,
        pendingInteraction: action.pendingCheckpoint
          ? { kind: "checkpoint", checkpoint: action.pendingCheckpoint }
          : null,
        lastError: null
      };
    case "session_bound":
      if (state.sessionKey !== action.previousSessionKey) return state;
      return { ...state, sessionKey: action.sessionKey, run: null, lastError: null };
    case "message_added":
      if (state.sessionKey !== action.sessionKey) return state;
      if (state.messages.some((message) => message.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message] };
    case "run_started":
      if (state.sessionKey !== action.sessionId) return state;
      return {
        ...state,
        run: {
          sessionId: action.sessionId,
          runId: action.runId,
          status: "streaming",
          currentActionIndex: 0,
          actions: {},
          seenEventIds: {},
          progress: { stage: "reading_problem", label: "正在读取题目" }
        },
        pendingInteraction: null,
        lastError: null
      };
    case "stream_event":
      return applyStreamEvent(state, action.event);
    case "run_completed":
      if (
        !state.run ||
        state.run.sessionId !== action.sessionId ||
        state.run.runId !== action.runId ||
        state.run.status !== "streaming"
      ) return state;
      return {
        ...state,
        run: { ...state.run, status: "completed" },
        messages: state.messages.map((message) => (
          message.runId === action.runId && message.streamState === "streaming"
            ? { ...message, streamState: "complete" }
            : message
        ))
      };
    case "run_failed":
      if (
        !state.run ||
        state.run.sessionId !== action.sessionId ||
        state.run.runId !== action.runId ||
        state.run.status !== "streaming"
      ) return state;
      return {
        ...state,
        run: { ...state.run, status: "failed" },
        lastError: action.message,
        messages: state.messages.map((message) => (
          message.runId === action.runId && message.streamState === "streaming"
            ? { ...message, streamState: "complete" }
            : message
        ))
      };
    case "run_cancelled":
      if (!state.run || state.run.sessionId !== action.sessionId || state.run.runId !== action.runId) return state;
      return {
        ...state,
        run: { ...state.run, status: "cancelled" },
        messages: state.messages.filter((message) => !(
          message.runId === action.runId && message.streamState === "streaming"
        ))
      };
    case "interaction_cleared":
      if (state.sessionKey !== action.sessionKey) return state;
      return { ...state, pendingInteraction: null };
  }
}
