import type { Checkpoint, StudyCard } from "./api";

type WorkflowBase = { error: string | null };

export type SessionWorkflowState =
  | (WorkflowBase & { mode: "composer"; activity: "idle" | "start" | "image" })
  | (WorkflowBase & {
      mode: "run";
      phase: "streaming" | "stopping";
      sessionId: string;
      runId: string;
      pendingCard: StudyCard | null;
    })
  | (WorkflowBase & {
      mode: "checkpoint";
      phase: "ready" | "submitting";
      checkpoint: Checkpoint;
      startedAt: number;
    })
  | (WorkflowBase & {
      mode: "card";
      phase: "ready" | "saving";
      card: StudyCard;
    });

export type SessionWorkflowAction =
  | { type: "session_reset" }
  | { type: "session_loaded"; pendingCheckpoint?: Checkpoint | null; pendingCard?: StudyCard | null; now: number }
  | { type: "composer_task_started"; activity: "start" | "image" }
  | { type: "composer_task_finished" }
  | { type: "run_started"; sessionId: string; runId: string; foreground?: boolean }
  | { type: "run_stop_requested"; sessionId: string; runId: string }
  | { type: "run_finished"; sessionId: string; runId: string }
  | { type: "run_failed"; sessionId: string; runId: string; message: string }
  | { type: "checkpoint_ready"; sessionId: string; runId: string; checkpoint: Checkpoint; now: number }
  | { type: "checkpoint_submit_started" }
  | { type: "checkpoint_submitted" }
  | { type: "checkpoint_submit_failed"; message: string }
  | { type: "card_buffered"; sessionId: string; runId: string; card: StudyCard }
  | { type: "message_done"; sessionId: string; runId: string }
  | { type: "card_save_started" }
  | { type: "card_saved" }
  | { type: "card_save_failed"; message: string }
  | { type: "error_set"; message: string }
  | { type: "error_cleared" };

export function createSessionWorkflowState(): SessionWorkflowState {
  return { mode: "composer", activity: "idle", error: null };
}

function isMatchingRun(
  state: SessionWorkflowState,
  action: { sessionId: string; runId: string }
): state is Extract<SessionWorkflowState, { mode: "run" }> {
  return state.mode === "run" && state.sessionId === action.sessionId && state.runId === action.runId;
}

export function sessionWorkflowReducer(
  state: SessionWorkflowState,
  action: SessionWorkflowAction
): SessionWorkflowState {
  switch (action.type) {
    case "session_reset":
      return createSessionWorkflowState();
    case "session_loaded":
      if (action.pendingCard) return { mode: "card", phase: "ready", card: action.pendingCard, error: null };
      if (action.pendingCheckpoint) {
        return {
          mode: "checkpoint",
          phase: "ready",
          checkpoint: action.pendingCheckpoint,
          startedAt: action.now,
          error: null
        };
      }
      return createSessionWorkflowState();
    case "composer_task_started":
      if (state.mode !== "composer" || state.activity !== "idle") return state;
      return { mode: "composer", activity: action.activity, error: null };
    case "composer_task_finished":
      if (state.mode !== "composer") return state;
      return createSessionWorkflowState();
    case "run_started":
      if (action.foreground === false) return state;
      if (state.mode !== "composer" || state.activity !== "idle") return state;
      return {
        mode: "run",
        phase: "streaming",
        sessionId: action.sessionId,
        runId: action.runId,
        pendingCard: null,
        error: null
      };
    case "run_stop_requested":
      if (!isMatchingRun(state, action) || state.phase === "stopping") return state;
      return { ...state, phase: "stopping" };
    case "run_finished":
      if (!isMatchingRun(state, action)) return state;
      if (state.pendingCard) return { mode: "card", phase: "ready", card: state.pendingCard, error: null };
      return createSessionWorkflowState();
    case "run_failed":
      if (!isMatchingRun(state, action)) return state;
      return { mode: "composer", activity: "idle", error: action.message };
    case "checkpoint_ready":
      if (!isMatchingRun(state, action)) return state;
      return {
        mode: "checkpoint",
        phase: "ready",
        checkpoint: action.checkpoint,
        startedAt: action.now,
        error: null
      };
    case "checkpoint_submit_started":
      if (state.mode !== "checkpoint" || state.phase !== "ready") return state;
      return { ...state, phase: "submitting", error: null };
    case "checkpoint_submitted":
      if (state.mode !== "checkpoint" || state.phase !== "submitting") return state;
      return createSessionWorkflowState();
    case "checkpoint_submit_failed":
      if (state.mode !== "checkpoint" || state.phase !== "submitting") return state;
      return { ...state, phase: "ready", error: action.message };
    case "card_buffered":
      if (!isMatchingRun(state, action) || state.pendingCard) return state;
      return { ...state, pendingCard: action.card };
    case "message_done":
      if (!isMatchingRun(state, action) || !state.pendingCard) return state;
      return { mode: "card", phase: "ready", card: state.pendingCard, error: null };
    case "card_save_started":
      if (state.mode !== "card" || state.phase !== "ready") return state;
      return { ...state, phase: "saving", error: null };
    case "card_saved":
      if (state.mode !== "card" || state.phase !== "saving") return state;
      return createSessionWorkflowState();
    case "card_save_failed":
      if (state.mode !== "card" || state.phase !== "saving") return state;
      return { ...state, phase: "ready", error: action.message };
    case "error_set":
      return { ...state, error: action.message };
    case "error_cleared":
      if (!state.error) return state;
      return { ...state, error: null };
  }
}

export function isComposerBlocked(state: SessionWorkflowState) {
  return state.mode !== "composer" || state.activity !== "idle";
}
