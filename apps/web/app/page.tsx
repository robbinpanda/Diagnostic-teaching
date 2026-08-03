"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CardMoveDialog } from "../components/CardMoveDialog";
import { CheckpointModal } from "../components/CheckpointModal";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
import { ProblemImageSelector } from "../components/ProblemImageSelector";
import { ProblemImageViewer } from "../components/ProblemImageViewer";
import { StudyCardModal } from "../components/StudyCardModal";
import {
  LearningCardExportDialog,
  type LearningCardExportLayout
} from "../components/LearningCardExportDialog";
import { LearningCardPrintView } from "../components/LearningCardPrintView";
import { ConversationHeader } from "../components/workspace/ConversationHeader";
import { MessageTimeline } from "../components/workspace/MessageTimeline";
import { SessionSidebar } from "../components/workspace/SessionSidebar";
import { StudyCardSidebar } from "../components/workspace/StudyCardSidebar";
import { TutorComposer } from "../components/workspace/TutorComposer";
import { useModelProfiles } from "../hooks/useModelProfiles";
import { useSessionRuntime } from "../hooks/useSessionRuntime";
import { useSpeechInput } from "../hooks/useSpeechInput";
import { useStudyCards } from "../hooks/useStudyCards";
import {
  acceptStudentMessage,
  analyzeProblemText,
  answerCheckpoint,
  batchStartImageSessions,
  batchStartSessions,
  deleteAllSessions,
  deleteSession,
  detectProblemImageRegions,
  dismissKnowledgeCardAndContinue,
  fetchSession,
  fetchSessionHistory,
  fetchSessionRunStatus,
  isApiResponseError,
  saveCard,
  DetectedProblemRegion,
  SessionHistoryItem,
  SessionStartResult,
  StudyCard,
  updateKnowledgeCard
} from "../lib/api";
import {
  clearAllRequestRecovery,
  clearComposerDraft,
  clearPendingSessionBatch,
  clearPendingStudentRequest,
  clearPendingStudentRequestsForSession,
  listPendingStudentRequests,
  loadActiveSessionId,
  loadComposerDraft,
  loadPendingSessionBatch,
  type PendingSessionBatch,
  type PendingStudentRequest,
  saveActiveSessionId,
  saveComposerDraft,
  savePendingSessionBatch,
  savePendingStudentRequest
} from "../lib/request-recovery";

type LearningCardPrintJob = {
  cards: StudyCard[];
  layout: LearningCardExportLayout;
};

type PendingImageSelection = {
  imageUrl: string;
  contentType: string;
  filename: string;
  profileId: string;
  gradeBand: "junior" | "senior";
  viewToken: number;
  regions: DetectedProblemRegion[];
  startItems?: Array<{
    session_id: string;
    client_message_id: string;
    bbox: DetectedProblemRegion["bbox"];
  }>;
};

type PendingComposerImage = {
  dataUrl: string;
  file: File;
};

const DRAFT_SCOPE = "draft";
const RECOVERABLE_RUN_CODES = new Set(["client_disconnected", "process_restarted"]);

export default function Home() {
  const [gradeBand, setGradeBand] = useState<"junior" | "senior">("junior");
  const [input, setInput] = useState("");
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [openSessionBusyId, setOpenSessionBusyId] = useState("");
  const [deleteSessionBusyId, setDeleteSessionBusyId] = useState("");
  const [deleteAllSessionsBusy, setDeleteAllSessionsBusy] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [learningCardExportOpen, setLearningCardExportOpen] = useState(false);
  const [learningCardPrintJob, setLearningCardPrintJob] = useState<LearningCardPrintJob | null>(null);
  const [imageSelection, setImageSelection] = useState<PendingImageSelection | null>(null);
  const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
  const [pendingComposerImage, setPendingComposerImage] = useState<PendingComposerImage | null>(null);
  const [imageConfirmBusy, setImageConfirmBusy] = useState(false);
  const [viewingCardSaveBusy, setViewingCardSaveBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const sendInFlightKeysRef = useRef(new Set<string>());
  const pendingStudentMessagesRef = useRef(new Map<string, PendingStudentRequest>());
  const pendingSessionBatchesRef = useRef(new Map<number, PendingSessionBatch>());
  const openSessionRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const viewTokenRef = useRef(0);
  const speechBaseInputRef = useRef("");
  const runtime = useSessionRuntime({ onRunSettled: () => void refreshHistory() });
  const {
    activeCard,
    cardSaveBusy,
    checkpoint,
    checkpointStartedAt,
    composerBlocked,
    error,
    messages,
    originalProblemImage,
    pendingInterruption,
    runningSessionIds,
    sessionId,
    streamBusy,
    workflow
  } = runtime;

  function draftScope(targetSessionId = sessionId) {
    return targetSessionId || DRAFT_SCOPE;
  }

  function updateComposerInput(value: string, scope = draftScope()) {
    setInput(value);
    saveComposerDraft(window.localStorage, scope, value);
  }

  function clearComposerInput(scope = draftScope()) {
    setInput("");
    clearComposerDraft(window.localStorage, scope);
  }

  function restoreComposerInput(value: string, scope = draftScope()) {
    setInput((current) => {
      const nextValue = current || value;
      saveComposerDraft(window.localStorage, scope, nextValue);
      return nextValue;
    });
  }

  const speechInput = useSpeechInput({
    onRecordingStart: () => {
      speechBaseInputRef.current = input;
      runtime.clearError();
    },
    onTranscript: (transcript) => {
      const nextText = transcript.trim();
      if (!nextText) return;
      const baseText = speechBaseInputRef.current;
      updateComposerInput(baseText.trim()
        ? `${baseText.trimEnd()} ${nextText}`
        : nextText);
      runtime.clearError();
    },
    onError: runtime.setError
  });
  const profilesState = useModelProfiles({
    activeSessionId: sessionId,
    onError: runtime.setError,
    onClearError: runtime.clearError
  });
  const cardsState = useStudyCards({
    onError: runtime.setError,
    onClearError: runtime.clearError
  });
  const {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    multimodalProfiles,
    dialogOpen,
    closeProfileDialog,
    editingProfile,
    deleteBusy,
    reasoningBusy,
    refreshProfiles,
    openNewProfileDialog,
    openSelectedProfileDialog,
    deleteProfiles,
    setReasoningEffort
  } = profilesState;
  const {
    cards,
    folders,
    currentFolderId,
    setCurrentFolderId,
    visibleFolders,
    visibleCards,
    viewingCard,
    setViewingCard,
    movingCard,
    setMovingCard,
    clipboard,
    setClipboard,
    cardBusyId,
    folderBusyId,
    pasteBusy,
    deleteAllCardsBusy,
    refreshCards,
    upsertCard,
    createFolder,
    renameFolder,
    deleteFolder,
    moveCardToFolder,
    pasteCard,
    deleteCard: handleDeleteCard,
    deleteAllCards: handleDeleteAllCards
  } = cardsState;
  const startBusy = workflow.mode === "composer" && workflow.activity === "start";
  const imageBusy = workflow.mode === "composer" && workflow.activity === "image";
  const stopBusy = workflow.mode === "run" && workflow.phase === "stopping";
  const anySessionRunning = runningSessionIds.length > 0;

  const activeHistory = useMemo(
    () => historyItems.find((item) => item.session_id === sessionId),
    [historyItems, sessionId]
  );

  useEffect(() => {
    refreshProfiles();
    refreshCards();
    void restoreWorkspaceAfterRefresh();
    if (window.innerWidth <= 1120) setRightOpen(false);
    if (window.innerWidth <= 760) setLeftOpen(false);
    // Initial bootstrap only; later refreshes are triggered by explicit mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: streamBusy ? "auto" : "smooth" });
  }, [activeCard?.id, checkpoint?.id, messages, streamBusy]);

  useEffect(() => {
    if (activeCard || checkpoint) setViewingCard(null);
  }, [activeCard, checkpoint, setViewingCard]);

  useEffect(() => {
    if (!learningCardPrintJob) return;

    let cancelled = false;
    const previousTitle = document.title;
    document.title = "我的数学学习卡片";
    const handleAfterPrint = () => setLearningCardPrintJob(null);
    window.addEventListener("afterprint", handleAfterPrint);

    async function openPrintDialog() {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!cancelled) window.print();
    }

    void openPrintDialog();
    return () => {
      cancelled = true;
      document.title = previousTitle;
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [learningCardPrintJob]);

  async function waitForActiveRunToSettle(targetSessionId: string) {
    let status = await fetchSessionRunStatus(targetSessionId);
    for (let attempt = 0; status.active && attempt < 120; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
      status = await fetchSessionRunStatus(targetSessionId);
    }
    return status;
  }

  function sessionNeedsResponse(opened: Awaited<ReturnType<typeof fetchSession>>) {
    if (opened.pending_checkpoint || opened.pending_card) return false;
    const lastStudentIndex = opened.messages.findLastIndex((message) => message.role === "student");
    if (lastStudentIndex < 0) return false;
    return !opened.messages.slice(lastStudentIndex + 1).some((message) => message.role === "assistant");
  }

  async function recoverSessionRun(targetSessionId: string, foreground: boolean) {
    let status = await waitForActiveRunToSettle(targetSessionId);
    const opened = await fetchSession(targetSessionId);
    if (foreground && runtime.isSessionActive(targetSessionId)) runtime.loadSession(opened);

    if (status.active) {
      if (foreground) runtime.setError("后台请求仍在执行；会话内容已经保存在 SQLite，请稍后重新打开查看结果。");
      return;
    }

    const errorCode = status.run?.error?.code ?? "";
    const shouldResume = (
      RECOVERABLE_RUN_CODES.has(errorCode)
      && (status.run?.last_committed_action_index ?? -1) < 0
    )
      || (!status.run && sessionNeedsResponse(opened));
    if (!shouldResume || opened.pending_checkpoint || opened.pending_card) return;

    await runtime.runStream(targetSessionId);
    status = await fetchSessionRunStatus(targetSessionId);
    if (!status.active && foreground && runtime.isSessionActive(targetSessionId)) {
      runtime.loadSession(await fetchSession(targetSessionId));
    }
  }

  async function restoreSessionAfterRefresh(targetSessionId: string) {
    const opened = await fetchSession(targetSessionId);
    runtime.loadSession(opened);
    setSelectedProfileId(opened.model_profile_id);
    setGradeBand(opened.grade_band);
    saveActiveSessionId(window.localStorage, opened.session_id);
    setInput(loadComposerDraft(window.localStorage, draftScope(opened.session_id)));
    await recoverSessionRun(opened.session_id, true);
  }

  async function resumePendingStudentRequest(pending: PendingStudentRequest) {
    await acceptStudentMessage({
      session_id: pending.sessionId,
      client_message_id: pending.clientMessageId,
      message: pending.text
    });
    clearPendingStudentRequest(window.localStorage, pending.operationId);
  }

  async function submitPendingSessionBatch(
    initialBatch: PendingSessionBatch,
    originatingViewToken: number
  ) {
    let pendingBatch = initialBatch;
    if (!pendingBatch.sessions) {
      const analyzed = await analyzeProblemText({
        model_profile_id: pendingBatch.profileId,
        text: pendingBatch.text
      });
      pendingBatch = {
        ...pendingBatch,
        sessions: analyzed.problems.map((problem) => {
          const thought = problem.student_initial_thought.trim();
          return {
            session_id: `sess_${crypto.randomUUID().replaceAll("-", "")}`,
            client_message_id: crypto.randomUUID(),
            grade_band: pendingBatch.gradeBand,
            subject: "math" as const,
            model_profile_id: pendingBatch.profileId,
            message: thought
              ? `${problem.problem_text}\n\n我的思路：${thought}`
              : problem.problem_text,
            problem_text: problem.problem_text,
            student_initial_thought: thought,
            problem_image_data_url: null
          };
        })
      };
      pendingSessionBatchesRef.current.set(originatingViewToken, pendingBatch);
      savePendingSessionBatch(window.localStorage, pendingBatch);
    }

    if (!pendingBatch.sessions?.length) throw new Error("拆题模型没有返回可创建的题目");
    const result = await batchStartSessions(pendingBatch.sessions);
    clearPendingSessionBatch(window.localStorage, pendingBatch.operationId);
    pendingSessionBatchesRef.current.delete(originatingViewToken);
    saveActiveSessionId(window.localStorage, result.sessions[0]?.session_id ?? "");
    await finishSessionBatchStart(result.sessions, originatingViewToken);
  }

  async function restoreWorkspaceAfterRefresh() {
    const recoveredSessionIds: string[] = [];
    const pendingBatch = loadPendingSessionBatch(window.localStorage);
    if (pendingBatch) {
      const token = viewTokenRef.current;
      pendingSessionBatchesRef.current.set(token, pendingBatch);
      setSelectedProfileId(pendingBatch.profileId);
      setGradeBand(pendingBatch.gradeBand);
      runtime.addMessage("student", pendingBatch.text, undefined, undefined, `recovery:${pendingBatch.operationId}`);
      runtime.startComposerTask("start");
      try {
        await submitPendingSessionBatch(pendingBatch, token);
        clearComposerDraft(window.localStorage, DRAFT_SCOPE);
      } catch (nextError) {
        updateComposerInput(pendingBatch.text, DRAFT_SCOPE);
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "恢复待提交请求失败");
      }
    }

    for (const pending of listPendingStudentRequests(window.localStorage)) {
      try {
        await resumePendingStudentRequest(pending);
        recoveredSessionIds.push(pending.sessionId);
      } catch (nextError) {
        if (isApiResponseError(nextError, 404)) {
          clearPendingStudentRequest(window.localStorage, pending.operationId);
          clearPendingStudentRequestsForSession(window.localStorage, pending.sessionId);
          if (!loadComposerDraft(window.localStorage, DRAFT_SCOPE)) {
            saveComposerDraft(window.localStorage, DRAFT_SCOPE, pending.text);
          }
          if (loadActiveSessionId(window.localStorage) === pending.sessionId) {
            saveActiveSessionId(window.localStorage, "");
          }
          continue;
        }
        saveActiveSessionId(window.localStorage, pending.sessionId);
        updateComposerInput(pending.text, draftScope(pending.sessionId));
        runtime.setError(nextError instanceof Error ? nextError.message : "恢复待提交消息失败");
      }
    }

    if (!pendingBatch) {
      const activeSessionId = loadActiveSessionId(window.localStorage)
        || recoveredSessionIds.at(-1)
        || "";
      if (activeSessionId) {
        try {
          await restoreSessionAfterRefresh(activeSessionId);
        } catch (nextError) {
          saveActiveSessionId(window.localStorage, "");
          setInput(loadComposerDraft(window.localStorage, DRAFT_SCOPE));
          if (isApiResponseError(nextError, 404)) {
            clearPendingStudentRequestsForSession(window.localStorage, activeSessionId);
            runtime.clearSession();
            runtime.clearError();
          } else {
            runtime.setError(nextError instanceof Error ? nextError.message : "恢复当前会话失败");
          }
        }
      } else {
        setInput(loadComposerDraft(window.localStorage, DRAFT_SCOPE));
      }
    }

    for (const recoveredSessionId of recoveredSessionIds) {
      if (recoveredSessionId !== loadActiveSessionId(window.localStorage)) {
        void recoverSessionRun(recoveredSessionId, false);
      }
    }
    await refreshHistory();
  }

  async function refreshHistory() {
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    setHistoryBusy(true);
    try {
      const nextItems = await fetchSessionHistory();
      if (historyRequestRef.current === requestId) setHistoryItems(nextItems);
    } catch (nextError) {
      if (historyRequestRef.current === requestId) {
        runtime.setError(nextError instanceof Error ? nextError.message : "历史会话加载失败");
      }
    } finally {
      if (historyRequestRef.current === requestId) setHistoryBusy(false);
    }
  }

  function clearCurrentSessionState() {
    openSessionRequestRef.current += 1;
    const previousViewToken = viewTokenRef.current;
    viewTokenRef.current += 1;
    pendingSessionBatchesRef.current.delete(previousViewToken);
    setImageSelection(null);
    setViewerImageUrl(null);
    setPendingComposerImage(null);
    setImageConfirmBusy(false);
    setOpenSessionBusyId("");
    runtime.clearSession();
    saveActiveSessionId(window.localStorage, "");
    setInput(loadComposerDraft(window.localStorage, DRAFT_SCOPE));
    setViewingCard(null);
    runtime.clearError();
  }

  async function handleOpenSession(nextSessionId: string) {
    if (nextSessionId === sessionId) return;
    const requestId = openSessionRequestRef.current + 1;
    openSessionRequestRef.current = requestId;
    viewTokenRef.current += 1;
    setViewerImageUrl(null);
    setPendingComposerImage(null);
    setOpenSessionBusyId(nextSessionId);
    runtime.clearError();
    try {
      const opened = await fetchSession(nextSessionId);
      if (openSessionRequestRef.current !== requestId) return;
      runtime.loadSession(opened);
      setSelectedProfileId(opened.model_profile_id);
      setGradeBand(opened.grade_band);
      saveActiveSessionId(window.localStorage, opened.session_id);
      setInput(loadComposerDraft(window.localStorage, draftScope(opened.session_id)));
      setViewingCard(null);
      await recoverSessionRun(opened.session_id, true);
    } catch (nextError) {
      if (openSessionRequestRef.current !== requestId) return;
      if (isApiResponseError(nextError, 404)) {
        setHistoryItems((current) => current.filter(
          (candidate) => candidate.session_id !== nextSessionId
        ));
        clearPendingStudentRequestsForSession(window.localStorage, nextSessionId);
        if (loadActiveSessionId(window.localStorage) === nextSessionId) {
          clearCurrentSessionState();
        } else {
          runtime.clearError();
        }
      } else {
        runtime.setError(nextError instanceof Error ? nextError.message : "打开会话失败");
      }
    } finally {
      if (openSessionRequestRef.current === requestId) setOpenSessionBusyId("");
    }
  }

  async function handleDeleteSession(item: SessionHistoryItem) {
    if (!window.confirm(`删除会话“${item.title || "未命名题目"}”？已归档卡片会保留。`)) return;
    setDeleteSessionBusyId(item.session_id);
    runtime.clearError();
    try {
      await deleteSession(item.session_id);
      clearPendingStudentRequestsForSession(window.localStorage, item.session_id);
      clearComposerDraft(window.localStorage, draftScope(item.session_id));
      setHistoryItems((current) => current.filter((candidate) => candidate.session_id !== item.session_id));
      if (sessionId === item.session_id) clearCurrentSessionState();
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "删除会话失败");
    } finally {
      setDeleteSessionBusyId("");
    }
  }

  async function handleDeleteAllSessions() {
    if (!window.confirm("清空全部会话？会话、消息、检查点和诊断日志会永久删除，已归档卡片会保留。")) return;
    setDeleteAllSessionsBusy(true);
    runtime.clearError();
    try {
      await deleteAllSessions();
      clearAllRequestRecovery(window.localStorage);
      setHistoryItems([]);
      clearCurrentSessionState();
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "清空全部会话失败");
    } finally {
      setDeleteAllSessionsBusy(false);
    }
  }

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function finishSessionBatchStart(
    results: SessionStartResult[],
    originatingViewToken: number
  ) {
    if (!results.length) return;
    if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
      try {
        const opened = await fetchSession(results[0].session_id);
        if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
          runtime.loadSession(opened);
          setSelectedProfileId(opened.model_profile_id);
          setGradeBand(opened.grade_band);
          saveActiveSessionId(window.localStorage, opened.session_id);
          setInput(loadComposerDraft(window.localStorage, draftScope(opened.session_id)));
        }
      } catch {
        if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
          runtime.bindStartedSession(results[0]);
          saveActiveSessionId(window.localStorage, results[0].session_id);
          setInput(loadComposerDraft(window.localStorage, draftScope(results[0].session_id)));
          runtime.finishComposerTask();
        }
      }
    }
    await refreshHistory();
    for (const result of results) void runtime.runStream(result.session_id);
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !pendingComposerImage) || composerBlocked) return;
    if (!selectedProfileId) {
      runtime.setError("请先在输入框下方选择一个模型；如果还没有模型，请打开设置添加。");
      return;
    }
    if (pendingComposerImage) {
      if (text) {
        runtime.setError("图片题目暂不支持同时附带文字，请先清空文字或移除图片。");
        return;
      }
      await handlePendingImageSend(pendingComposerImage);
      return;
    }
    if (originalProblemImage && !selectedProfile?.is_multimodal) {
      runtime.setError("这道题带有原图，请选择支持图片识别的多模态模型。");
      return;
    }
    const originatingViewToken = viewTokenRef.current;
    const operationKey = sessionId ? `session:${sessionId}` : `draft:${originatingViewToken}`;
    if (sendInFlightKeysRef.current.has(operationKey)) return;
    sendInFlightKeysRef.current.add(operationKey);
    if (sessionId) {
      const targetSessionId = sessionId;
      if (streamBusy) {
        const interrupted = await runtime.interruptForStudentMessage();
        if (!interrupted) {
          setInput((current) => current || text);
          sendInFlightKeysRef.current.delete(operationKey);
          return;
        }
      }
      const respondsToCheckpoint = workflow.mode === "checkpoint" && workflow.phase === "ready";
      const previous = pendingStudentMessagesRef.current.get(targetSessionId)
        ?? listPendingStudentRequests(window.localStorage).find(
          (candidate) => candidate.sessionId === targetSessionId && candidate.text === text
        );
      const isRetry = previous?.sessionId === sessionId && previous.text === text;
      const pending = isRetry
        ? previous
        : {
            operationId: crypto.randomUUID(),
            sessionId: targetSessionId,
            text,
            clientMessageId: crypto.randomUUID(),
            createdAt: new Date().toISOString()
          };
      pendingStudentMessagesRef.current.set(targetSessionId, pending);
      savePendingStudentRequest(window.localStorage, pending);
      clearComposerInput(draftScope(targetSessionId));
      if (!isRetry) {
        runtime.addMessage(
          "student",
          text,
          "STUDENT_RESPONSE",
          undefined,
          `client:${pending.clientMessageId}`
        );
      }
      if (respondsToCheckpoint) runtime.beginCheckpointSubmission();
      try {
        const accepted = await acceptStudentMessage({
          session_id: targetSessionId,
          client_message_id: pending.clientMessageId,
          message: text
        });
        if (accepted.deferred_card_id && accepted.card_deferred_at) {
          runtime.deferPendingCard(accepted.deferred_card_id, accepted.card_deferred_at);
        }
        if (accepted.interruption_id) runtime.activateInterruption(accepted.interruption_id);
        pendingStudentMessagesRef.current.delete(targetSessionId);
        if (respondsToCheckpoint) runtime.completeCheckpointFreeTextSubmission();
        clearPendingStudentRequest(window.localStorage, pending.operationId);
        await runtime.runStream(targetSessionId);
      } catch (nextError) {
        if (runtime.isSessionActive(targetSessionId)) {
          restoreComposerInput(text, draftScope(targetSessionId));
          if (respondsToCheckpoint) {
            runtime.failCheckpointSubmission(
              nextError instanceof Error ? nextError.message : "提交文字回应失败"
            );
          }
          runtime.setError(nextError instanceof Error ? nextError.message : "提交消息失败");
        }
      } finally {
        sendInFlightKeysRef.current.delete(operationKey);
      }
      return;
    }

    const previousBatch = pendingSessionBatchesRef.current.get(originatingViewToken);
    const isStartRetry = Boolean(
      previousBatch
      && previousBatch.text === text
      && previousBatch.profileId === selectedProfileId
      && previousBatch.gradeBand === gradeBand
    );
    const pendingBatch: PendingSessionBatch = isStartRetry && previousBatch
      ? previousBatch
      : {
          operationId: crypto.randomUUID(),
          text,
          profileId: selectedProfileId,
          gradeBand,
          createdAt: new Date().toISOString()
        };
    pendingSessionBatchesRef.current.set(originatingViewToken, pendingBatch);
    savePendingSessionBatch(window.localStorage, pendingBatch);
    clearComposerInput(DRAFT_SCOPE);
    if (!isStartRetry) {
      runtime.addMessage(
        "student",
        text,
        undefined,
        undefined,
        `client:batch-${crypto.randomUUID()}`
      );
    }
    runtime.startComposerTask("start");
    runtime.clearError();
    try {
      await submitPendingSessionBatch(pendingBatch, originatingViewToken);
    } catch (nextError) {
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        restoreComposerInput(text, DRAFT_SCOPE);
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "拆题或创建答疑会话失败");
      } else {
        pendingSessionBatchesRef.current.delete(originatingViewToken);
      }
    } finally {
      sendInFlightKeysRef.current.delete(operationKey);
    }
  }

  async function handleImageFile(file?: File) {
    if (!file) return;
    if (sessionId) {
      runtime.setError("当前答疑暂不支持追加图片，请新建答疑后再粘贴或上传。");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    if (input.trim()) {
      runtime.setError("请先清空输入框中的文字，再添加题目图片。");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    if (pendingComposerImage) {
      runtime.setError("一次只能添加一张题目图片，请先移除当前图片。");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      runtime.setError("仅支持 PNG、JPEG 或 WebP 格式的题目图片。");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    runtime.clearError();
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPendingComposerImage({ dataUrl, file });
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "图片读取失败");
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function handlePastedImages(files: File[]) {
    if (!files.length) return;
    if (files.length > 1) {
      runtime.setError("一次只能粘贴一张题目图片。");
      return;
    }
    void handleImageFile(files[0]);
  }

  async function handlePendingImageSend(pendingImage: PendingComposerImage) {
    if (sessionId) return;
    if (!selectedProfile?.is_multimodal) {
      runtime.setError(
        multimodalProfiles.length
          ? "请先选中一个支持图片识别的多模态模型，再上传题目图片。"
          : "上传图片需要多模态模型，请先在模型设置中添加并标记“支持图片识别”。"
      );
      return;
    }
    const visionProfile = selectedProfile;
    const originatingViewToken = viewTokenRef.current;
    const operationKey = `draft:${originatingViewToken}`;
    if (sendInFlightKeysRef.current.has(operationKey)) return;
    sendInFlightKeysRef.current.add(operationKey);
    const targetGradeBand = gradeBand;
    runtime.startComposerTask("image");
    runtime.clearError();
    try {
      const detected = await detectProblemImageRegions({
        model_profile_id: visionProfile.id,
        image_base64: pendingImage.dataUrl,
        content_type: pendingImage.file.type || "image/png",
        filename: pendingImage.file.name || "clipboard-image.png"
      });
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        setImageSelection({
          imageUrl: pendingImage.dataUrl,
          contentType: pendingImage.file.type || "image/png",
          filename: pendingImage.file.name || "clipboard-image.png",
          profileId: visionProfile.id,
          gradeBand: targetGradeBand,
          viewToken: originatingViewToken,
          regions: detected.problems
        });
        setPendingComposerImage(null);
        runtime.finishComposerTask();
      }
    } catch (nextError) {
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "题目框检测失败");
      }
    } finally {
      sendInFlightKeysRef.current.delete(operationKey);
    }
  }

  async function handleConfirmImageRegions(regions: DetectedProblemRegion[]) {
    if (!imageSelection || imageConfirmBusy || !regions.length) return;
    const selection = imageSelection;
    const startItems = selection.startItems ?? regions.map((region) => ({
      session_id: `sess_${crypto.randomUUID().replaceAll("-", "")}`,
      client_message_id: crypto.randomUUID(),
      bbox: region.bbox
    }));
    setImageSelection({ ...selection, regions, startItems });
    setImageConfirmBusy(true);
    runtime.clearError();
    try {
      const result = await batchStartImageSessions({
        grade_band: selection.gradeBand,
        subject: "math",
        model_profile_id: selection.profileId,
        source_image_data_url: selection.imageUrl,
        items: startItems
      });
      setImageSelection(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
      await finishSessionBatchStart(result.sessions, selection.viewToken);
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "裁剪图片或创建答疑会话失败");
    } finally {
      setImageConfirmBusy(false);
    }
  }

  async function handleCheckpoint(optionId: string) {
    if (!checkpoint || !sessionId || workflow.mode !== "checkpoint" || workflow.phase !== "ready") return;
    const targetSessionId = sessionId;
    const activeCheckpoint = checkpoint;
    const startedAt = checkpointStartedAt;
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    runtime.beginCheckpointSubmission();
    try {
      const answer = await answerCheckpoint({
        checkpointId: activeCheckpoint.id,
        session_id: targetSessionId,
        selected_option_id: optionId,
        elapsed_ms: elapsed
      });
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.completeCheckpointSubmission({
          checkpoint: activeCheckpoint,
          selected_option_id: optionId,
          is_correct: answer.is_correct
        });
      }
      await runtime.runStream(targetSessionId);
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.failCheckpointSubmission(nextError instanceof Error ? nextError.message : "提交检查点失败");
      }
    }
  }

  async function handleActiveCardSave(cardToSave: StudyCard, folderId?: string) {
    if (
      !activeCard
      || cardToSave.id !== activeCard.id
      || !sessionId
      || cardSaveBusy
    ) return;
    const targetSessionId = sessionId;
    runtime.beginCardSave();
    runtime.clearError();
    try {
      let saved: StudyCard;
      if (cardToSave.card_type === "knowledge_card" && cardToSave.content.type === "knowledge_card") {
        const accepted = await dismissKnowledgeCardAndContinue({
          session_id: targetSessionId,
          client_command_id: `card:${cardToSave.id}`,
          card_id: cardToSave.id,
          folder_id: folderId,
          content: cardToSave.content
        });
        saved = {
          ...cardToSave,
          saved_at: accepted.card_saved_at ?? accepted.created_at,
          folder_id: accepted.folder_id ?? folderId ?? cardToSave.folder_id
        };
      } else {
        saved = await saveCard(cardToSave.id, targetSessionId, folderId);
      }
      upsertCard(saved);
      if (runtime.isSessionActive(targetSessionId)) runtime.completeCardSave();
      if (cardToSave.card_type === "knowledge_card" && !cardToSave.deferred_at) {
        await runtime.runStream(targetSessionId);
      }
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.failCardSave(nextError instanceof Error ? nextError.message : "保存学习卡片失败");
      }
    }
  }

  async function handleActiveCardDiscard(cardToDiscard: StudyCard) {
    if (
      !activeCard
      || cardToDiscard.id !== activeCard.id
      || cardToDiscard.card_type !== "knowledge_card"
      || !sessionId
      || cardSaveBusy
    ) return;
    const targetSessionId = sessionId;
    runtime.beginCardSave();
    runtime.clearError();
    try {
      await dismissKnowledgeCardAndContinue({
        session_id: targetSessionId,
        client_command_id: `card:${cardToDiscard.id}`,
        card_id: cardToDiscard.id,
        save_to_library: false
      });
      if (runtime.isSessionActive(targetSessionId)) runtime.completeCardSave();
      if (!cardToDiscard.deferred_at) await runtime.runStream(targetSessionId);
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.failCardSave(nextError instanceof Error ? nextError.message : "舍弃知识卡片失败");
      }
    }
  }

  async function handleArchivedCardSave(cardToSave: StudyCard) {
    if (
      !viewingCard
      || cardToSave.id !== viewingCard.id
      || cardToSave.card_type !== "knowledge_card"
      || cardToSave.content.type !== "knowledge_card"
    ) return;
    setViewingCardSaveBusy(true);
    runtime.clearError();
    try {
      const saved = await updateKnowledgeCard(cardToSave.id, cardToSave.content);
      upsertCard(saved);
      setViewingCard(saved);
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "修改知识卡片失败");
    } finally {
      setViewingCardSaveBusy(false);
    }
  }

  function handleLearningCardExport(selectedCards: StudyCard[], layout: LearningCardExportLayout) {
    setLearningCardExportOpen(false);
    setLearningCardPrintJob({ cards: selectedCards, layout });
  }

  return (
    <>
    <main className={`appShell ${leftOpen ? "leftOpen" : "leftClosed"} ${rightOpen ? "rightOpen" : "rightClosed"}`}>
      <SessionSidebar
        historyItems={historyItems}
        activeSessionId={sessionId}
        historyBusy={historyBusy}
        openSessionBusyId={openSessionBusyId}
        deleteSessionBusyId={deleteSessionBusyId}
        deleteAllSessionsBusy={deleteAllSessionsBusy}
        runningSessionIds={runningSessionIds}
        onCollapse={() => setLeftOpen(false)}
        onNewChat={clearCurrentSessionState}
        onOpenSession={handleOpenSession}
        onDeleteSession={handleDeleteSession}
        onDeleteAllSessions={handleDeleteAllSessions}
      />

      <section className="conversationPanel">
        <ConversationHeader
          leftOpen={leftOpen}
          title={activeHistory?.title || "新答疑"}
          sessionId={sessionId}
          gradeBand={gradeBand}
          selectedProfile={selectedProfile}
          streamBusy={streamBusy}
          problemImageUrl={originalProblemImage}
          progressLabel={runtime.timeline.run?.status === "streaming"
            ? runtime.timeline.run.progress?.label
            : undefined}
          onExpandLeft={() => setLeftOpen(true)}
          onToggleCards={() => setRightOpen((value) => !value)}
          onViewProblemImage={() => {
            if (originalProblemImage) setViewerImageUrl(originalProblemImage);
          }}
        />

        <MessageTimeline
          messages={messages}
          messageEndRef={messageEndRef}
          onOpenImage={setViewerImageUrl}
          interaction={(activeCard || checkpoint || pendingInterruption) ? (
            <>
              {activeCard && (
                <StudyCardModal
                  key={activeCard.id}
                  card={activeCard}
                  folders={folders}
                  onSave={(card, folderId) => void handleActiveCardSave(card, folderId)}
                  onDiscard={activeCard.card_type === "knowledge_card"
                    ? (card) => void handleActiveCardDiscard(card)
                    : undefined}
                  busy={cardSaveBusy}
                  editable={activeCard.card_type === "knowledge_card"}
                />
              )}
              {checkpoint && (
                <CheckpointModal
                  key={checkpoint.id}
                  checkpoint={checkpoint}
                  onSubmit={handleCheckpoint}
                  busy={workflow.mode === "checkpoint" && workflow.phase === "submitting"}
                />
              )}
              {pendingInterruption && pendingInterruption.resumeState !== "resuming" && (
                <button
                  className="resumeExplanationButton"
                  type="button"
                  onClick={() => void runtime.resumeInterruption()}
                  disabled={streamBusy}
                >
                  回到原讲解
                </button>
              )}
            </>
          ) : null}
        />

        <TutorComposer
          error={error}
          sessionId={sessionId}
          pendingImageUrl={pendingComposerImage?.dataUrl ?? null}
          input={input}
          composerBlocked={composerBlocked}
          imageInputRef={imageInputRef}
          imageBusy={imageBusy}
          gradeBand={gradeBand}
          selectedProfileId={selectedProfileId}
          selectedProfile={selectedProfile}
          profiles={profiles}
          deleteBusy={deleteBusy}
          reasoningBusy={reasoningBusy}
          streamBusy={streamBusy}
          stopBusy={stopBusy}
          startBusy={startBusy}
          speechPhase={speechInput.phase}
          speechElapsedSeconds={speechInput.elapsedSeconds}
          onClearError={runtime.clearError}
          onRemoveImage={() => {
            setPendingComposerImage(null);
            if (imageInputRef.current) imageInputRef.current.value = "";
            runtime.clearError();
          }}
          onInputChange={updateComposerInput}
          onSend={() => void handleSend()}
          onImageFile={(file) => void handleImageFile(file)}
          onPasteImages={handlePastedImages}
          onGradeBandChange={setGradeBand}
          onProfileChange={setSelectedProfileId}
          onAddProfile={openNewProfileDialog}
          onEditProfile={openSelectedProfileDialog}
          onDeleteProfiles={deleteProfiles}
          onReasoningEffortChange={setReasoningEffort}
          onStop={() => void runtime.stopStream()}
          onToggleSpeech={speechInput.toggle}
        />
      </section>

      <StudyCardSidebar
        cards={cards}
        folders={folders}
        currentFolderId={currentFolderId}
        visibleFolders={visibleFolders}
        visibleCards={visibleCards}
        clipboard={clipboard}
        cardBusyId={cardBusyId}
        folderBusyId={folderBusyId}
        pasteBusy={pasteBusy}
        deleteAllCardsBusy={deleteAllCardsBusy}
        composerBlocked={composerBlocked || anySessionRunning}
        onCollapse={() => setRightOpen(false)}
        onOpenFolder={setCurrentFolderId}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={(folder) => void deleteFolder(folder)}
        onOpenCard={setViewingCard}
        onCopyCard={(card) => setClipboard((current) => current?.mode === "copy" && current.card.id === card.id ? null : { card, mode: "copy" })}
        onCutCard={(card) => setClipboard((current) => current?.mode === "cut" && current.card.id === card.id ? null : { card, mode: "cut" })}
        onClearClipboard={() => setClipboard(null)}
        onPasteCard={() => void pasteCard()}
        onMoveCard={setMovingCard}
        onDeleteCard={handleDeleteCard}
        onExport={() => setLearningCardExportOpen(true)}
        onDeleteAllCards={handleDeleteAllCards}
      />

      <ModelConfigDialog
        open={dialogOpen}
        profile={editingProfile}
        onClose={closeProfileDialog}
        onSaved={(profileId) => refreshProfiles(profileId)}
      />
      {imageSelection && (
        <ProblemImageSelector
          imageUrl={imageSelection.imageUrl}
          initialRegions={imageSelection.regions}
          busy={imageConfirmBusy}
          onCancel={() => {
            if (imageConfirmBusy) return;
            setImageSelection(null);
            if (imageInputRef.current) imageInputRef.current.value = "";
          }}
          onConfirm={(regions) => void handleConfirmImageRegions(regions)}
        />
      )}
      {viewerImageUrl && (
        <ProblemImageViewer imageUrl={viewerImageUrl} onClose={() => setViewerImageUrl(null)} />
      )}
      <LearningCardExportDialog
        cards={cards}
        folders={folders}
        open={learningCardExportOpen}
        onClose={() => setLearningCardExportOpen(false)}
        onExport={handleLearningCardExport}
      />
      <CardMoveDialog
        card={movingCard}
        folders={folders}
        busy={Boolean(movingCard && cardBusyId === movingCard.id)}
        onClose={() => setMovingCard(null)}
        onMove={(card, folderId) => void moveCardToFolder(card, folderId)}
      />
    </main>
    {viewingCard && !activeCard && !checkpoint && (
      <div className="cardViewerLayer">
        <StudyCardModal
          key={viewingCard.id}
          card={viewingCard}
          displayMode="viewer"
          libraryView
          editable={viewingCard.card_type === "knowledge_card"}
          onSave={viewingCard.card_type === "knowledge_card"
            ? (card) => void handleArchivedCardSave(card)
            : undefined}
          onClose={() => setViewingCard(null)}
          busy={viewingCardSaveBusy}
        />
      </div>
    )}
    {learningCardPrintJob && (
      <LearningCardPrintView cards={learningCardPrintJob.cards} layout={learningCardPrintJob.layout} />
    )}
    </>
  );
}
