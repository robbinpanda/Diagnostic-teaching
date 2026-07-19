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
import { StudyCardSidebar, type StudyCardFilter } from "../components/workspace/StudyCardSidebar";
import { TutorComposer } from "../components/workspace/TutorComposer";
import { useSessionRuntime } from "../hooks/useSessionRuntime";
import {
  acceptStudentMessage,
  analyzeProblemImage,
  answerCheckpoint,
  deleteAllCards,
  deleteAllSessions,
  deleteCard,
  deleteModelProfile,
  deleteSession,
  dismissKnowledgeCardAndContinue,
  fetchCards,
  fetchProfiles,
  fetchSession,
  fetchSessionHistory,
  modelProfileLabel,
  ModelProfile,
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
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [gradeBand, setGradeBand] = useState<"junior" | "senior">("junior");
  const [input, setInput] = useState("");
  const [viewingCard, setViewingCard] = useState<StudyCard | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [cardFilter, setCardFilter] = useState<StudyCardFilter>("all");
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [openSessionBusyId, setOpenSessionBusyId] = useState("");
  const [deleteSessionBusyId, setDeleteSessionBusyId] = useState("");
  const [deleteAllSessionsBusy, setDeleteAllSessionsBusy] = useState(false);
  const [deleteAllCardsBusy, setDeleteAllCardsBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [cardBusyId, setCardBusyId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [learningCardExportOpen, setLearningCardExportOpen] = useState(false);
  const [learningCardPrintJob, setLearningCardPrintJob] = useState<LearningCardPrintJob | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const sendInFlightRef = useRef(false);
  const pendingStudentMessageRef = useRef<{
    sessionId: string;
    text: string;
    clientMessageId: string;
  } | null>(null);
  const pendingSessionStartRef = useRef<{
    sessionId: string;
    clientMessageId: string;
    text: string;
    profileId: string;
    gradeBand: "junior" | "senior";
    problemText: string;
    initialThought: string;
    imageUrl: string | null;
  } | null>(null);
  const openSessionRequestRef = useRef(0);
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
    sessionId,
    streamBusy,
    workflow
  } = runtime;
  const startBusy = workflow.mode === "composer" && workflow.activity === "start";
  const imageBusy = workflow.mode === "composer" && workflow.activity === "image";
  const sessionNavigationBusy = workflow.mode === "composer" && workflow.activity !== "idle";
  const stopBusy = workflow.mode === "run" && workflow.phase === "stopping";

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const multimodalProfiles = useMemo(
    () => profiles.filter((profile) => profile.is_multimodal),
    [profiles]
  );
  const activeHistory = useMemo(
    () => historyItems.find((item) => item.session_id === sessionId),
    [historyItems, sessionId]
  );
  const filteredCards = useMemo(
    () => cards.filter((card) => cardFilter === "all" || card.card_type === cardFilter),
    [cards, cardFilter]
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
  }, [activeCard]);

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

  async function refreshProfiles(selectId?: string) {
    try {
      const nextProfiles = await fetchProfiles();
      setProfiles(nextProfiles);
      const desiredId = selectId ?? selectedProfileId;
      if (desiredId && nextProfiles.some((profile) => profile.id === desiredId)) {
        setSelectedProfileId(desiredId);
      } else if (nextProfiles.length === 1) {
        setSelectedProfileId(nextProfiles[0].id);
      } else if (!nextProfiles.some((profile) => profile.id === selectedProfileId)) {
        setSelectedProfileId("");
      }
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "模型列表加载失败");
    }
  }

  async function refreshCards() {
    try {
      setCards(await fetchCards());
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "学习卡片加载失败");
    }
  }

  async function refreshHistory() {
    setHistoryBusy(true);
    try {
      setHistoryItems(await fetchSessionHistory());
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "历史会话加载失败");
    } finally {
      setHistoryBusy(false);
    }
  }

  function clearCurrentSessionState() {
    openSessionRequestRef.current += 1;
    pendingStudentMessageRef.current = null;
    pendingSessionStartRef.current = null;
    setOpenSessionBusyId("");
    runtime.clearSession();
    setInput("");
    setViewingCard(null);
    runtime.clearError();
  }

  async function handleOpenSession(nextSessionId: string) {
    if (nextSessionId === sessionId || sessionNavigationBusy) return;
    const requestId = openSessionRequestRef.current + 1;
    openSessionRequestRef.current = requestId;
    runtime.prepareSessionChange();
    setOpenSessionBusyId(nextSessionId);
    runtime.clearError();
    try {
      const opened = await fetchSession(nextSessionId);
      if (openSessionRequestRef.current !== requestId) return;
      runtime.loadSession(opened);
      setSelectedProfileId(opened.model_profile_id);
      setGradeBand(opened.grade_band);
      setViewingCard(null);
      setLeftOpen(false);
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

  async function finishSessionStart(result: Awaited<ReturnType<typeof startSession>>) {
    runtime.bindStartedSession(result);
    runtime.finishComposerTask();
    await refreshHistory();
    await runtime.runStream(result.session_id);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || composerBlocked || sendInFlightRef.current) return;
    if (!selectedProfileId) {
      runtime.setError("请先在输入框下方选择一个模型；如果还没有模型，请打开设置添加。");
      return;
    }
    if (originalProblemImage && !selectedProfile?.is_multimodal) {
      runtime.setError("这道题带有原图，请选择支持图片识别的多模态模型。");
      return;
    }
    sendInFlightRef.current = true;
    setInput("");
    if (sessionId) {
      const previous = pendingStudentMessageRef.current;
      const isRetry = previous?.sessionId === sessionId && previous.text === text;
      const pending = isRetry
        ? previous
        : { sessionId, text, clientMessageId: crypto.randomUUID() };
      pendingStudentMessageRef.current = pending;
      if (!isRetry) runtime.addMessage("student", text, "STUDENT_RESPONSE");
      try {
        await acceptStudentMessage({
          session_id: sessionId,
          client_message_id: pending.clientMessageId,
          message: text
        });
        pendingStudentMessageRef.current = null;
        await runtime.runStream(sessionId);
      } catch (nextError) {
        setInput((current) => current || text);
        runtime.setError(nextError instanceof Error ? nextError.message : "提交消息失败");
      } finally {
        sendInFlightRef.current = false;
      }
      return;
    }

    const previousStart = pendingSessionStartRef.current;
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
    pendingSessionStartRef.current = pendingStart;
    if (!isStartRetry) runtime.addMessage("student", text);
    runtime.startComposerTask("start");
    runtime.clearError();
    try {
      const result = await startSession({
        session_id: pendingStart.sessionId,
        client_message_id: pendingStart.clientMessageId,
        grade_band: gradeBand,
        subject: "math",
        model_profile_id: selectedProfileId,
        message: text,
        problem_text: problemText,
        student_initial_thought: initialThought,
        problem_image_data_url: originalProblemImage
      });
      pendingSessionStartRef.current = null;
      await finishSessionStart(result);
    } catch (nextError) {
      setInput((current) => current || text);
      runtime.failComposerTask(nextError instanceof Error ? nextError.message : "创建答疑会话失败");
    } finally {
      sendInFlightRef.current = false;
    }
  }

  async function handleImageFile(file?: File) {
    if (!file || sessionId) return;
    const visionProfile = selectedProfile?.is_multimodal ? selectedProfile : multimodalProfiles[0];
    if (!visionProfile) {
      runtime.setError("上传图片需要多模态模型，请先在模型设置中添加并标记“支持图片识别”。");
      return;
    }
    setSelectedProfileId(visionProfile.id);
    runtime.startComposerTask("image");
    runtime.clearError();
    try {
      const dataUrl = await readFileAsDataUrl(file);
      runtime.updateDraft({ originalProblemImage: dataUrl });
      runtime.addMessage("student", "上传了一张题目图片", undefined, dataUrl);
      const analyzed = await analyzeProblemImage({
        model_profile_id: visionProfile.id,
        image_base64: dataUrl,
        content_type: file.type || "image/png",
        filename: file.name
      });
      const result = await startSession({
        session_id: `sess_${crypto.randomUUID().replaceAll("-", "")}`,
        client_message_id: crypto.randomUUID(),
        grade_band: gradeBand,
        subject: "math",
        model_profile_id: visionProfile.id,
        message: "上传了一张题目图片",
        problem_text: analyzed.problem_text,
        student_initial_thought: analyzed.student_work_summary.trim() || initialThought,
        problem_image_data_url: dataUrl
      });
      await finishSessionStart(result);
    } catch (nextError) {
      runtime.updateDraft({ originalProblemImage: null });
      runtime.failComposerTask(nextError instanceof Error ? nextError.message : "图片识别失败");
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleCheckpoint(optionId: string) {
    if (!checkpoint || !sessionId || workflow.mode !== "checkpoint" || workflow.phase !== "ready") return;
    const activeCheckpoint = checkpoint;
    const startedAt = checkpointStartedAt;
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    runtime.beginCheckpointSubmission();
    try {
      const answer = await answerCheckpoint({
        checkpointId: activeCheckpoint.id,
        session_id: sessionId,
        selected_option_id: optionId,
        elapsed_ms: elapsed
      });
      runtime.completeCheckpointSubmission(answer.student_message);
      await runtime.runStream(sessionId);
    } catch (nextError) {
      runtime.failCheckpointSubmission(nextError instanceof Error ? nextError.message : "提交检查点失败");
    }
  }

  async function handleActiveCardClose() {
    if (!activeCard || !sessionId || workflow.mode !== "card" || workflow.phase !== "ready") return;
    const cardToSave = activeCard;
    runtime.beginCardSave();
    runtime.clearError();
    try {
      let saved: StudyCard;
      if (cardToSave.card_type === "knowledge_card") {
        const accepted = await dismissKnowledgeCardAndContinue({
          session_id: sessionId,
          client_command_id: `card:${cardToSave.id}`,
          card_id: cardToSave.id
        });
        saved = {
          ...cardToSave,
          saved_at: accepted.card_saved_at ?? accepted.created_at
        };
      } else {
        saved = await saveCard(cardToSave.id, sessionId);
      }
      setCards((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      runtime.completeCardSave();
      if (cardToSave.card_type === "knowledge_card") await runtime.runStream(sessionId);
    } catch (nextError) {
      runtime.failCardSave(nextError instanceof Error ? nextError.message : "保存学习卡片失败");
    }
  }

  async function handleDeleteCard(card: StudyCard) {
    if (cardBusyId || !window.confirm(`删除卡片“${card.content.title}”？删除后无法恢复。`)) return;
    setCardBusyId(card.id);
    runtime.clearError();
    try {
      await deleteCard(card.id);
      setCards((current) => current.filter((item) => item.id !== card.id));
      setViewingCard((current) => current?.id === card.id ? null : current);
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "删除学习卡片失败");
    } finally {
      setCardBusyId("");
    }
  }

  async function handleDeleteAllCards() {
    if (!window.confirm("清空全部学习卡片？会话、消息和日志会保留。")) return;
    setDeleteAllCardsBusy(true);
    runtime.clearError();
    try {
      await deleteAllCards();
      setCards([]);
      setViewingCard(null);
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "清空学习卡片失败");
    } finally {
      setDeleteAllCardsBusy(false);
    }
  }

  function handleLearningCardExport(selectedCards: StudyCard[], layout: LearningCardExportLayout) {
    setLearningCardExportOpen(false);
    setLearningCardPrintJob({ cards: selectedCards, layout });
  }

  async function handleDeleteProfile() {
    if (!selectedProfile || selectedProfile.managed || sessionId) return;
    if (!window.confirm(`删除模型配置“${modelProfileLabel(selectedProfile)}”？`)) return;
    setDeleteBusyId(selectedProfile.id);
    runtime.clearError();
    try {
      await deleteModelProfile(selectedProfile.id);
      await refreshProfiles();
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "删除模型配置失败");
    } finally {
      setDeleteBusyId("");
    }
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
        sessionNavigationBusy={sessionNavigationBusy}
        streamBusy={streamBusy}
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
          deleteBusyId={deleteBusyId}
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
          onEditProfile={() => {
            setEditingProfile(selectedProfile ?? null);
            setDialogOpen(true);
          }}
          onDeleteProfile={() => void handleDeleteProfile()}
          onStop={() => void runtime.stopStream()}
        />
      </section>

      <StudyCardSidebar
        cards={cards}
        filteredCards={filteredCards}
        filter={cardFilter}
        cardBusyId={cardBusyId}
        deleteAllCardsBusy={deleteAllCardsBusy}
        composerBlocked={composerBlocked}
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
        onClose={() => setDialogOpen(false)}
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
