"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { CardMoveDialog } from "../components/CardMoveDialog";
import { CheckpointModal } from "../components/CheckpointModal";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
import { ProblemImageSelector, type PaperSelection } from "../components/ProblemImageSelector";
import { ProblemImageViewer } from "../components/ProblemImageViewer";
import { StudyCardModal } from "../components/StudyCardModal";
import {
  LearningCardExportDialog,
  type LearningCardExportLayout
} from "../components/LearningCardExportDialog";
import { LearningCardPrintView } from "../components/LearningCardPrintView";
import {
  MistakeSetPrintDocument,
  MistakeSetPrintView,
  type PrintableMistakeItem
} from "../components/MistakeSetPrintView";
import { AppTopbar } from "../components/workspace/AppTopbar";
import { CardShelfTabs } from "../components/workspace/CardShelfTabs";
import { ConversationHeader } from "../components/workspace/ConversationHeader";
import {
  DraggableCardWindow,
  type DraggableCardWindowHandle
} from "../components/workspace/DraggableCardWindow";
import { HistoryWorkspace } from "../components/workspace/HistoryWorkspace";
import { KnowledgeWorkspace, type KnowledgeView } from "../components/workspace/KnowledgeWorkspace";
import { MessageTimeline } from "../components/workspace/MessageTimeline";
import {
  SessionSidebar,
  type WorkspaceContentNavigation,
  type WorkspaceNavigation
} from "../components/workspace/SessionSidebar";
import { MistakeSetWorkspace, type MistakeSetView } from "../components/workspace/MistakeSetWorkspace";
import { StudyCardSidebar } from "../components/workspace/StudyCardSidebar";
import { TutorComposer } from "../components/workspace/TutorComposer";
import { useModelProfiles } from "../hooks/useModelProfiles";
import { useMistakeSets } from "../hooks/useMistakeSets";
import { useSessionRuntime } from "../hooks/useSessionRuntime";
import { useSpeechInput } from "../hooks/useSpeechInput";
import { useStudyCards } from "../hooks/useStudyCards";
import {
  acceptStudentMessage,
  analyzeProblemText,
  answerCheckpoint,
  batchStartImageSessions,
  batchStartSessions,
  createExamPaper,
  deleteAllSessions,
  deleteSession,
  detectProblemImageRegions,
  dismissKnowledgeCardAndContinue,
  fetchExamPapers,
  fetchSession,
  fetchSessionHistory,
  fetchSessionRunStatus,
  isApiResponseError,
  moveCard as moveCardRequest,
  saveCard,
  DetectedProblemRegion,
  ExamPaper,
  SessionHistoryItem,
  SessionStartResult,
  StudyCard,
  updateKnowledgeCard
} from "../lib/api";
import type { HistoryPaperGroup, HistorySortMode, HistoryView } from "../lib/history-view";
import { selectedHistoryItems, toggleMistakeSelection, togglePaperMistakeSelection } from "../lib/mistake-selection";
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
import {
  blobToDataUrl,
  clearImageDraft,
  loadImageDraft,
  saveImageDraft,
  type PersistedImageDraft,
  type PersistedImageStartItem
} from "../lib/image-draft-recovery";

type ShelfCardTransitionPhase =
  | "idle"
  | "preparing"
  | "opening"
  | "open"
  | "closing"
  | "closingFallback";

type ShelfCardMotion = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  startX?: number;
  startY?: number;
};

type LearningCardPrintJob = {
  cards: StudyCard[];
  layout: LearningCardExportLayout;
};

type MistakeSetPrintJob = {
  name: string;
  items: PrintableMistakeItem[];
};

type MistakeExportDraft = MistakeSetPrintJob & {
  sessionIds: string[];
};

type PendingImageSelection = {
  operationId: string;
  imageBlob: Blob;
  imageUrl: string;
  contentType: string;
  filename: string;
  profileId: string;
  gradeBand: "junior" | "senior";
  createdAt: string;
  viewToken: number;
  regions: DetectedProblemRegion[];
  startItems?: PersistedImageStartItem[];
  paperId?: string;
};

type PendingComposerImage = {
  dataUrl: string;
  file: File;
  operationId?: string;
  createdAt?: string;
};

const DRAFT_SCOPE = "draft";
const RECOVERABLE_RUN_CODES = new Set([
  "client_disconnected",
  "process_restarted",
  "provider_error",
  "stream_closed"
]);

const mistakeSetNameFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai"
});

function defaultMistakeSetName() {
  return `错题集 ${mistakeSetNameFormatter.format(new Date()).replaceAll("/", "-")}`;
}

function stableImageStartItems(
  regions: DetectedProblemRegion[],
  existing: PersistedImageStartItem[] = []
): PersistedImageStartItem[] {
  return regions.map((region) => {
    const previous = existing.find((item) => item.region_id === region.id);
    return {
      region_id: region.id,
      session_id: previous?.session_id
        ?? `sess_${crypto.randomUUID().replaceAll("-", "")}`,
      client_message_id: previous?.client_message_id ?? crypto.randomUUID(),
      bbox: region.bbox
    };
  });
}

function persistedSelection(
  selection: PendingImageSelection,
  stage: PersistedImageDraft["stage"]
): PersistedImageDraft {
  return {
    version: 1,
    operationId: selection.operationId,
    stage,
    imageBlob: selection.imageBlob,
    contentType: selection.contentType,
    filename: selection.filename,
    profileId: selection.profileId,
    gradeBand: selection.gradeBand,
    regions: selection.regions,
    startItems: selection.startItems,
    paperId: selection.paperId,
    createdAt: selection.createdAt
  };
}

function hasUsableCardSourceVisibility(
  element: HTMLElement,
  allowHiddenSource: boolean
) {
  let current: HTMLElement | null = element;
  let isSource = true;
  while (current) {
    const style = window.getComputedStyle(current);
    const hiddenSourceAllowed = isSource && allowHiddenSource;
    if (
      style.display === "none"
      || (style.visibility === "hidden" && !hiddenSourceAllowed)
      || Number.parseFloat(style.opacity) === 0
      || (style.pointerEvents === "none" && !hiddenSourceAllowed)
    ) return false;
    current = current.parentElement;
    isSource = false;
  }
  return true;
}

function isCardSourceOnScreen(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < window.innerWidth
    && rect.top < window.innerHeight;
}

function canReturnCardToElement(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  return hasUsableCardSourceVisibility(element, false) && isCardSourceOnScreen(element);
}

function canAnimateCardToElement(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  const intentionallyHiddenShelfSource = element.matches("[data-shelf-card-id]");
  return hasUsableCardSourceVisibility(element, intentionallyHiddenShelfSource)
    && isCardSourceOnScreen(element);
}

export default function Home() {
  const [gradeBand, setGradeBand] = useState<"junior" | "senior">("junior");
  const [input, setInput] = useState("");
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [examPapers, setExamPapers] = useState<ExamPaper[]>([]);
  const [historyView, setHistoryView] = useState<HistoryView>(null);
  const [mistakeSetView, setMistakeSetView] = useState<MistakeSetView | null>(null);
  const [knowledgeView, setKnowledgeView] = useState<KnowledgeView | null>(null);
  const [mistakeSelectionMode, setMistakeSelectionMode] = useState(false);
  const [selectedMistakeSessionIds, setSelectedMistakeSessionIds] = useState<string[]>([]);
  const [mistakeExportBusy, setMistakeExportBusy] = useState(false);
  const [mistakeExportDraft, setMistakeExportDraft] = useState<MistakeExportDraft | null>(null);
  const [historyOverviewQuery, setHistoryOverviewQuery] = useState("");
  const [historySortMode, setHistorySortMode] = useState<HistorySortMode>("recent");
  const [historySelectedPaperName, setHistorySelectedPaperName] = useState("");
  const [collectionNotice, setCollectionNotice] = useState("");
  const [historyLoadError, setHistoryLoadError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(true);
  const [openSessionBusyId, setOpenSessionBusyId] = useState("");
  const [deleteSessionBusyId, setDeleteSessionBusyId] = useState("");
  const [deleteAllSessionsBusy, setDeleteAllSessionsBusy] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [responsiveReady, setResponsiveReady] = useState(false);
  const [contentNavigation, setContentNavigation] = useState<WorkspaceContentNavigation>("start");
  const [cardLibraryMode, setCardLibraryMode] = useState<"all" | "knowledge" | "problem">("all");
  const [learningCardExportOpen, setLearningCardExportOpen] = useState(false);
  const [learningCardPrintJob, setLearningCardPrintJob] = useState<LearningCardPrintJob | null>(null);
  const [mistakeSetPrintJob, setMistakeSetPrintJob] = useState<MistakeSetPrintJob | null>(null);
  const [imageSelection, setImageSelection] = useState<PendingImageSelection | null>(null);
  const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
  const [pendingComposerImage, setPendingComposerImage] = useState<PendingComposerImage | null>(null);
  const [imageConfirmBusy, setImageConfirmBusy] = useState(false);
  const [viewingCardSaveBusy, setViewingCardSaveBusy] = useState(false);
  const [shelfCardTransitionPhase, setShelfCardTransitionPhase] = useState<ShelfCardTransitionPhase>("idle");
  const [shelfCardMotion, setShelfCardMotion] = useState<ShelfCardMotion | null>(null);
  const [pendingCardMotionReadyKey, setPendingCardMotionReadyKey] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const historyWorkspaceRef = useRef<HTMLElement | null>(null);
  const knowledgeCardDockRef = useRef<HTMLDivElement | null>(null);
  const cardWindowRef = useRef<DraggableCardWindowHandle | null>(null);
  const cardPanelToggleRef = useRef<HTMLButtonElement | null>(null);
  const shelfCardOriginRef = useRef<DOMRectReadOnly | null>(null);
  const shelfCardTriggerRef = useRef<HTMLElement | null>(null);
  const sendInFlightKeysRef = useRef(new Set<string>());
  const pendingStudentMessagesRef = useRef(new Map<string, PendingStudentRequest>());
  const queuedInterjectionsRef = useRef(new Map<string, PendingStudentRequest[]>());
  const flushingInterjectionsRef = useRef(new Set<string>());
  const pendingSessionBatchesRef = useRef(new Map<number, PendingSessionBatch>());
  const bootstrapNavigationRef = useRef(0);
  const openSessionRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const examPapersRequestRef = useRef(0);
  const viewTokenRef = useRef(0);
  const speechBaseInputRef = useRef("");
  const runtime = useSessionRuntime({ onRunSettled: handleRunSettled });
  const {
    activeCard,
    activeCards,
    cardSaveBusy,
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
  const retryableMessageId = runtime.timeline.lastError && !streamBusy
    ? messages.findLast((message) => message.role === "student")?.id ?? null
    : null;

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1319px)");
    const syncCompactState = (matches: boolean) => {
      if (matches) {
        setLeftOpen(false);
        setRightOpen(false);
      }
      setResponsiveReady(true);
    };
    syncCompactState(compact.matches);
    const onChange = (event: MediaQueryListEvent) => syncCompactState(event.matches);
    compact.addEventListener("change", onChange);
    return () => compact.removeEventListener("change", onChange);
  }, []);

  function closeNavigationOnMobile() {
    if (window.matchMedia("(max-width: 760px)").matches) setLeftOpen(false);
  }

  function invalidateBootstrapNavigation() {
    bootstrapNavigationRef.current += 1;
  }

  function handleRunSettled(targetSessionId: string) {
    void refreshHistory();
    void flushQueuedInterjections(targetSessionId);
  }

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

  async function persistImageDraft(draft: PersistedImageDraft) {
    try {
      await saveImageDraft(draft);
      return true;
    } catch {
      return false;
    }
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
    mistakeSets,
    mistakeSetsBusy,
    mistakeSetSaveBusy,
    refreshMistakeSets,
    saveMistakeSet
  } = useMistakeSets({
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
    invalidateCardRefresh,
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
  const activeNavigation: WorkspaceNavigation = contentNavigation;
  const centralWorkspaceActive = Boolean(
    historyView || mistakeSetView || knowledgeView || mistakeExportDraft
  );

  const activeHistory = useMemo(
    () => historyItems.find((item) => item.session_id === sessionId),
    [historyItems, sessionId]
  );
  const dockedActiveCard = useMemo(
    () => [...activeCards].reverse().find((card) => (
      card.card_type === "knowledge_card" || card.card_type === "problem_card"
    )) ?? null,
    [activeCards]
  );
  const viewedShelfCard = viewingCard;
  const viewedShelfCardId = viewedShelfCard?.id ?? null;
  const displayedDockCard = viewedShelfCard ?? dockedActiveCard;
  const displayedDockCardIsArchived = Boolean(
    displayedDockCard && viewedShelfCard?.id === displayedDockCard.id
  );
  const pendingCardMotionKey = displayedDockCard && !displayedDockCardIsArchived
    ? `${displayedDockCard.id}:${centralWorkspaceActive ? "workspace" : "conversation"}`
    : null;
  const displayedDockCardThemeVariant = useMemo(() => {
    if (!displayedDockCard || displayedDockCard.card_type !== "knowledge_card" || !displayedDockCard.saved_at) {
      return undefined;
    }
    return [...cards]
      .filter((card) => card.session_id === displayedDockCard.session_id
        && card.card_type === "knowledge_card"
        && Boolean(card.saved_at))
      .sort((left, right) => (right.saved_at || "").localeCompare(left.saved_at || ""))
      .findIndex((card) => card.id === displayedDockCard.id);
  }, [cards, displayedDockCard]);
  const anchoredActiveCards = useMemo(
    () => activeCards.filter((card) => card.id !== dockedActiveCard?.id),
    [activeCards, dockedActiveCard?.id]
  );

  function openShelfCard(
    nextCard: StudyCard,
    origin: DOMRectReadOnly,
    trigger?: HTMLButtonElement
  ) {
    shelfCardOriginRef.current = origin;
    shelfCardTriggerRef.current = trigger
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    flushSync(() => {
      setPendingCardMotionReadyKey(null);
      setShelfCardMotion(null);
      setShelfCardTransitionPhase("preparing");
      setViewingCard(nextCard);
    });
  }

  function openLibraryCard(
    nextCard: StudyCard,
    origin: DOMRectReadOnly,
    trigger: HTMLButtonElement
  ) {
    openShelfCard(nextCard, origin, trigger);
    if (window.matchMedia("(max-width: 1319px)").matches) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }

  function cardReturnFallback() {
    const candidates = [
      cardPanelToggleRef.current,
      document.querySelector<HTMLElement>('.historyWorkspaceNav[aria-label="展开会话栏"]'),
      document.querySelector<HTMLElement>('.primaryNavButton[aria-current="page"]')
    ];
    return candidates.find((candidate) => canReturnCardToElement(candidate)) ?? null;
  }

  function restoreShelfCardFocus() {
    window.requestAnimationFrame(() => {
      const trigger = canReturnCardToElement(shelfCardTriggerRef.current)
        ? shelfCardTriggerRef.current
        : cardReturnFallback();
      trigger?.focus({ preventScroll: true });
      shelfCardTriggerRef.current = null;
    });
  }

  function closeShelfCard() {
    if (!viewedShelfCard || !knowledgeCardDockRef.current) {
      setViewingCard(null);
      restoreShelfCardFocus();
      return;
    }
    const requestedSource = shelfCardTriggerRef.current;
    if (!canAnimateCardToElement(requestedSource)) {
      setShelfCardTransitionPhase("closingFallback");
      return;
    }
    const origin = requestedSource.getBoundingClientRect();
    const target = knowledgeCardDockRef.current.getBoundingClientRect();
    const offset = cardWindowRef.current?.consumeOffsetAndReset() ?? { x: 0, y: 0 };
    flushSync(() => {
      setShelfCardMotion({
        x: origin.left - target.left,
        y: origin.top - target.top,
        scaleX: origin.width / target.width,
        scaleY: origin.height / target.height,
        startX: offset.x,
        startY: offset.y
      });
      setShelfCardTransitionPhase("closing");
    });
  }

  useLayoutEffect(() => {
    if (shelfCardTransitionPhase !== "preparing" || !viewedShelfCard) return;
    const origin = shelfCardOriginRef.current;
    const target = knowledgeCardDockRef.current?.getBoundingClientRect();
    if (!origin || !target) return;
    setShelfCardMotion({
      x: origin.left - target.left,
      y: origin.top - target.top,
      scaleX: origin.width / target.width,
      scaleY: origin.height / target.height
    });
    setShelfCardTransitionPhase("opening");
  }, [shelfCardTransitionPhase, viewedShelfCard]);

  useEffect(() => {
    if (viewedShelfCard) return;
    shelfCardOriginRef.current = null;
    setShelfCardMotion(null);
    setShelfCardTransitionPhase("idle");
  }, [viewedShelfCard]);

  useEffect(() => {
    if (!viewedShelfCardId || shelfCardTransitionPhase !== "open") return;
    const frameId = window.requestAnimationFrame(() => {
      cardWindowRef.current?.focusHandle();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [shelfCardTransitionPhase, viewedShelfCardId]);

  useEffect(() => {
    const bootstrapNavigationToken = bootstrapNavigationRef.current;
    refreshProfiles();
    refreshCards();
    refreshMistakeSets();
    void refreshExamPapers();
    void restoreWorkspaceAfterRefresh(bootstrapNavigationToken);
    if (window.innerWidth <= 1319) setRightOpen(false);
    if (window.innerWidth <= 760) setLeftOpen(false);
    // Initial bootstrap only; later refreshes are triggered by explicit mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: streamBusy ? "auto" : "smooth" });
  }, [activeCard?.id, activeCards.length, checkpoint?.id, messages, streamBusy]);

  useEffect(() => {
    if (!collectionNotice) return;
    const timeoutId = window.setTimeout(() => setCollectionNotice(""), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [collectionNotice]);

  useEffect(() => {
    if (pendingCardMotionKey === null) setPendingCardMotionReadyKey(null);
  }, [pendingCardMotionKey]);

  useEffect(() => {
    if (activeCards.length || checkpoint) setViewingCard(null);
  }, [activeCards.length, checkpoint, setViewingCard]);

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

  useEffect(() => {
    if (!mistakeSetPrintJob) return;

    let cancelled = false;
    const previousTitle = document.title;
    document.title = mistakeSetPrintJob.name;
    const handleAfterPrint = () => setMistakeSetPrintJob(null);
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
  }, [mistakeSetPrintJob]);

  async function waitForActiveRunToSettle(targetSessionId: string) {
    let status = await fetchSessionRunStatus(targetSessionId);
    for (let attempt = 0; status.active && attempt < 120; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
      status = await fetchSessionRunStatus(targetSessionId);
    }
    return status;
  }

  function sessionNeedsResponse(opened: Awaited<ReturnType<typeof fetchSession>>) {
    if (opened.pending_checkpoint) return false;
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
    if (!shouldResume || opened.pending_checkpoint) return;

    await runtime.runStream(targetSessionId);
    status = await fetchSessionRunStatus(targetSessionId);
    if (!status.active && foreground && runtime.isSessionActive(targetSessionId)) {
      runtime.loadSession(await fetchSession(targetSessionId));
    }
  }

  async function restoreSessionAfterRefresh(targetSessionId: string, bootstrapNavigationToken: number) {
    const opened = await fetchSession(targetSessionId);
    if (bootstrapNavigationRef.current !== bootstrapNavigationToken) return;
    runtime.loadSession(opened);
    setHistoryView(null);
    setMistakeSetView(null);
    setKnowledgeView(null);
    setMistakeExportDraft(null);
    setContentNavigation("history");
    setRightOpen(false);
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
      message: pending.text,
      image_data_url: pending.imageDataUrl
    });
    clearPendingStudentRequest(window.localStorage, pending.operationId);
  }

  function queueInterjection(targetSessionId: string, text: string, imageDataUrl?: string | null) {
    const pending: PendingStudentRequest = {
      operationId: crypto.randomUUID(),
      sessionId: targetSessionId,
      text,
      imageDataUrl,
      clientMessageId: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    const queue = queuedInterjectionsRef.current.get(targetSessionId) ?? [];
    queuedInterjectionsRef.current.set(targetSessionId, [...queue, pending]);
    savePendingStudentRequest(window.localStorage, pending);
    runtime.addMessage(
      "student",
      text || "我上传了一张补充图片，请结合图片内容回答。",
      "STUDENT_RESPONSE",
      imageDataUrl,
      `client:${pending.clientMessageId}`
    );
    clearComposerInput(draftScope(targetSessionId));
  }

  async function flushQueuedInterjections(targetSessionId: string) {
    if (flushingInterjectionsRef.current.has(targetSessionId)) return;
    if (!(queuedInterjectionsRef.current.get(targetSessionId)?.length)) return;
    flushingInterjectionsRef.current.add(targetSessionId);
    let shouldStartRun = false;
    try {
      while (true) {
        const queue = queuedInterjectionsRef.current.get(targetSessionId) ?? [];
        const pending = queue[0];
        if (!pending) break;
        await resumePendingStudentRequest(pending);
        queuedInterjectionsRef.current.set(targetSessionId, queue.slice(1));
        shouldStartRun = true;
      }
      queuedInterjectionsRef.current.delete(targetSessionId);
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.loadSession(await fetchSession(targetSessionId));
      }
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.setError(nextError instanceof Error ? nextError.message : "提交插嘴消息失败");
      }
    } finally {
      flushingInterjectionsRef.current.delete(targetSessionId);
    }
    if (shouldStartRun && !(queuedInterjectionsRef.current.get(targetSessionId)?.length)) {
      void runtime.runStream(targetSessionId);
    }
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

  async function restoreImageDraftAfterRefresh(bootstrapNavigationToken: number) {
    try {
      const draft = await loadImageDraft();
      if (!draft) return false;
      if (bootstrapNavigationRef.current !== bootstrapNavigationToken) return true;
      const token = viewTokenRef.current;
      const dataUrl = await blobToDataUrl(draft.imageBlob);
      if (bootstrapNavigationRef.current !== bootstrapNavigationToken) return true;
      const file = new File([draft.imageBlob], draft.filename, {
        type: draft.contentType || draft.imageBlob.type || "image/png"
      });
      const pending: PendingComposerImage = {
        dataUrl,
        file,
        operationId: draft.operationId,
        createdAt: draft.createdAt
      };
      setSelectedProfileId(draft.profileId);
      setGradeBand(draft.gradeBand);

      if (draft.stage === "pending") {
        setPendingComposerImage(pending);
        return true;
      }
      if (draft.stage === "detecting") {
        setPendingComposerImage(pending);
        await handlePendingImageSend(pending, {
          profileId: draft.profileId,
          gradeBand: draft.gradeBand,
          viewToken: token,
          bootstrapNavigationToken
        });
        return true;
      }

      const selection: PendingImageSelection = {
        operationId: draft.operationId,
        imageBlob: draft.imageBlob,
        imageUrl: dataUrl,
        contentType: draft.contentType,
        filename: draft.filename,
        profileId: draft.profileId,
        gradeBand: draft.gradeBand,
        createdAt: draft.createdAt,
        viewToken: token,
        regions: draft.regions,
        startItems: draft.startItems,
        paperId: draft.paperId
      };
      setImageSelection(selection);
      if (draft.stage === "starting" && draft.startItems?.length && draft.paperId) {
        await submitImageSelection(selection, draft.regions, draft.paperId);
      }
      return true;
    } catch (nextError) {
      runtime.setError(
        nextError instanceof Error ? nextError.message : "恢复图片框选草稿失败"
      );
      return true;
    }
  }

  async function restoreWorkspaceAfterRefresh(bootstrapNavigationToken: number) {
    const recoveredSessionIds: string[] = [];
    const recoveredImageDraft = await restoreImageDraftAfterRefresh(bootstrapNavigationToken);
    const pendingBatch = recoveredImageDraft
      ? null
      : loadPendingSessionBatch(window.localStorage);
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
        await waitForActiveRunToSettle(pending.sessionId);
        await resumePendingStudentRequest(pending);
        if (!recoveredSessionIds.includes(pending.sessionId)) {
          recoveredSessionIds.push(pending.sessionId);
        }
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

    if (!pendingBatch && !recoveredImageDraft) {
      const activeSessionId = loadActiveSessionId(window.localStorage)
        || recoveredSessionIds.at(-1)
        || "";
      if (activeSessionId) {
        try {
          await restoreSessionAfterRefresh(activeSessionId, bootstrapNavigationToken);
        } catch (nextError) {
          if (bootstrapNavigationRef.current === bootstrapNavigationToken) {
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
    setHistoryLoadError("");
    try {
      const nextItems = await fetchSessionHistory();
      if (historyRequestRef.current === requestId) setHistoryItems(nextItems);
      return nextItems;
    } catch (nextError) {
      if (historyRequestRef.current === requestId) {
        setHistoryLoadError(nextError instanceof Error ? nextError.message : "历史会话加载失败");
      }
    } finally {
      if (historyRequestRef.current === requestId) setHistoryBusy(false);
    }
  }

  async function refreshExamPapers() {
    const requestId = examPapersRequestRef.current + 1;
    examPapersRequestRef.current = requestId;
    try {
      const nextPapers = await fetchExamPapers();
      if (examPapersRequestRef.current === requestId) setExamPapers(nextPapers);
      return nextPapers;
    } catch (nextError) {
      if (examPapersRequestRef.current === requestId) {
        runtime.setError(nextError instanceof Error ? nextError.message : "试卷列表加载失败");
      }
    }
  }

  function clearCurrentSessionState() {
    openSessionRequestRef.current += 1;
    const previousViewToken = viewTokenRef.current;
    viewTokenRef.current += 1;
    pendingSessionBatchesRef.current.delete(previousViewToken);
    void clearImageDraft();
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
    setViewingCard(null);
    void clearImageDraft();
    setImageSelection(null);
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

  function handleOpenHistoryPaper(group: HistoryPaperGroup) {
    setHistorySelectedPaperName(group.name);
    setHistoryView({ mode: "paper", paperId: group.id });
  }

  function handleOpenHistorySession(targetSessionId: string) {
    invalidateBootstrapNavigation();
    setHistoryView(null);
    setMistakeSetView(null);
    setKnowledgeView(null);
    setMistakeExportDraft(null);
    setContentNavigation("history");
    setRightOpen(false);
    closeNavigationOnMobile();
    void handleOpenSession(targetSessionId);
  }

  function handleStartNewChat() {
    invalidateBootstrapNavigation();
    setHistoryView(null);
    setMistakeSetView(null);
    setKnowledgeView(null);
    setMistakeExportDraft(null);
    setContentNavigation("start");
    setRightOpen(false);
    clearCurrentSessionState();
    closeNavigationOnMobile();
  }

  async function handleDeleteSession(item: SessionHistoryItem) {
    if (
      item.session_id === sessionId
      || runningSessionIds.includes(item.session_id)
      || Boolean(openSessionBusyId)
      || Boolean(deleteSessionBusyId)
    ) return;
    if (!window.confirm(`删除会话“${item.title || "未命名题目"}”？已归档卡片会保留。`)) return;
    setDeleteSessionBusyId(item.session_id);
    runtime.clearError();
    try {
      await deleteSession(item.session_id);
      clearPendingStudentRequestsForSession(window.localStorage, item.session_id);
      clearComposerDraft(window.localStorage, draftScope(item.session_id));
      if (sessionId === item.session_id) clearCurrentSessionState();
      const [nextItems] = await Promise.all([
        refreshHistory(),
        refreshExamPapers(),
        refreshCards()
      ]);
      if (nextItems && item.paper_id && !nextItems.some((candidate) => candidate.paper_id === item.paper_id)) {
        setHistoryView((current) => current?.mode === "paper" && current.paperId === item.paper_id
          ? { mode: "overview" }
          : current);
        setCollectionNotice(`“${item.paper_name || "这份试卷"}”已没有题目，已返回错题合集。`);
      }
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "删除会话失败");
    } finally {
      setDeleteSessionBusyId("");
    }
  }

  async function handleDeleteAllSessions() {
    if (!window.confirm("清空全部会话？会话、消息、检查点和诊断日志会永久删除，已归档卡片会保留。")) return;
    const clearingFromCollection = historyView !== null;
    setDeleteAllSessionsBusy(true);
    runtime.clearError();
    try {
      await deleteAllSessions();
      historyRequestRef.current += 1;
      examPapersRequestRef.current += 1;
      invalidateCardRefresh();
      clearAllRequestRecovery(window.localStorage);
      try {
        await clearImageDraft();
      } catch {
        // Server deletion already succeeded; browser cleanup is best effort.
      }
      setHistoryItems([]);
      setExamPapers([]);
      setHistoryView(clearingFromCollection ? { mode: "overview" } : null);
      setContentNavigation(clearingFromCollection ? "mistake_collection" : "start");
      setRightOpen(false);
      setCollectionNotice(clearingFromCollection
        ? "全部会话与活动试卷已清空，已归档卡片仍会保留。"
        : "");
      clearCurrentSessionState();
      await refreshCards();
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
    if (pendingComposerImage && !sessionId) {
      if (text) {
        runtime.setError("图片题目暂不支持同时附带文字，请先清空文字或移除图片。");
        return;
      }
      await handlePendingImageSend(pendingComposerImage);
      return;
    }
    const sessionImage = sessionId ? pendingComposerImage : null;
    if (sessionImage && !selectedProfile?.is_multimodal) {
      runtime.setError("当前会话使用的模型不支持图片输入，请新建答疑并选择多模态模型。");
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
      if (
        streamBusy
        || flushingInterjectionsRef.current.has(targetSessionId)
        || Boolean(queuedInterjectionsRef.current.get(targetSessionId)?.length)
      ) {
        queueInterjection(targetSessionId, text, sessionImage?.dataUrl);
        setPendingComposerImage(null);
        sendInFlightKeysRef.current.delete(operationKey);
        return;
      }
      const respondsToCheckpoint = workflow.mode === "checkpoint" && workflow.phase === "ready";
      const previous = pendingStudentMessagesRef.current.get(targetSessionId)
        ?? listPendingStudentRequests(window.localStorage).find(
          (candidate) => (
            candidate.sessionId === targetSessionId
            && candidate.text === text
            && (candidate.imageDataUrl ?? null) === (sessionImage?.dataUrl ?? null)
          )
        );
      const isRetry = previous?.sessionId === sessionId
        && previous.text === text
        && (previous.imageDataUrl ?? null) === (sessionImage?.dataUrl ?? null);
      const pending = isRetry
        ? previous
        : {
            operationId: crypto.randomUUID(),
            sessionId: targetSessionId,
            text,
            imageDataUrl: sessionImage?.dataUrl,
            clientMessageId: crypto.randomUUID(),
            createdAt: new Date().toISOString()
          };
      pendingStudentMessagesRef.current.set(targetSessionId, pending);
      savePendingStudentRequest(window.localStorage, pending);
      clearComposerInput(draftScope(targetSessionId));
      setPendingComposerImage(null);
      if (!isRetry) {
        runtime.addMessage(
          "student",
          text || "我上传了一张补充图片，请结合图片内容回答。",
          "STUDENT_RESPONSE",
          sessionImage?.dataUrl,
          `client:${pending.clientMessageId}`
        );
      }
      if (respondsToCheckpoint) runtime.beginCheckpointSubmission();
      try {
        const accepted = await acceptStudentMessage({
          session_id: targetSessionId,
          client_message_id: pending.clientMessageId,
          message: text,
          image_data_url: pending.imageDataUrl
        });
        if (accepted.deferred_card_id && accepted.card_deferred_at) {
          runtime.deferPendingCard(accepted.deferred_card_id, accepted.card_deferred_at);
        }
        pendingStudentMessagesRef.current.delete(targetSessionId);
        if (respondsToCheckpoint) runtime.completeCheckpointFreeTextSubmission();
        clearPendingStudentRequest(window.localStorage, pending.operationId);
        await runtime.runStream(targetSessionId);
      } catch (nextError) {
        if (runtime.isSessionActive(targetSessionId)) {
          restoreComposerInput(text, draftScope(targetSessionId));
          if (sessionImage) setPendingComposerImage(sessionImage);
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
    if (sessionId && !selectedProfile?.is_multimodal) {
      runtime.setError("当前会话使用的模型不支持图片输入，请新建答疑并选择多模态模型。");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    if (!sessionId && input.trim()) {
      runtime.setError("请先清空输入框中的文字，再添加题目图片。");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    if (pendingComposerImage) {
      runtime.setError("一次只能添加一张图片，请先移除当前图片。");
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
      const operationId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const pending = { dataUrl, file, operationId, createdAt };
      setPendingComposerImage(pending);
      if (!sessionId) {
        const persisted = await persistImageDraft({
          version: 1,
          operationId,
          stage: "pending",
          imageBlob: file,
          contentType: file.type || "image/png",
          filename: file.name || "clipboard-image.png",
          profileId: selectedProfileId,
          gradeBand,
          regions: [],
          createdAt
        });
        if (!persisted) runtime.setError(
          "图片已保留在当前页面，但浏览器无法持久化草稿；刷新前请先完成框选。"
        );
      }
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

  async function handlePendingImageSend(
    pendingImage: PendingComposerImage,
    recovery?: {
      profileId: string;
      gradeBand: "junior" | "senior";
      viewToken: number;
      bootstrapNavigationToken?: number;
    }
  ) {
    if (sessionId) return;
    if (!recovery && !selectedProfile?.is_multimodal) {
      runtime.setError(
        multimodalProfiles.length
          ? "请先选中一个支持图片识别的多模态模型，再上传题目图片。"
          : "上传图片需要多模态模型，请先在模型设置中添加并标记“支持图片识别”。"
      );
      return;
    }
    const profileId = recovery?.profileId ?? selectedProfile!.id;
    const originatingViewToken = recovery?.viewToken ?? viewTokenRef.current;
    const operationKey = `draft:${originatingViewToken}`;
    if (sendInFlightKeysRef.current.has(operationKey)) return;
    const targetGradeBand = recovery?.gradeBand ?? gradeBand;
    const bootstrapNavigationIsCurrent = () => recovery?.bootstrapNavigationToken === undefined
      || bootstrapNavigationRef.current === recovery.bootstrapNavigationToken;
    if (!bootstrapNavigationIsCurrent()) return;
    sendInFlightKeysRef.current.add(operationKey);
    const operationId = pendingImage.operationId ?? crypto.randomUUID();
    const createdAt = pendingImage.createdAt ?? new Date().toISOString();
    const detectingDraft: PersistedImageDraft = {
      version: 1,
      operationId,
      stage: "detecting",
      imageBlob: pendingImage.file,
      contentType: pendingImage.file.type || "image/png",
      filename: pendingImage.file.name || "clipboard-image.png",
      profileId,
      gradeBand: targetGradeBand,
      regions: [],
      createdAt
    };
    runtime.startComposerTask("image");
    runtime.clearError();
    try {
      await persistImageDraft(detectingDraft);
      const detected = await detectProblemImageRegions({
        model_profile_id: profileId,
        image_base64: pendingImage.dataUrl,
        content_type: pendingImage.file.type || "image/png",
        filename: pendingImage.file.name || "clipboard-image.png"
      });
      if (
        viewTokenRef.current === originatingViewToken
        && runtime.isDraftActive()
        && bootstrapNavigationIsCurrent()
      ) {
        const selection: PendingImageSelection = {
          operationId,
          imageBlob: pendingImage.file,
          imageUrl: pendingImage.dataUrl,
          contentType: pendingImage.file.type || "image/png",
          filename: pendingImage.file.name || "clipboard-image.png",
          profileId,
          gradeBand: targetGradeBand,
          createdAt,
          viewToken: originatingViewToken,
          regions: detected.problems
        };
        await persistImageDraft(persistedSelection(selection, "selecting"));
        setImageSelection(selection);
        setPendingComposerImage(null);
        runtime.finishComposerTask();
      } else if (!bootstrapNavigationIsCurrent() && runtime.isDraftActive()) {
        setPendingComposerImage(null);
        runtime.finishComposerTask();
      }
    } catch (nextError) {
      if (
        viewTokenRef.current === originatingViewToken
        && runtime.isDraftActive()
        && bootstrapNavigationIsCurrent()
      ) {
        try {
          await saveImageDraft({ ...detectingDraft, stage: "pending" });
        } catch {
          // Keep the original detection error visible.
        }
        runtime.failComposerTask(nextError instanceof Error ? nextError.message : "题目框检测失败");
      } else if (!bootstrapNavigationIsCurrent() && runtime.isDraftActive()) {
        setPendingComposerImage(null);
        runtime.finishComposerTask();
      }
    } finally {
      sendInFlightKeysRef.current.delete(operationKey);
    }
  }

  async function submitImageSelection(
    selection: PendingImageSelection,
    regions: DetectedProblemRegion[],
    paperId: string
  ) {
    if (!regions.length) return;
    const startItems = stableImageStartItems(regions, selection.startItems);
    const startingSelection = { ...selection, regions, startItems, paperId };
    setImageSelection(startingSelection);
    setImageConfirmBusy(true);
    runtime.clearError();
    try {
      await persistImageDraft(persistedSelection(startingSelection, "starting"));
      const result = await batchStartImageSessions({
        grade_band: selection.gradeBand,
        subject: "math",
        model_profile_id: selection.profileId,
        paper_id: paperId,
        source_image_data_url: selection.imageUrl,
        items: startItems.map((item) => ({
          session_id: item.session_id,
          client_message_id: item.client_message_id,
          bbox: item.bbox
        }))
      });
      try {
        await clearImageDraft();
      } catch {
        // Session ids are durable and idempotent; stale browser cleanup must not hide success.
      }
      setImageSelection(null);
      await refreshExamPapers();
      if (imageInputRef.current) imageInputRef.current.value = "";
      await finishSessionBatchStart(result.sessions, selection.viewToken);
    } catch (nextError) {
      if (isApiResponseError(nextError, 400)) {
        await Promise.all([refreshExamPapers(), refreshCards()]);
      }
      runtime.setError(nextError instanceof Error ? nextError.message : "裁剪图片或创建答疑会话失败");
    } finally {
      setImageConfirmBusy(false);
    }
  }

  async function handleConfirmImageRegions(
    regions: DetectedProblemRegion[],
    paperSelection: PaperSelection
  ) {
    if (!imageSelection || imageConfirmBusy || !regions.length) return;
    setImageConfirmBusy(true);
    runtime.clearError();
    try {
      let paper = paperSelection.mode === "existing"
        ? examPapers.find((item) => item.id === paperSelection.paperId)
        : undefined;
      if (paperSelection.mode === "new") {
        paper = await createExamPaper(paperSelection.name);
        await Promise.all([refreshExamPapers(), refreshCards()]);
      }
      if (!paper) throw new Error("所选试卷不存在，请重新选择");
      await submitImageSelection(imageSelection, regions, paper.id);
    } catch (nextError) {
      if (isApiResponseError(nextError, 400)) {
        await Promise.all([refreshExamPapers(), refreshCards()]);
      }
      runtime.setError(nextError instanceof Error ? nextError.message : "创建或选择试卷失败");
      setImageConfirmBusy(false);
    }
  }

  function handleImageRegionsChange(regions: DetectedProblemRegion[]) {
    if (imageConfirmBusy) return;
    setImageSelection((current) => {
      if (!current) return current;
      const startItems = current.startItems
        ? stableImageStartItems(regions, current.startItems)
        : undefined;
      const next = { ...current, regions, startItems };
      void persistImageDraft(persistedSelection(next, "selecting"));
      return next;
    });
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

  async function handleCheckpointFreeText(responseText: string) {
    const text = responseText.trim();
    if (!text || !checkpoint || !sessionId || workflow.mode !== "checkpoint" || workflow.phase !== "ready") return;
    const targetSessionId = sessionId;
    const pending: PendingStudentRequest = {
      operationId: crypto.randomUUID(),
      sessionId: targetSessionId,
      text,
      clientMessageId: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    runtime.beginCheckpointSubmission();
    savePendingStudentRequest(window.localStorage, pending);
    runtime.addMessage(
      "student",
      text,
      "STUDENT_RESPONSE",
      undefined,
      `client:${pending.clientMessageId}`
    );
    try {
      await resumePendingStudentRequest(pending);
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.completeCheckpointFreeTextSubmission();
      }
      await runtime.runStream(targetSessionId);
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.failCheckpointSubmission(
          nextError instanceof Error ? nextError.message : "提交自定义回复失败"
        );
      }
    }
  }

  async function handleActiveCardSave(cardToSave: StudyCard, folderId?: string) {
    if (
      !activeCards.some((card) => card.id === cardToSave.id)
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
      if (runtime.isSessionActive(targetSessionId)) runtime.completeCardSave(cardToSave.id);
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
      !activeCards.some((card) => card.id === cardToDiscard.id)
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
      if (runtime.isSessionActive(targetSessionId)) runtime.completeCardSave(cardToDiscard.id);
      if (!cardToDiscard.deferred_at) await runtime.runStream(targetSessionId);
    } catch (nextError) {
      if (runtime.isSessionActive(targetSessionId)) {
        runtime.failCardSave(nextError instanceof Error ? nextError.message : "舍弃知识卡片失败");
      }
    }
  }

  async function handleArchivedCardSave(cardToSave: StudyCard, folderId?: string) {
    if (
      !viewingCard
      || cardToSave.id !== viewingCard.id
    ) return;
    setViewingCardSaveBusy(true);
    runtime.clearError();
    try {
      let saved = cardToSave;
      if (cardToSave.card_type === "knowledge_card" && cardToSave.content.type === "knowledge_card") {
        saved = await updateKnowledgeCard(cardToSave.id, cardToSave.content);
        upsertCard(saved);
        setViewingCard(saved);
      }
      if (folderId && folderId !== saved.folder_id) {
        saved = await moveCardRequest(saved.id, folderId);
      }
      upsertCard(saved);
      setViewingCard(saved);
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "保存卡片位置失败");
    } finally {
      setViewingCardSaveBusy(false);
    }
  }

  async function ensurePaperFolder(name: string) {
    runtime.clearError();
    try {
      const paper = await createExamPaper(name);
      await Promise.all([refreshExamPapers(), refreshCards()]);
      return paper.card_folder_id;
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "新建试卷文件夹失败");
      return null;
    }
  }

  async function handleBeginMistakeExport() {
    const selectedItems = selectedHistoryItems(historyItems, selectedMistakeSessionIds);
    if (!selectedItems.length || mistakeExportBusy) return;
    setMistakeExportBusy(true);
    runtime.clearError();
    try {
      const openedSessions = await Promise.all(selectedItems.map((item) => fetchSession(item.session_id)));
      setMistakeExportDraft({
        name: defaultMistakeSetName(),
        sessionIds: selectedItems.map((item) => item.session_id),
        items: openedSessions.map((opened, index) => ({
          id: selectedItems[index].session_id,
          source_paper_name: selectedItems[index].paper_name || "未分类题目",
          title: selectedItems[index].title || opened.problem_text || "未命名题目",
          problem_text: opened.problem_text,
          problem_image_data_url: opened.problem_image_data_url ?? null,
          position: index
        }))
      });
    } catch (nextError) {
      runtime.setError(nextError instanceof Error ? nextError.message : "生成错题集预览失败");
    } finally {
      setMistakeExportBusy(false);
    }
  }

  async function persistMistakeExport(shouldPrint: boolean) {
    if (!mistakeExportDraft || mistakeSetSaveBusy) return;
    const created = await saveMistakeSet(mistakeExportDraft.name.trim(), mistakeExportDraft.sessionIds);
    if (!created) return;
    const printJob = { name: created.name, items: created.items };
    setSelectedMistakeSessionIds([]);
    setMistakeSelectionMode(false);
    setMistakeExportDraft(null);
    setHistoryView(null);
    setKnowledgeView(null);
    setMistakeSetView(shouldPrint
      ? { mode: "detail", setId: created.id }
      : { mode: "overview" });
    setContentNavigation("mistake_sets");
    if (shouldPrint) setMistakeSetPrintJob(printJob);
  }

  function handleLearningCardExport(selectedCards: StudyCard[], layout: LearningCardExportLayout) {
    setLearningCardExportOpen(false);
    setLearningCardPrintJob({ cards: selectedCards, layout });
  }

  const activeCardDock = displayedDockCard ? (
    <div
      className={`activeKnowledgeCardDock${displayedDockCardIsArchived ? " shelfTransitionDock" : ""}`}
      ref={knowledgeCardDockRef}
      key={`dock-${displayedDockCard.id}`}
      style={displayedDockCardIsArchived && shelfCardMotion
        ? {
            "--shelf-motion-x": `${shelfCardMotion.x}px`,
            "--shelf-motion-y": `${shelfCardMotion.y}px`,
            "--shelf-motion-scale-x": shelfCardMotion.scaleX,
            "--shelf-motion-scale-y": shelfCardMotion.scaleY,
            "--shelf-close-start-x": `${shelfCardMotion.startX ?? 0}px`,
            "--shelf-close-start-y": `${shelfCardMotion.startY ?? 0}px`
          } as CSSProperties
        : undefined}
      data-shelf-transition-phase={displayedDockCardIsArchived ? shelfCardTransitionPhase : undefined}
      inert={displayedDockCardIsArchived && (
        shelfCardTransitionPhase === "closing" || shelfCardTransitionPhase === "closingFallback"
      ) ? true : undefined}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!displayedDockCardIsArchived) {
          if (
            pendingCardMotionKey
            && (event.animationName === "activeCardDockEnter"
              || event.animationName === "reducedCardDockEnter")
          ) {
            setPendingCardMotionReadyKey(pendingCardMotionKey);
          }
          return;
        }
        if (shelfCardTransitionPhase === "opening" && event.animationName === "shelfCardOpen") {
          setShelfCardTransitionPhase("open");
        } else if (shelfCardTransitionPhase === "closing" && event.animationName === "shelfCardClose") {
          flushSync(() => setViewingCard(null));
          restoreShelfCardFocus();
        } else if (
          shelfCardTransitionPhase === "closingFallback"
          && event.animationName === "shelfCardFadeClose"
        ) {
          flushSync(() => setViewingCard(null));
          restoreShelfCardFocus();
        }
      }}
    >
      <DraggableCardWindow
        ref={cardWindowRef}
        cardId={displayedDockCard.id}
        mode={displayedDockCardIsArchived ? "archived" : "pending"}
        boundsRef={centralWorkspaceActive ? historyWorkspaceRef : messageViewportRef}
        boundsKey={centralWorkspaceActive
          ? `workspace:${contentNavigation}:${historyView?.mode ?? mistakeSetView?.mode ?? knowledgeView?.mode ?? "preview"}`
          : "conversation"}
        dragEnabled={displayedDockCardIsArchived
          ? shelfCardTransitionPhase === "open" || shelfCardTransitionPhase === "closingFallback"
          : pendingCardMotionReadyKey === pendingCardMotionKey}
        onArchivedEscape={displayedDockCardIsArchived ? closeShelfCard : undefined}
      >
        <StudyCardModal
          key={displayedDockCard.id}
          card={displayedDockCard}
          folders={folders}
          libraryView={displayedDockCardIsArchived}
          onSave={displayedDockCardIsArchived
            ? (cardToSave, folderId) => void handleArchivedCardSave(cardToSave, folderId)
            : (cardToSave, folderId) => void handleActiveCardSave(cardToSave, folderId)}
          onCreatePaperFolder={ensurePaperFolder}
          onDiscard={displayedDockCardIsArchived || displayedDockCard.card_type === "problem_card"
            ? undefined
            : (cardToDiscard) => void handleActiveCardDiscard(cardToDiscard)}
          onClose={displayedDockCardIsArchived ? closeShelfCard : undefined}
          busy={displayedDockCardIsArchived ? viewingCardSaveBusy : cardSaveBusy}
          editable={displayedDockCard.card_type === "knowledge_card"}
          appearance="flashcard"
          themeVariant={displayedDockCardThemeVariant !== undefined && displayedDockCardThemeVariant >= 0
            ? displayedDockCardThemeVariant
            : undefined}
        />
      </DraggableCardWindow>
    </div>
  ) : null;

  return (
    <>
    <main className={`appShell ${responsiveReady ? "responsiveReady" : ""} ${leftOpen ? "leftOpen" : "leftClosed"} ${rightOpen ? "rightOpen" : "rightClosed"}`}>
      <AppTopbar />
      {(leftOpen || rightOpen) && (
        <button
          className="mobileScrim"
          type="button"
          aria-label="关闭侧栏"
          onClick={() => { setLeftOpen(false); setRightOpen(false); }}
        />
      )}
      <SessionSidebar
        historyItems={historyItems}
        activeSessionId={sessionId}
        historyBusy={historyBusy}
        openSessionBusyId={openSessionBusyId}
        deleteSessionBusyId={deleteSessionBusyId}
        deleteAllSessionsBusy={deleteAllSessionsBusy}
        runningSessionIds={runningSessionIds}
        activeNavigation={activeNavigation}
        onCollapse={() => setLeftOpen(false)}
        onNewChat={handleStartNewChat}
        onNavigate={(navigation) => {
          invalidateBootstrapNavigation();
          setContentNavigation(navigation);
          setViewingCard(null);
          setMistakeExportDraft(null);
          setRightOpen(false);
          if (navigation === "mistake_collection") {
            setHistoryView({ mode: "overview" });
            setMistakeSetView(null);
            setKnowledgeView(null);
          } else if (navigation === "mistake_sets") {
            setHistoryView(null);
            setMistakeSetView({ mode: "overview" });
            setKnowledgeView(null);
          } else if (navigation === "knowledge") {
            setHistoryView(null);
            setMistakeSetView(null);
            setKnowledgeView({ mode: "overview" });
          } else {
            setHistoryView(null);
            setMistakeSetView(null);
            setKnowledgeView(null);
          }
          closeNavigationOnMobile();
        }}
        onOpenSession={handleOpenHistorySession}
        onDeleteSession={handleDeleteSession}
        onDeleteAllSessions={handleDeleteAllSessions}
      />

      <section className="conversationPanel">
        {mistakeExportDraft ? (
          <>
            <section ref={historyWorkspaceRef} className="historyWorkspace" aria-label="错题集导出工作区">
              <MistakeSetPrintView
                name={mistakeExportDraft.name}
                items={mistakeExportDraft.items}
                editableName
                busy={mistakeSetSaveBusy}
                onNameChange={(name) => setMistakeExportDraft((current) => current ? { ...current, name } : current)}
                onBack={() => setMistakeExportDraft(null)}
                onSaveOnly={() => void persistMistakeExport(false)}
                onSaveAndPrint={() => void persistMistakeExport(true)}
              />
            </section>
            {activeCardDock ? <div className="historyCardOverlayStage">{activeCardDock}</div> : null}
          </>
        ) : historyView ? (
          <>
            <HistoryWorkspace
              key={historyView.mode === "paper" ? historyView.paperId : "overview"}
              workspaceRef={historyWorkspaceRef}
              view={historyView}
              items={historyItems}
              overviewQuery={historyOverviewQuery}
              sortMode={historySortMode}
              selectedPaperName={historySelectedPaperName}
              historyBusy={historyBusy}
              historyLoadError={historyLoadError}
              actionError={error ?? ""}
              notice={collectionNotice}
              leftOpen={leftOpen}
              activeSessionId={sessionId}
              runningSessionIds={runningSessionIds}
              openSessionBusyId={openSessionBusyId}
              deleteSessionBusyId={deleteSessionBusyId}
              selectionMode={mistakeSelectionMode}
              selectedSessionIds={selectedMistakeSessionIds}
              exportBusy={mistakeExportBusy}
              onExpandLeft={() => setLeftOpen(true)}
              onOverviewQueryChange={setHistoryOverviewQuery}
              onSortModeChange={setHistorySortMode}
              onOpenPaper={handleOpenHistoryPaper}
              onBackToOverview={() => setHistoryView({ mode: "overview" })}
              onOpenSession={handleOpenHistorySession}
              onDeleteSession={(item) => void handleDeleteSession(item)}
              onToggleSelectionMode={() => {
                setMistakeSelectionMode((current) => !current);
                if (mistakeSelectionMode) setSelectedMistakeSessionIds([]);
              }}
              onToggleSessionSelection={(targetSessionId) => setSelectedMistakeSessionIds((current) => (
                toggleMistakeSelection(current, targetSessionId)
              ))}
              onTogglePaperSelection={(sessionIds) => setSelectedMistakeSessionIds((current) => (
                togglePaperMistakeSelection(current, sessionIds)
              ))}
              onExportSelection={() => void handleBeginMistakeExport()}
              onStartNewChat={handleStartNewChat}
              onRetry={() => void refreshHistory()}
              onClearActionError={runtime.clearError}
              onClearNotice={() => setCollectionNotice("")}
            />
            {activeCardDock ? <div className="historyCardOverlayStage">{activeCardDock}</div> : null}
          </>
        ) : mistakeSetView ? (
          <>
            <MistakeSetWorkspace
              workspaceRef={historyWorkspaceRef}
              view={mistakeSetView}
              mistakeSets={mistakeSets}
              busy={mistakeSetsBusy}
              leftOpen={leftOpen}
              onExpandLeft={() => setLeftOpen(true)}
              onOpenSet={(setId) => setMistakeSetView({ mode: "detail", setId })}
              onBackToOverview={() => setMistakeSetView({ mode: "overview" })}
              onPrint={(set) => setMistakeSetPrintJob({ name: set.name, items: set.items })}
            />
            {activeCardDock ? <div className="historyCardOverlayStage">{activeCardDock}</div> : null}
          </>
        ) : knowledgeView ? (
          <>
            <KnowledgeWorkspace
              workspaceRef={historyWorkspaceRef}
              view={knowledgeView}
              cards={cards}
              folders={folders}
              leftOpen={leftOpen}
              onExpandLeft={() => setLeftOpen(true)}
              onOpenGroup={(group) => setKnowledgeView({ mode: "paper", groupId: group.id })}
              onBackToOverview={() => setKnowledgeView({ mode: "overview" })}
              onOpenCard={openLibraryCard}
              onMoveCard={setMovingCard}
            />
            {activeCardDock ? <div className="historyCardOverlayStage">{activeCardDock}</div> : null}
          </>
        ) : (
          <>
        <ConversationHeader
          cardPanelToggleRef={cardPanelToggleRef}
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
          onToggleCards={() => {
            setCardLibraryMode("all");
            setRightOpen((value) => !value);
          }}
          onViewProblemImage={() => {
            if (originalProblemImage) setViewerImageUrl(originalProblemImage);
          }}
        />

        <CardShelfTabs
          cards={cards}
          sessionId={sessionId}
          activeCardId={viewedShelfCard?.id}
          onOpenCard={openShelfCard}
        />

        <MessageTimeline
          messages={messages}
          messageEndRef={messageEndRef}
          viewportRef={messageViewportRef}
          onOpenImage={setViewerImageUrl}
          retryableMessageId={retryableMessageId}
          retryBusy={streamBusy}
          onRetryMessage={() => void runtime.retryRun(sessionId)}
          anchoredInteractions={anchoredActiveCards.map((card) => ({
            id: card.id,
            sourceActionId: card.source_action_id,
            title: card.content.title,
            cardType: card.card_type,
            render: (autoCollapsed, returnToAnchor, forceExpanded) => (
              <StudyCardModal
                key={card.id}
                card={card}
                folders={folders}
                onSave={(cardToSave, folderId) => void handleActiveCardSave(cardToSave, folderId)}
                onCreatePaperFolder={ensurePaperFolder}
                onDiscard={card.card_type === "knowledge_card"
                  ? (cardToDiscard) => void handleActiveCardDiscard(cardToDiscard)
                  : undefined}
                busy={cardSaveBusy}
                editable={card.card_type === "knowledge_card"}
                appearance="flashcard"
                autoCollapsed={autoCollapsed}
                forceExpanded={forceExpanded}
                onExpandCollapsed={returnToAnchor}
              />
            )
          }))}
          interaction={checkpoint ? (
            <CheckpointModal
              key={checkpoint.id}
              checkpoint={checkpoint}
              onSubmit={handleCheckpoint}
              onSubmitFreeText={handleCheckpointFreeText}
              busy={workflow.mode === "checkpoint" && workflow.phase === "submitting"}
            />
          ) : null}
        />

        <div className="conversationComposerStage">
          {activeCardDock}

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
              if (pendingComposerImage?.operationId) void clearImageDraft();
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
        </div>
          </>
        )}
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
        libraryMode={cardLibraryMode}
        onCollapse={() => {
          setRightOpen(false);
        }}
        onOpenFolder={setCurrentFolderId}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={(folder) => void deleteFolder(folder)}
        onOpenCard={openLibraryCard}
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
          papers={examPapers}
          busy={imageConfirmBusy}
          onCancel={() => {
            if (imageConfirmBusy) return;
            void clearImageDraft();
            setImageSelection(null);
            if (imageInputRef.current) imageInputRef.current.value = "";
          }}
          onRegionsChange={handleImageRegionsChange}
          onConfirm={(regions, paper) => void handleConfirmImageRegions(regions, paper)}
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
        onCreatePaperFolder={ensurePaperFolder}
      />
    </main>
    {learningCardPrintJob && (
      <LearningCardPrintView cards={learningCardPrintJob.cards} layout={learningCardPrintJob.layout} />
    )}
    {mistakeSetPrintJob && (
      <MistakeSetPrintDocument name={mistakeSetPrintJob.name} items={mistakeSetPrintJob.items} />
    )}
    </>
  );
}
