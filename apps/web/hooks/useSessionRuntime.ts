"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  interruptSession,
  streamChat,
  type Checkpoint,
  type RestoredSession,
  type SessionIntakeResult,
  type SseEvent,
  type StudyCard
} from "../lib/api";
import {
  createSessionWorkflowState,
  isComposerBlocked,
  sessionWorkflowReducer
} from "../lib/session-workflow";
import { StreamController, type StreamCancellationReason } from "../lib/stream-controller";
import { createStreamEventAdapter } from "../lib/stream-protocol";
import {
  createTimelineState,
  DRAFT_SESSION_KEY,
  timelineReducer,
  type ChatMessage
} from "../lib/timeline";

type SessionContext = {
  sessionId: string;
  problemText: string;
  initialThought: string;
  originalProblemImage: string | null;
};

const EMPTY_SESSION_CONTEXT: SessionContext = {
  sessionId: "",
  problemText: "",
  initialThought: "",
  originalProblemImage: null
};

function initialContextMessage(problem: string, thought: string) {
  return `题目\n${problem}\n\n我目前想到\n${thought}`;
}

function messageId() {
  return crypto.randomUUID();
}

export function useSessionRuntime(input: { onRunSettled?: () => void } = {}) {
  const [context, setContext] = useState<SessionContext>(EMPTY_SESSION_CONTEXT);
  const [timeline, dispatchTimeline] = useReducer(timelineReducer, undefined, () => createTimelineState());
  const [workflow, dispatchWorkflow] = useReducer(
    sessionWorkflowReducer,
    undefined,
    createSessionWorkflowState
  );
  const controllerRef = useRef<StreamController | null>(null);
  const contextRef = useRef(context);
  const mountedRef = useRef(true);
  const onRunSettledRef = useRef(input.onRunSettled);
  if (!controllerRef.current) controllerRef.current = new StreamController();

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    onRunSettledRef.current = input.onRunSettled;
  }, [input.onRunSettled]);

  useEffect(() => () => {
    mountedRef.current = false;
    controllerRef.current?.cancel("unmount");
  }, []);

  function replaceContext(next: SessionContext) {
    contextRef.current = next;
    setContext(next);
  }

  function currentSessionKey() {
    return contextRef.current.sessionId || DRAFT_SESSION_KEY;
  }

  function addMessage(
    role: ChatMessage["role"],
    text: string,
    action?: string,
    imageUrl?: string | null
  ) {
    dispatchTimeline({
      type: "message_added",
      sessionKey: currentSessionKey(),
      message: { id: messageId(), role, text, action, imageUrl }
    });
  }

  function cancelActiveRun(reason: StreamCancellationReason) {
    const cancelled = controllerRef.current?.cancel(reason);
    if (!cancelled) return null;
    dispatchWorkflow({ type: "run_stop_requested", ...cancelled });
    dispatchTimeline({ type: "run_cancelled", ...cancelled });
    dispatchWorkflow({ type: "run_finished", ...cancelled });
    return cancelled;
  }

  function prepareSessionChange() {
    cancelActiveRun("session-change");
    dispatchWorkflow({ type: "session_reset" });
  }

  function clearSession() {
    prepareSessionChange();
    replaceContext(EMPTY_SESSION_CONTEXT);
    dispatchTimeline({ type: "session_reset", sessionKey: DRAFT_SESSION_KEY });
  }

  function loadSession(opened: RestoredSession) {
    prepareSessionChange();
    replaceContext({
      sessionId: opened.session_id,
      problemText: opened.problem_text,
      initialThought: opened.student_initial_thought,
      originalProblemImage: opened.problem_image_data_url ?? null
    });
    dispatchTimeline({
      type: "session_loaded",
      sessionKey: opened.session_id,
      messages: [
        {
          id: `context-${opened.session_id}`,
          role: "student",
          text: initialContextMessage(opened.problem_text, opened.student_initial_thought),
          imageUrl: opened.problem_image_data_url
        },
        ...opened.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          action: message.action
        }))
      ],
      pendingCheckpoint: opened.pending_checkpoint,
      pendingCard: opened.pending_card
    });
    dispatchWorkflow({
      type: "session_loaded",
      pendingCheckpoint: opened.pending_checkpoint,
      pendingCard: opened.pending_card,
      now: Date.now()
    });
  }

  function updateDraft(patch: Partial<Omit<SessionContext, "sessionId">>) {
    if (contextRef.current.sessionId) return;
    replaceContext({ ...contextRef.current, ...patch });
  }

  function applyIntakeResult(result: SessionIntakeResult) {
    addMessage("assistant", result.assistant_message);
    const previousSessionKey = currentSessionKey();
    const nextContext = {
      ...contextRef.current,
      problemText: result.problem_text,
      initialThought: result.student_initial_thought,
      sessionId: result.status === "ready" && result.session_id ? result.session_id : ""
    };
    replaceContext(nextContext);
    if (nextContext.sessionId) {
      dispatchTimeline({
        type: "session_bound",
        previousSessionKey,
        sessionKey: nextContext.sessionId
      });
    }
  }

  function startComposerTask(activity: "intake" | "image") {
    dispatchWorkflow({ type: "composer_task_started", activity });
  }

  function finishComposerTask() {
    dispatchWorkflow({ type: "composer_task_finished" });
  }

  function failComposerTask(message: string) {
    dispatchWorkflow({ type: "composer_task_finished" });
    dispatchWorkflow({ type: "error_set", message });
  }

  async function runStream(nextSessionId: string, message?: string) {
    if (!nextSessionId || contextRef.current.sessionId !== nextSessionId) return;
    const runId = messageId();
    const adapter = createStreamEventAdapter({ sessionId: nextSessionId, runId });
    let receivedVisibleText = false;
    let receivedCheckpoint = false;
    let receivedCard = false;
    let receivedError = false;

    dispatchTimeline({ type: "run_started", sessionId: nextSessionId, runId });
    dispatchWorkflow({ type: "run_started", sessionId: nextSessionId, runId });

    try {
      const result = await controllerRef.current!.start<SseEvent>({
        sessionId: nextSessionId,
        runId,
        execute: (signal, emit) => streamChat(
          { session_id: nextSessionId, message },
          emit,
          { signal }
        ),
        onEvent(rawEvent) {
          const event = adapter.adapt(rawEvent);
          if (!event) return;
          dispatchTimeline({ type: "stream_event", event });
          if (event.kind === "message_delta") receivedVisibleText = true;
          if (event.kind === "decision") {
            const decision = event.data as { message?: string };
            if (decision.message?.trim()) receivedVisibleText = true;
          }
          if (event.kind === "checkpoint_ready") {
            receivedCheckpoint = true;
            dispatchWorkflow({
              type: "checkpoint_ready",
              sessionId: nextSessionId,
              runId,
              checkpoint: event.data as Checkpoint,
              now: Date.now()
            });
          }
          if (event.kind === "card_ready") {
            receivedCard = true;
            dispatchWorkflow({
              type: "card_buffered",
              sessionId: nextSessionId,
              runId,
              card: event.data as StudyCard
            });
          }
          if (event.kind === "message_done") {
            dispatchWorkflow({ type: "message_done", sessionId: nextSessionId, runId });
          }
          if (event.kind === "error") {
            receivedError = true;
            const error = event.data as { message: string };
            dispatchWorkflow({
              type: "run_failed",
              sessionId: nextSessionId,
              runId,
              message: error.message
            });
          }
          if (event.kind === "run_interrupted") {
            receivedError = true;
            dispatchTimeline({ type: "run_cancelled", sessionId: nextSessionId, runId });
            dispatchWorkflow({ type: "run_finished", sessionId: nextSessionId, runId });
          }
        }
      });

      if (!mountedRef.current) return;
      if (result.status === "cancelled") {
        dispatchTimeline({ type: "run_cancelled", ...result.stream });
        dispatchWorkflow({ type: "run_finished", ...result.stream });
        return;
      }

      dispatchTimeline({ type: "run_completed", ...result.stream });
      dispatchWorkflow({ type: "run_finished", ...result.stream });
      if (!receivedVisibleText && !receivedCheckpoint && !receivedCard && !receivedError) {
        addMessage("system", "这一轮模型没有返回可见内容，请再说一句你的当前想法。");
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const messageText = error instanceof Error ? error.message : "答疑请求失败";
      dispatchTimeline({ type: "run_failed", sessionId: nextSessionId, runId, message: messageText });
      dispatchWorkflow({ type: "run_failed", sessionId: nextSessionId, runId, message: messageText });
    } finally {
      if (mountedRef.current) onRunSettledRef.current?.();
    }
  }

  async function stopStream() {
    const active = controllerRef.current?.current;
    if (!active) return;
    dispatchWorkflow({ type: "run_stop_requested", ...active });
    let interruptError = "";
    try {
      await interruptSession(active.sessionId);
    } catch (error) {
      interruptError = error instanceof Error ? error.message : "中断生成失败";
    } finally {
      cancelActiveRun("user");
    }
    if (mountedRef.current && interruptError) setError(interruptError);
  }

  function beginCheckpointSubmission() {
    dispatchWorkflow({ type: "checkpoint_submit_started" });
  }

  function completeCheckpointSubmission(studentMessage: string) {
    dispatchTimeline({ type: "interaction_cleared", sessionKey: currentSessionKey() });
    dispatchWorkflow({ type: "checkpoint_submitted" });
    addMessage("student", studentMessage, "CHECKPOINT_RESPONSE");
  }

  function failCheckpointSubmission(message: string) {
    dispatchWorkflow({ type: "checkpoint_submit_failed", message });
  }

  function beginCardSave() {
    dispatchWorkflow({ type: "card_save_started" });
  }

  function completeCardSave() {
    dispatchTimeline({ type: "interaction_cleared", sessionKey: currentSessionKey() });
    dispatchWorkflow({ type: "card_saved" });
  }

  function failCardSave(message: string) {
    dispatchWorkflow({ type: "card_save_failed", message });
  }

  function setError(message: string) {
    dispatchWorkflow({ type: "error_set", message });
  }

  function clearError() {
    dispatchWorkflow({ type: "error_cleared" });
  }

  return {
    ...context,
    messages: timeline.messages,
    timeline,
    workflow,
    error: workflow.error,
    composerBlocked: isComposerBlocked(workflow),
    streamBusy: workflow.mode === "run",
    checkpoint: workflow.mode === "checkpoint" ? workflow.checkpoint : null,
    checkpointStartedAt: workflow.mode === "checkpoint" ? workflow.startedAt : null,
    activeCard: workflow.mode === "card" ? workflow.card : null,
    addMessage,
    applyIntakeResult,
    beginCardSave,
    beginCheckpointSubmission,
    clearError,
    clearSession,
    completeCardSave,
    completeCheckpointSubmission,
    failCardSave,
    failCheckpointSubmission,
    failComposerTask,
    finishComposerTask,
    loadSession,
    prepareSessionChange,
    runStream,
    setError,
    startComposerTask,
    stopStream,
    updateDraft
  };
}
