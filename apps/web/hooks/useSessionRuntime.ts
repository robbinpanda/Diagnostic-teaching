"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  type AnsweredCheckpoint,
  interruptSession,
  streamChat,
  type Checkpoint,
  type RestoredSession,
  type SessionStartResult,
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
  contextStatus: "need_problem" | "need_thought" | "ready";
  problemText: string;
  initialThought: string;
  originalProblemImage: string | null;
};

const EMPTY_SESSION_CONTEXT: SessionContext = {
  sessionId: "",
  contextStatus: "need_problem",
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

export function useSessionRuntime(input: { onRunSettled?: (sessionId: string) => void } = {}) {
  const [context, setContext] = useState<SessionContext>(EMPTY_SESSION_CONTEXT);
  const [runningSessionIds, setRunningSessionIds] = useState<string[]>([]);
  const [pendingCards, setPendingCards] = useState<StudyCard[]>([]);
  const [cardSaveBusy, setCardSaveBusy] = useState(false);
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
    controllerRef.current?.cancelAll("unmount");
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
    imageUrl?: string | null,
    id = messageId()
  ) {
    dispatchTimeline({
      type: "message_added",
      sessionKey: currentSessionKey(),
      message: { id, role, text, action, imageUrl }
    });
  }

  function cancelRun(sessionId: string, reason: StreamCancellationReason) {
    const cancelled = controllerRef.current?.cancel(sessionId, reason);
    if (!cancelled) return null;
    dispatchWorkflow({ type: "run_stop_requested", ...cancelled });
    dispatchTimeline({
      type: "run_cancelled",
      ...cancelled
    });
    dispatchWorkflow({ type: "run_finished", ...cancelled });
    setRunningSessionIds(controllerRef.current?.activeSessionIds ?? []);
    return cancelled;
  }

  function prepareSessionChange() {
    dispatchWorkflow({ type: "session_reset" });
    setPendingCards([]);
    setCardSaveBusy(false);
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
      contextStatus: opened.context_status,
      problemText: opened.problem_text,
      initialThought: opened.student_initial_thought,
      originalProblemImage: opened.problem_image_data_url ?? null
    });
    const firstStudentIndex = opened.messages.findIndex((message) => message.role === "student");
    const hasDurableStudentMessage = firstStudentIndex >= 0;
    const legacyContextMessage =
      !hasDurableStudentMessage && (opened.problem_text || opened.student_initial_thought)
        ? [{
            id: `context-${opened.session_id}`,
            role: "student" as const,
            text: initialContextMessage(opened.problem_text, opened.student_initial_thought),
            imageUrl: opened.problem_image_data_url
          }]
        : [];
    dispatchTimeline({
      type: "session_loaded",
      sessionKey: opened.session_id,
      messages: [
        ...legacyContextMessage,
        ...opened.messages.map((message, index) => ({
          id: message.client_message_id ? `client:${message.client_message_id}` : message.id,
          role: message.role,
          text: message.text,
          action: message.action,
          actionId: message.action_id,
          checkpointResult: message.checkpoint_result ?? undefined,
          imageUrl:
            message.image_data_url
            ?? (index === firstStudentIndex ? opened.problem_image_data_url : undefined)
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
    setPendingCards(opened.pending_cards ?? (opened.pending_card ? [opened.pending_card] : []));
    const activeRun = controllerRef.current?.currentFor(opened.session_id);
    if (activeRun) {
      dispatchTimeline({ type: "run_started", ...activeRun });
      dispatchWorkflow({ type: "run_started", ...activeRun });
    }
  }

  function updateDraft(patch: Partial<Omit<SessionContext, "sessionId">>) {
    if (contextRef.current.sessionId) return;
    replaceContext({ ...contextRef.current, ...patch });
  }

  function bindStartedSession(result: SessionStartResult) {
    if (contextRef.current.sessionId) return false;
    const previousSessionKey = currentSessionKey();
    const nextContext = {
      ...contextRef.current,
      contextStatus: result.context_status,
      problemText: result.problem_text,
      initialThought: result.student_initial_thought,
      sessionId: result.session_id
    };
    replaceContext(nextContext);
    dispatchTimeline({
      type: "session_bound",
      previousSessionKey,
      sessionKey: nextContext.sessionId
    });
    return true;
  }

  function startComposerTask(activity: "start" | "image") {
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
    if (!nextSessionId) return;
    const runId = messageId();
    const adapter = createStreamEventAdapter({ sessionId: nextSessionId, runId });
    let receivedVisibleText = false;
    let receivedCheckpoint = false;
    let receivedCard = false;
    let receivedError = false;

    dispatchTimeline({ type: "run_started", sessionId: nextSessionId, runId });
    dispatchWorkflow({
      type: "run_started",
      sessionId: nextSessionId,
      runId,
      foreground: contextRef.current.sessionId === nextSessionId
    });
    setRunningSessionIds((current) => current.includes(nextSessionId) ? current : [...current, nextSessionId]);

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
            if (contextRef.current.sessionId === nextSessionId) {
              const nextCard = event.data as StudyCard;
              setPendingCards((cards) => [
                ...cards.filter((card) => card.id !== nextCard.id),
                nextCard
              ]);
            }
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
        dispatchTimeline({
          type: "message_added",
          sessionKey: nextSessionId,
          message: {
            id: messageId(),
            role: "system",
            text: "这一轮模型没有返回可见内容，请再说一句你的当前想法。"
          }
        });
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const messageText = error instanceof Error ? error.message : "答疑请求失败";
      dispatchTimeline({ type: "run_failed", sessionId: nextSessionId, runId, message: messageText });
      dispatchWorkflow({ type: "run_failed", sessionId: nextSessionId, runId, message: messageText });
    } finally {
      if (mountedRef.current) {
        setRunningSessionIds(controllerRef.current?.activeSessionIds ?? []);
        onRunSettledRef.current?.(nextSessionId);
      }
    }
  }

  async function stopStream() {
    const activeSessionId = contextRef.current.sessionId;
    const active = activeSessionId
      ? controllerRef.current?.currentFor(activeSessionId)
      : null;
    if (!active) return;
    dispatchWorkflow({ type: "run_stop_requested", ...active });
    let interruptError = "";
    try {
      await interruptSession(active.sessionId);
    } catch (error) {
      interruptError = error instanceof Error ? error.message : "中断生成失败";
    } finally {
      cancelRun(active.sessionId, "user");
    }
    if (mountedRef.current && interruptError) setError(interruptError);
  }

  function beginCheckpointSubmission() {
    dispatchWorkflow({ type: "checkpoint_submit_started" });
  }

  function completeCheckpointSubmission(checkpointResult: AnsweredCheckpoint) {
    dispatchTimeline({ type: "interaction_cleared", sessionKey: currentSessionKey() });
    dispatchWorkflow({ type: "checkpoint_submitted" });
    dispatchTimeline({
      type: "message_added",
      sessionKey: currentSessionKey(),
      message: {
        id: messageId(),
        role: "student",
        text: "",
        action: "CHECKPOINT_RESPONSE",
        checkpointResult
      }
    });
  }

  function completeCheckpointFreeTextSubmission() {
    dispatchTimeline({ type: "interaction_cleared", sessionKey: currentSessionKey() });
    dispatchWorkflow({ type: "checkpoint_submitted" });
  }

  function failCheckpointSubmission(message: string) {
    dispatchWorkflow({ type: "checkpoint_submit_failed", message });
  }

  function beginCardSave() {
    setCardSaveBusy(true);
  }

  function completeCardSave(cardId: string) {
    setPendingCards((cards) => cards.filter((card) => card.id !== cardId));
    setCardSaveBusy(false);
  }

  function failCardSave(message: string) {
    setCardSaveBusy(false);
    dispatchWorkflow({ type: "error_set", message });
  }

  function deferPendingCard(cardId: string, deferredAt: string) {
    setPendingCards((cards) => cards.map((card) => (
      card.id === cardId ? { ...card, deferred_at: deferredAt } : card
    )));
  }

  function setError(message: string) {
    dispatchWorkflow({ type: "error_set", message });
  }

  function clearError() {
    dispatchWorkflow({ type: "error_cleared" });
  }

  function isSessionActive(sessionId: string) {
    return contextRef.current.sessionId === sessionId;
  }

  function isDraftActive() {
    return !contextRef.current.sessionId;
  }

  return {
    ...context,
    messages: timeline.messages,
    timeline,
    workflow,
    error: workflow.error,
    composerBlocked: isComposerBlocked(workflow),
    streamBusy: workflow.mode === "run",
    runningSessionIds,
    checkpoint: workflow.mode === "checkpoint" ? workflow.checkpoint : null,
    checkpointStartedAt: workflow.mode === "checkpoint" ? workflow.startedAt : null,
    activeCard: pendingCards.at(-1) ?? null,
    activeCards: pendingCards,
    cardSaveBusy,
    addMessage,
    bindStartedSession,
    beginCardSave,
    beginCheckpointSubmission,
    clearError,
    clearSession,
    completeCardSave,
    completeCheckpointFreeTextSubmission,
    completeCheckpointSubmission,
    failCardSave,
    deferPendingCard,
    failCheckpointSubmission,
    failComposerTask,
    finishComposerTask,
    loadSession,
    isDraftActive,
    isSessionActive,
    prepareSessionChange,
    runStream,
    setError,
    startComposerTask,
    stopStream,
    updateDraft
  };
}
