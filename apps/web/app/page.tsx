"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckpointModal } from "../components/CheckpointModal";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
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
import { useStudyCards } from "../hooks/useStudyCards";
import {
  acceptStudentMessage,
  analyzeProblemImage,
  answerCheckpoint,
  deleteAllSessions,
  deleteSession,
  dismissKnowledgeCardAndContinue,
  fetchSession,
  fetchSessionHistory,
  saveCard,
  startSession,
  SessionHistoryItem,
  StudyCard
} from "../lib/api";

type LearningCardPrintJob = {
  cards: StudyCard[];
  layout: LearningCardExportLayout;
};

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
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const sendInFlightKeysRef = useRef(new Set<string>());
  const pendingStudentMessagesRef = useRef(new Map<string, {
    sessionId: string;
    text: string;
    clientMessageId: string;
  }>());
  const pendingSessionStartsRef = useRef(new Map<number, {
    sessionId: string;
    clientMessageId: string;
    text: string;
    profileId: string;
    gradeBand: "junior" | "senior";
    problemText: string;
    initialThought: string;
    imageUrl: string | null;
  }>());
  const openSessionRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const viewTokenRef = useRef(0);
  const runtime = useSessionRuntime({ onRunSettled: () => void refreshHistory() });
  const {
    activeCard,
    checkpoint,
    checkpointStartedAt,
    composerBlocked,
    error,
    initialThought,
    messages,
    originalProblemImage,
    problemText,
    runningSessionIds,
    sessionId,
    streamBusy,
    workflow
  } = runtime;
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
    refreshProfiles,
    openNewProfileDialog,
    openSelectedProfileDialog,
    deleteProfiles
  } = profilesState;
  const {
    cards,
    filteredCards,
    filter: cardFilter,
    setFilter: setCardFilter,
    viewingCard,
    setViewingCard,
    cardBusyId,
    deleteAllCardsBusy,
    refreshCards,
    upsertCard,
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
    refreshHistory();
    if (window.innerWidth <= 1120) setRightOpen(false);
    if (window.innerWidth <= 760) setLeftOpen(false);
    // Initial bootstrap only; later refreshes are triggered by explicit mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: streamBusy ? "auto" : "smooth" });
  }, [messages, streamBusy]);

  useEffect(() => {
    if (activeCard) setViewingCard(null);
  }, [activeCard, setViewingCard]);

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
    pendingSessionStartsRef.current.delete(previousViewToken);
    setOpenSessionBusyId("");
    runtime.clearSession();
    setInput("");
    setViewingCard(null);
    runtime.clearError();
  }

  async function handleOpenSession(nextSessionId: string) {
    if (nextSessionId === sessionId) return;
    const requestId = openSessionRequestRef.current + 1;
    openSessionRequestRef.current = requestId;
    viewTokenRef.current += 1;
    setOpenSessionBusyId(nextSessionId);
    runtime.clearError();
    try {
      const opened = await fetchSession(nextSessionId);
      if (openSessionRequestRef.current !== requestId) return;
      runtime.loadSession(opened);
      setSelectedProfileId(opened.model_profile_id);
      setGradeBand(opened.grade_band);
      setViewingCard(null);
    } catch (nextError) {
      if (openSessionRequestRef.current !== requestId) return;
      runtime.setError(nextError instanceof Error ? nextError.message : "打开会话失败");
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

  async function finishSessionStart(
    result: Awaited<ReturnType<typeof startSession>>,
    originatingViewToken: number
  ) {
    if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
      runtime.bindStartedSession(result);
      runtime.finishComposerTask();
    }
    await refreshHistory();
    await runtime.runStream(result.session_id);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || composerBlocked) return;
    if (!selectedProfileId) {
      runtime.setError("请先在输入框下方选择一个模型；如果还没有模型，请打开设置添加。");
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
    setInput("");
    if (sessionId) {
      const targetSessionId = sessionId;
      const previous = pendingStudentMessagesRef.current.get(targetSessionId);
      const isRetry = previous?.sessionId === sessionId && previous.text === text;
      const pending = isRetry
        ? previous
        : { sessionId: targetSessionId, text, clientMessageId: crypto.randomUUID() };
      pendingStudentMessagesRef.current.set(targetSessionId, pending);
      if (!isRetry) {
        runtime.addMessage(
          "student",
          text,
          "STUDENT_RESPONSE",
          undefined,
          `client:${pending.clientMessageId}`
        );
      }
      try {
        await acceptStudentMessage({
          session_id: targetSessionId,
          client_message_id: pending.clientMessageId,
          message: text
        });
        pendingStudentMessagesRef.current.delete(targetSessionId);
        await runtime.runStream(targetSessionId);
      } catch (nextError) {
        if (runtime.isSessionActive(targetSessionId)) {
          setInput((current) => current || text);
          runtime.setError(nextError instanceof Error ? nextError.message : "提交消息失败");
        }
      } finally {
        sendInFlightKeysRef.current.delete(operationKey);
      }
      return;
    }

    const previousStart = pendingSessionStartsRef.current.get(originatingViewToken);
    const isStartRetry = Boolean(
      previousStart
      && previousStart.text === text
      && previousStart.profileId === selectedProfileId
      && previousStart.gradeBand === gradeBand
      && previousStart.problemText === problemText
      && previousStart.initialThought === initialThought
      && previousStart.imageUrl === originalProblemImage
    );
    const pendingStart = isStartRetry && previousStart
      ? previousStart
      : {
          sessionId: `sess_${crypto.randomUUID().replaceAll("-", "")}`,
          clientMessageId: crypto.randomUUID(),
          text,
          profileId: selectedProfileId,
          gradeBand,
          problemText,
          initialThought,
          imageUrl: originalProblemImage
        };
    pendingSessionStartsRef.current.set(originatingViewToken, pendingStart);
    if (!isStartRetry) {
      runtime.addMessage(
        "student",
        text,
        undefined,
        undefined,
        `client:${pendingStart.clientMessageId}`
      );
    }
    runtime.startComposerTask("start");
    runtime.clearError();
    try {
      const result = await startSession({
        session_id: pendingStart.sessionId,
        client_message_id: pendingStart.clientMessageId,
        grade_band: pendingStart.gradeBand,
        subject: "math",
        model_profile_id: pendingStart.profileId,
        message: text,
        problem_text: pendingStart.problemText,
        student_initial_thought: pendingStart.initialThought,
        problem_image_data_url: pendingStart.imageUrl
      });
      pendingSessionStartsRef.current.delete(originatingViewToken);
      await finishSessionStart(result, originatingViewToken);
    } catch (nextError) {
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        setInput((current) => current || text);
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "创建答疑会话失败");
      } else {
        pendingSessionStartsRef.current.delete(originatingViewToken);
      }
    } finally {
      sendInFlightKeysRef.current.delete(operationKey);
    }
  }

  async function handleImageFile(file?: File) {
    if (!file || sessionId) return;
    const visionProfile = selectedProfile?.is_multimodal ? selectedProfile : multimodalProfiles[0];
    if (!visionProfile) {
      runtime.setError("上传图片需要多模态模型，请先在模型设置中添加并标记“支持图片识别”。");
      return;
    }
    const originatingViewToken = viewTokenRef.current;
    const operationKey = `draft:${originatingViewToken}`;
    if (sendInFlightKeysRef.current.has(operationKey)) return;
    sendInFlightKeysRef.current.add(operationKey);
    const targetSessionId = `sess_${crypto.randomUUID().replaceAll("-", "")}`;
    const clientMessageId = crypto.randomUUID();
    const targetGradeBand = gradeBand;
    const targetInitialThought = initialThought;
    setSelectedProfileId(visionProfile.id);
    runtime.startComposerTask("image");
    runtime.clearError();
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        runtime.updateDraft({ originalProblemImage: dataUrl });
        runtime.addMessage(
          "student",
          "上传了一张题目图片",
          undefined,
          dataUrl,
          `client:${clientMessageId}`
        );
      }
      const analyzed = await analyzeProblemImage({
        model_profile_id: visionProfile.id,
        image_base64: dataUrl,
        content_type: file.type || "image/png",
        filename: file.name
      });
      const result = await startSession({
        session_id: targetSessionId,
        client_message_id: clientMessageId,
        grade_band: targetGradeBand,
        subject: "math",
        model_profile_id: visionProfile.id,
        message: "上传了一张题目图片",
        problem_text: analyzed.problem_text,
        student_initial_thought: analyzed.student_work_summary.trim() || targetInitialThought,
        problem_image_data_url: dataUrl
      });
      await finishSessionStart(result, originatingViewToken);
    } catch (nextError) {
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        runtime.updateDraft({ originalProblemImage: null });
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "图片识别失败");
      }
    } finally {
      sendInFlightKeysRef.current.delete(operationKey);
      if (viewTokenRef.current === originatingViewToken && imageInputRef.current) {
        imageInputRef.current.value = "";
      }
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
        runtime.completeCheckpointSubmission(answer.student_message);
      }
      await runtime.runStream(targetSessionId);
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.failCheckpointSubmission(nextError instanceof Error ? nextError.message : "提交检查点失败");
      }
    }
  }

  async function handleActiveCardClose() {
    if (!activeCard || !sessionId || workflow.mode !== "card" || workflow.phase !== "ready") return;
    const targetSessionId = sessionId;
    const cardToSave = activeCard;
    runtime.beginCardSave();
    runtime.clearError();
    try {
      let saved: StudyCard;
      if (cardToSave.card_type === "knowledge_card") {
        const accepted = await dismissKnowledgeCardAndContinue({
          session_id: targetSessionId,
          client_command_id: `card:${cardToSave.id}`,
          card_id: cardToSave.id
        });
        saved = {
          ...cardToSave,
          saved_at: accepted.card_saved_at ?? accepted.created_at
        };
      } else {
        saved = await saveCard(cardToSave.id, targetSessionId);
      }
      upsertCard(saved);
      if (runtime.isSessionActive(targetSessionId)) runtime.completeCardSave();
      if (cardToSave.card_type === "knowledge_card") await runtime.runStream(targetSessionId);
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.failCardSave(nextError instanceof Error ? nextError.message : "保存学习卡片失败");
      }
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
          onExpandLeft={() => setLeftOpen(true)}
          onToggleCards={() => setRightOpen((value) => !value)}
        />

        <MessageTimeline messages={messages} messageEndRef={messageEndRef} />

        <TutorComposer
          error={error}
          sessionId={sessionId}
          originalProblemImage={originalProblemImage}
          input={input}
          composerBlocked={composerBlocked}
          imageInputRef={imageInputRef}
          imageBusy={imageBusy}
          gradeBand={gradeBand}
          selectedProfileId={selectedProfileId}
          selectedProfile={selectedProfile}
          profiles={profiles}
          deleteBusy={deleteBusy}
          streamBusy={streamBusy}
          stopBusy={stopBusy}
          startBusy={startBusy}
          onClearError={runtime.clearError}
          onRemoveImage={() => runtime.updateDraft({ originalProblemImage: null, problemText: "" })}
          onInputChange={setInput}
          onSend={() => void handleSend()}
          onImageFile={(file) => void handleImageFile(file)}
          onGradeBandChange={setGradeBand}
          onProfileChange={setSelectedProfileId}
          onAddProfile={openNewProfileDialog}
          onEditProfile={openSelectedProfileDialog}
          onDeleteProfiles={deleteProfiles}
          onStop={() => void runtime.stopStream()}
        />
      </section>

      <StudyCardSidebar
        cards={cards}
        filteredCards={filteredCards}
        filter={cardFilter}
        cardBusyId={cardBusyId}
        deleteAllCardsBusy={deleteAllCardsBusy}
        composerBlocked={composerBlocked || anySessionRunning}
        onCollapse={() => setRightOpen(false)}
        onFilterChange={setCardFilter}
        onOpenCard={setViewingCard}
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
      <CheckpointModal checkpoint={checkpoint} onChoose={handleCheckpoint} busy={workflow.mode === "checkpoint" && workflow.phase === "submitting"} />
      <StudyCardModal
        card={activeCard ?? viewingCard}
        onClose={activeCard ? handleActiveCardClose : () => setViewingCard(null)}
        busy={workflow.mode === "card" && workflow.phase === "saving"}
      />
      <LearningCardExportDialog
        cards={cards}
        open={learningCardExportOpen}
        onClose={() => setLearningCardExportOpen(false)}
        onExport={handleLearningCardExport}
      />
    </main>
    {learningCardPrintJob && (
      <LearningCardPrintView cards={learningCardPrintJob.cards} layout={learningCardPrintJob.layout} />
    )}
    </>
  );
}
