import type { Checkpoint, StudyCard } from "./api";

type WorkflowBase = { error: string | null };

export type SessionWorkflowState =
  | (WorkflowBase & { mode: "composer"; activity: "idle" | "start" | "image" })
  | (WorkflowBase & {
      mode: "run";
      phase: "streaming" | "stopping";
      sessionId: string;
      runId: string;
    })
  | (WorkflowBase & {
      mode: "checkpoint";
      phase: "ready" | "submitting";
      checkpoint: Checkpoint;
      startedAt: number;
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
  | { type: "message_done"; sessionId: string; runId: string }
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
        error: null
      };
    case "run_stop_requested":
      if (!isMatchingRun(state, action) || state.phase === "stopping") return state;
      return { ...state, phase: "stopping" };
    case "run_finished":
      if (!isMatchingRun(state, action)) return state;
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
    case "message_done":
      return state;
    case "error_set":
      return { ...state, error: action.message };
    case "error_cleared":
      if (!state.error) return state;
      return { ...state, error: null };
  }
}

export function isComposerBlocked(state: SessionWorkflowState) {
  if (state.mode === "checkpoint") return state.phase !== "ready";
  if (state.mode === "run") return state.phase !== "streaming";
  return state.mode !== "composer" || state.activity !== "idle";
}
