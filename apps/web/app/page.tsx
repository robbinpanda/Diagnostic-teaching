"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CardMoveDialog } from "../components/CardMoveDialog";
import { CheckpointModal } from "../components/CheckpointModal";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
import { ProblemImageSelector } from "../components/ProblemImageSelector";
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
  saveCard,
  DetectedProblemRegion,
  SessionHistoryItem,
  SessionStartInput,
  SessionStartResult,
  StudyCard,
  updateKnowledgeCard
} from "../lib/api";

type LearningCardPrintJob = {
  cards: StudyCard[];
  layout: LearningCardExportLayout;
};

type PendingSessionBatch = {
  text: string;
  profileId: string;
  gradeBand: "junior" | "senior";
  sessions?: SessionStartInput[];
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
  const [imageConfirmBusy, setImageConfirmBusy] = useState(false);
  const [viewingCardSaveBusy, setViewingCardSaveBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const sendInFlightKeysRef = useRef(new Set<string>());
  const pendingStudentMessagesRef = useRef(new Map<string, {
    sessionId: string;
    text: string;
    clientMessageId: string;
  }>());
  const pendingSessionBatchesRef = useRef(new Map<number, PendingSessionBatch>());
  const openSessionRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const viewTokenRef = useRef(0);
  const speechBaseInputRef = useRef("");
  const runtime = useSessionRuntime({ onRunSettled: () => void refreshHistory() });
  const {
    activeCard,
    checkpoint,
    checkpointStartedAt,
    composerBlocked,
    error,
    messages,
    originalProblemImage,
    runningSessionIds,
    sessionId,
    streamBusy,
    workflow
  } = runtime;
  const speechInput = useSpeechInput({
    onRecordingStart: () => {
      speechBaseInputRef.current = input;
      runtime.clearError();
    },
    onTranscript: (transcript) => {
      const nextText = transcript.trim();
      if (!nextText) return;
      const baseText = speechBaseInputRef.current;
      setInput(baseText.trim()
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
    refreshHistory();
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
    setImageConfirmBusy(false);
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
        }
      } catch {
        if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
          runtime.bindStartedSession(results[0]);
          runtime.finishComposerTask();
        }
      }
    }
    await refreshHistory();
    for (const result of results) void runtime.runStream(result.session_id);
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

    const previousBatch = pendingSessionBatchesRef.current.get(originatingViewToken);
    const isStartRetry = Boolean(
      previousBatch
      && previousBatch.text === text
      && previousBatch.profileId === selectedProfileId
      && previousBatch.gradeBand === gradeBand
    );
    let pendingBatch: PendingSessionBatch = isStartRetry && previousBatch
      ? previousBatch
      : { text, profileId: selectedProfileId, gradeBand };
    pendingSessionBatchesRef.current.set(originatingViewToken, pendingBatch);
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
              subject: "math",
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
      }
      const sessionsToStart = pendingBatch.sessions;
      if (!sessionsToStart?.length) throw new Error("拆题模型没有返回可创建的题目");
      const result = await batchStartSessions(sessionsToStart);
      pendingSessionBatchesRef.current.delete(originatingViewToken);
      await finishSessionBatchStart(result.sessions, originatingViewToken);
    } catch (nextError) {
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        setInput((current) => current || text);
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "拆题或创建答疑会话失败");
      } else {
        pendingSessionBatchesRef.current.delete(originatingViewToken);
      }
    } finally {
      sendInFlightKeysRef.current.delete(operationKey);
    }
  }

  async function handleImageFile(file?: File) {
    if (!file || sessionId) return;
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
      const dataUrl = await readFileAsDataUrl(file);
      const detected = await detectProblemImageRegions({
        model_profile_id: visionProfile.id,
        image_base64: dataUrl,
        content_type: file.type || "image/png",
        filename: file.name
      });
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        setImageSelection({
          imageUrl: dataUrl,
          contentType: file.type || "image/png",
          filename: file.name,
          profileId: visionProfile.id,
          gradeBand: targetGradeBand,
          viewToken: originatingViewToken,
          regions: detected.problems
        });
        runtime.finishComposerTask();
      }
    } catch (nextError) {
      if (viewTokenRef.current === originatingViewToken && runtime.isDraftActive()) {
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "题目框检测失败");
      }
    } finally {
      sendInFlightKeysRef.current.delete(operationKey);
      if (viewTokenRef.current === originatingViewToken && imageInputRef.current) {
        imageInputRef.current.value = "";
      }
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
      || workflow.mode !== "card"
      || workflow.phase !== "ready"
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
      if (cardToSave.card_type === "knowledge_card") await runtime.runStream(targetSessionId);
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
      || workflow.mode !== "card"
      || workflow.phase !== "ready"
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
      await runtime.runStream(targetSessionId);
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
          progressLabel={runtime.timeline.run?.status === "streaming"
            ? runtime.timeline.run.progress?.label
            : undefined}
          onExpandLeft={() => setLeftOpen(true)}
          onToggleCards={() => setRightOpen((value) => !value)}
        />

        <MessageTimeline
          messages={messages}
          messageEndRef={messageEndRef}
          interaction={checkpoint ? (
            <CheckpointModal
              key={checkpoint.id}
              checkpoint={checkpoint}
              onSubmit={handleCheckpoint}
              busy={workflow.mode === "checkpoint" && workflow.phase === "submitting"}
            />
          ) : activeCard ? (
            <StudyCardModal
              key={activeCard.id}
              card={activeCard}
              folders={folders}
              onSave={(card, folderId) => void handleActiveCardSave(card, folderId)}
              onDiscard={activeCard.card_type === "knowledge_card"
                ? (card) => void handleActiveCardDiscard(card)
                : undefined}
              busy={workflow.mode === "card" && workflow.phase === "saving"}
              editable={activeCard.card_type === "knowledge_card"}
            />
          ) : null}
        />

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
          reasoningBusy={reasoningBusy}
          streamBusy={streamBusy}
          stopBusy={stopBusy}
          startBusy={startBusy}
          speechPhase={speechInput.phase}
          speechElapsedSeconds={speechInput.elapsedSeconds}
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
