"use client";

import { BookOpen, Bot, ClipboardCheck, FileDown, History, ImageUp, Loader2, Pencil, Plus, RotateCcw, Send, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckpointModal } from "../components/CheckpointModal";
import { MathText } from "../components/MathText";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
import { StudyCardModal } from "../components/StudyCardModal";
import {
  KnowledgeCardExportDialog,
  type KnowledgeCardExportLayout
} from "../components/KnowledgeCardExportDialog";
import { KnowledgeCardPrintView } from "../components/KnowledgeCardPrintView";
import {
  answerCheckpoint,
  analyzeProblemImage,
  createSession,
  deleteAllCards,
  deleteAllSessions,
  deleteCard,
  deleteModelProfile,
  deleteSession,
  fetchCards,
  fetchProfiles,
  fetchSessionHistory,
  ModelProfile,
  Checkpoint,
  restoreSession,
  saveCard,
  SessionHistoryItem,
  StudyCard,
  streamChat
} from "../lib/api";

type ChatMessage = {
  id: string;
  role: "student" | "assistant" | "system";
  text: string;
  action?: string;
};

type KnowledgeCardPrintJob = {
  cards: StudyCard[];
  layout: KnowledgeCardExportLayout;
  id: number;
};

const ACTION_LABELS: Record<string, string> = {
  ASK_OPEN_QUESTION: "开放提问",
  ASK_MULTIPLE_CHOICE: "选择检查点",
  EXPLAIN_LOCAL: "局部讲解",
  EXPLAIN_PRINCIPLE: "原理讲解",
  RESPOND_TO_CHECKPOINT: "检查点反馈",
  SUMMARIZE: "总结"
};

function teachingActionLabel(action: string) {
  const label = ACTION_LABELS[action];
  return label ? `${label} · ${action}` : action;
}

export default function Home() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [gradeBand, setGradeBand] = useState<"junior" | "senior">("junior");
  const [problemText, setProblemText] = useState("");
  const [initialThought, setInitialThought] = useState("");
  const [visionProfileId, setVisionProfileId] = useState("");
  const [diagramImage, setDiagramImage] = useState<string | null>(null);
  const [diagramNote, setDiagramNote] = useState("");
  const [originalProblemImage, setOriginalProblemImage] = useState<string | null>(null);
  const [problemNeedsImage, setProblemNeedsImage] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [checkpointStartedAt, setCheckpointStartedAt] = useState<number | null>(null);
  const [activeCard, setActiveCard] = useState<StudyCard | null>(null);
  const [viewingCard, setViewingCard] = useState<StudyCard | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [cardFilter, setCardFilter] = useState<"all" | "knowledge_card" | "problem_card">("all");
  const [cardBusyId, setCardBusyId] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [deleteSessionBusyId, setDeleteSessionBusyId] = useState("");
  const [deleteAllSessionsBusy, setDeleteAllSessionsBusy] = useState(false);
  const [deleteAllCardsBusy, setDeleteAllCardsBusy] = useState(false);
  const [knowledgeExportOpen, setKnowledgeExportOpen] = useState(false);
  const [knowledgeCardPrintJob, setKnowledgeCardPrintJob] = useState<KnowledgeCardPrintJob | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const multimodalProfiles = useMemo(
    () => profiles.filter((profile) => profile.is_multimodal),
    [profiles]
  );
  const selectedVisionProfile = useMemo(
    () => multimodalProfiles.find((profile) => profile.id === visionProfileId),
    [multimodalProfiles, visionProfileId]
  );
  const deleteButtonTitle = sessionId
    ? "当前会话已绑定模型，重新开始前不删除配置"
    : selectedProfile
      ? `删除模型配置：${selectedProfile.display_name}`
      : "先选择一个模型配置";
  const filteredCards = useMemo(
    () => cards.filter((card) => cardFilter === "all" || card.card_type === cardFilter),
    [cards, cardFilter]
  );
  const knowledgeCards = useMemo(
    () => cards.filter((card) => card.card_type === "knowledge_card"),
    [cards]
  );

  useEffect(() => {
    refreshProfiles();
    refreshCards();
  }, []);

  useEffect(() => {
    if (visionProfileId && !multimodalProfiles.some((profile) => profile.id === visionProfileId)) {
      setVisionProfileId("");
    }
  }, [multimodalProfiles, visionProfileId]);

  useEffect(() => {
    if (!knowledgeCardPrintJob) return;

    let cancelled = false;
    const previousTitle = document.title;
    document.title = "我的数学知识卡片";
    const handleAfterPrint = () => setKnowledgeCardPrintJob(null);
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
  }, [knowledgeCardPrintJob]);

  async function refreshProfiles(selectId?: string) {
    try {
      const nextProfiles = await fetchProfiles();
      setProfiles(nextProfiles);
      const nextSelectedId = selectId ?? selectedProfileId;
      const selectionStillExists = nextProfiles.some((profile) => profile.id === nextSelectedId);
      if (selectId && selectionStillExists) {
        setSelectedProfileId(selectId);
      } else if (nextSelectedId && selectionStillExists) {
        setSelectedProfileId(nextSelectedId);
      } else if (nextProfiles.length === 1) {
        setSelectedProfileId(nextProfiles[0].id);
      } else {
        setSelectedProfileId("");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "模型列表加载失败");
    }
  }

  async function refreshCards() {
    try {
      setCards(await fetchCards());
    } catch (error) {
      setError(error instanceof Error ? error.message : "学习卡片加载失败");
    }
  }

  function appendMessage(role: ChatMessage["role"], text: string, action?: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text, action }]);
  }

  function clearCurrentSessionState() {
    setSessionId("");
    setMessages([]);
    setInput("");
    setCheckpoint(null);
    setCheckpointStartedAt(null);
    setActiveCard(null);
    setViewingCard(null);
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryBusy(true);
    setError("");
    try {
      const items = await fetchSessionHistory();
      setHistoryItems(items);
      setSelectedHistoryId((current) => current || items[0]?.session_id || "");
    } catch (error) {
      setError(error instanceof Error ? error.message : "历史会话加载失败");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function handleRestoreSession() {
    const source = historyItems.find((item) => item.session_id === selectedHistoryId);
    if (!source) return;
    const originalProfileAvailable = profiles.some((profile) => profile.id === source.model_profile_id);
    const restoreProfileId = originalProfileAvailable ? source.model_profile_id : selectedProfileId;
    if (!restoreProfileId) {
      setError("原会话模型已不可用，请先在顶部选择一个替代模型再恢复。");
      return;
    }
    setHistoryBusy(true);
    setError("");
    try {
      const restored = await restoreSession({
        session_id: source.session_id,
        model_profile_id: restoreProfileId
      });
      const restoredCards = await fetchCards();
      const restoredImage = restored.problem_image_data_url ?? null;
      setSessionId(restored.session_id);
      setSelectedProfileId(restored.model_profile_id);
      setGradeBand(restored.grade_band);
      setProblemText(restored.problem_text);
      setInitialThought(restored.student_initial_thought);
      setOriginalProblemImage(restoredImage);
      setProblemNeedsImage(Boolean(restoredImage));
      setDiagramImage(restoredImage);
      setDiagramNote(restoredImage ? "从 SQLite 历史会话恢复的题目原图" : "");
      setMessages([
        { id: crypto.randomUUID(), role: "system", text: `已从 SQLite 会话 ${source.session_id} 恢复为新会话。` },
        ...restored.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          action: message.action
        }))
      ]);
      setCheckpoint(restored.pending_checkpoint ?? null);
      setCheckpointStartedAt(restored.pending_checkpoint ? Date.now() : null);
      setCards(restoredCards);
      setActiveCard(restored.pending_card ?? null);
      setViewingCard(null);
      setHistoryOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "恢复历史会话失败");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function handleDeleteSession(item: SessionHistoryItem) {
    const confirmed = window.confirm(
      `删除历史会话“${item.title || "未命名题目"}”？会话记录和对应日志都会被永久删除，已归档学习卡片会继续保留在全局卡片库。`
    );
    if (!confirmed) return;

    setDeleteSessionBusyId(item.session_id);
    setError("");
    try {
      await deleteSession(item.session_id);
      const remaining = historyItems.filter((candidate) => candidate.session_id !== item.session_id);
      setHistoryItems(remaining);
      setSelectedHistoryId((current) =>
        current === item.session_id ? remaining[0]?.session_id || "" : current
      );
      if (sessionId === item.session_id) {
        clearCurrentSessionState();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除历史会话失败");
    } finally {
      setDeleteSessionBusyId("");
    }
  }

  async function handleDeleteAllSessions() {
    const confirmed = window.confirm(
      "清空全部会话？SQLite 中的所有会话、消息、检查点、未归档流程卡片和全部 session 日志都会永久删除。已归档学习卡片和模型配置会保留。"
    );
    if (!confirmed) return;

    setDeleteAllSessionsBusy(true);
    setError("");
    try {
      await deleteAllSessions();
      setHistoryItems([]);
      setSelectedHistoryId("");
      clearCurrentSessionState();
    } catch (error) {
      setError(error instanceof Error ? error.message : "清空全部会话失败");
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

  async function runStream(
    nextSessionId: string,
    message?: string
  ) {
    setStreamBusy(true);
    setError("");
    let assistantId = "";
    let assistantText = "";
    let retryBaseline = "";
    let retryText = "";
    let retryingAssistant = false;
    let receivedVisibleText = false;
    let receivedCheckpoint = false;
    let receivedCard = false;
    let cardWaitingForMessageDone: StudyCard | null = null;
    let receivedError = false;

    function setAssistantMessage(nextText: string) {
      if (!nextText.trim()) return;
      receivedVisibleText = true;
      if (!assistantId) assistantId = crypto.randomUUID();
      assistantText = nextText;
      const id = assistantId;
      const textForState = nextText;
      setMessages((current) => {
        const exists = current.some((item) => item.id === id);
        if (!exists) {
          return [...current, { id, role: "assistant", text: textForState }];
        }
        return current.map((item) => (item.id === id ? { ...item, text: textForState } : item));
      });
    }

    function appendAssistantDelta(text: string) {
      if (!text) return;
      if (retryingAssistant) {
        retryText += text;
        // Keep the already rendered text while the retry is reproducing the
        // same prefix. This avoids clearing and typing the same answer twice.
        if (retryBaseline.startsWith(retryText)) return;
        retryingAssistant = false;
        setAssistantMessage(retryText);
        return;
      }
      setAssistantMessage(assistantText + text);
    }

    function resetAssistantMessage() {
      retryBaseline = assistantText;
      retryText = "";
      retryingAssistant = Boolean(assistantId && assistantText);
    }

    function reconcileAssistantMessage(finalText?: string) {
      if (!finalText?.trim()) return;
      if (retryingAssistant) {
        retryingAssistant = false;
        retryBaseline = "";
        retryText = "";
        setAssistantMessage(finalText);
        return;
      }
      if (!assistantText || finalText.startsWith(assistantText) || finalText.length >= assistantText.length) {
        setAssistantMessage(finalText);
      }
    }

    try {
      await streamChat({ session_id: nextSessionId, message }, (event) => {
        if (event.event === "decision") {
          const data = event.data as { state_hint?: string; action?: string; wait_for_student?: boolean; message?: string; breakpoint?: string };
          reconcileAssistantMessage(data.message);
          if (assistantId && data.action) {
            const id = assistantId;
            setMessages((current) => current.map((item) => (item.id === id ? { ...item, action: data.action } : item)));
          }
        }
        if (event.event === "message_delta") {
          const text = (event.data as { text: string }).text;
          appendAssistantDelta(text);
        }
        if (event.event === "message_reset") {
          resetAssistantMessage();
        }
        if (event.event === "checkpoint_ready") {
          receivedCheckpoint = true;
          setCheckpoint(event.data as Checkpoint);
          setCheckpointStartedAt(Date.now());
        }
        if (event.event === "card_ready") {
          receivedCard = true;
          cardWaitingForMessageDone = event.data as StudyCard;
        }
        if (event.event === "error") {
          receivedError = true;
          if (retryingAssistant && assistantId) {
            const id = assistantId;
            assistantId = "";
            assistantText = "";
            retryBaseline = "";
            retryText = "";
            retryingAssistant = false;
            setMessages((current) => current.filter((item) => item.id !== id));
          }
          setError((event.data as { message: string }).message);
        }
        if (event.event === "message_done") {
          assistantId = "";
          assistantText = "";
          retryBaseline = "";
          retryText = "";
          retryingAssistant = false;
          if (cardWaitingForMessageDone) {
            setViewingCard(null);
            setActiveCard(cardWaitingForMessageDone);
            cardWaitingForMessageDone = null;
          }
        }
      });
      if (!receivedVisibleText && !receivedCheckpoint && !receivedCard && !receivedError) {
        appendMessage("system", "这一轮模型没有返回可见内容。请再发一句你的当前想法，或重新开始这道题。");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "答疑请求失败");
    } finally {
      setStreamBusy(false);
    }
  }

  async function handleStart() {
    if (!selectedProfileId) {
      setError("请选择本次答疑使用的模型；如果还没有可用模型，请先添加模型配置。");
      return;
    }
    if (!problemText.trim()) {
      setError("请先粘贴一道数学题。");
      return;
    }
    if (problemNeedsImage && !selectedProfile?.is_multimodal) {
      setError("这道题包含必须查看的题图，请选择一个支持图片识别的多模态模型进行答疑。");
      return;
    }
    if (problemNeedsImage && !originalProblemImage) {
      setError("题目原图已丢失，请重新上传图片。");
      return;
    }
    setStartBusy(true);
    setError("");
    setMessages([]);
    try {
      const session = await createSession({
        grade_band: gradeBand,
        subject: "math",
        model_profile_id: selectedProfileId,
        problem_text: problemText,
        student_initial_thought: initialThought,
        problem_image_data_url: problemNeedsImage ? originalProblemImage : null
      });
      setSessionId(session.session_id);
      setCheckpoint(null);
      setCheckpointStartedAt(null);
      setActiveCard(null);
      setViewingCard(null);
      appendMessage("system", `已创建答疑会话，使用模型：${selectedProfile?.display_name ?? selectedProfileId}`);
      setStartBusy(false);
      await runStream(session.session_id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建会话失败");
    } finally {
      setStartBusy(false);
    }
  }

  async function handleDeleteProfile() {
    if (!selectedProfile) return;
    if (sessionId) {
      setError("当前答疑会话已绑定这个模型。请在开始新答疑前删除模型配置。");
      return;
    }
    const confirmed = window.confirm(`删除模型配置“${selectedProfile.display_name}”？删除后不会再出现在新答疑选择里。`);
    if (!confirmed) return;

    setDeleteBusyId(selectedProfile.id);
    setError("");
    try {
      await deleteModelProfile(selectedProfile.id);
      await refreshProfiles();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除模型配置失败");
    } finally {
      setDeleteBusyId("");
    }
  }

  async function handleImageFile(file?: File) {
    if (!file) return;
    if (!selectedVisionProfile) {
      setError("请先选择一个已标记为多模态的模型配置，再上传图片。");
      return;
    }
    setProblemText("");
    setInitialThought("");
    setDiagramImage(null);
    setDiagramNote("");
    setOriginalProblemImage(null);
    setProblemNeedsImage(false);
    setImageBusy(true);
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await analyzeProblemImage({
        model_profile_id: selectedVisionProfile.id,
        image_base64: dataUrl,
        content_type: file.type || "image/png",
        filename: file.name
      });
      setProblemText(result.problem_text);
      setInitialThought(result.student_work_summary.trim());
      setProblemNeedsImage(result.needs_diagram);
      setOriginalProblemImage(dataUrl);
      setDiagramImage(result.needs_diagram ? result.diagram_image_data_url ?? null : null);
      setDiagramNote(result.diagram_note ?? "");
      if (result.needs_diagram) {
        setSelectedProfileId((current) => {
          const profile = profiles.find((item) => item.id === current);
          return profile?.is_multimodal ? current : "";
        });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "图片识别失败");
    } finally {
      setImageBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleSend() {
    if (!sessionId || !input.trim()) return;
    const text = input.trim();
    setInput("");
    appendMessage("student", text, "STUDENT_RESPONSE");
    await runStream(sessionId, text);
  }

  async function handleCheckpoint(optionId: string) {
    if (!checkpoint || !sessionId) return;
    const activeCheckpoint = checkpoint;
    const startedAt = checkpointStartedAt;
    const elapsed = checkpointStartedAt ? Date.now() - checkpointStartedAt : 0;
    setCheckpoint(null);
    setCheckpointStartedAt(null);
    try {
      const answer = await answerCheckpoint({
        checkpointId: checkpoint.id,
        session_id: sessionId,
        selected_option_id: optionId,
        elapsed_ms: elapsed
      });
      appendMessage("student", answer.student_message, "CHECKPOINT_RESPONSE");
      await runStream(sessionId);
    } catch (error) {
      setCheckpoint(activeCheckpoint);
      setCheckpointStartedAt(startedAt);
      setError(error instanceof Error ? error.message : "提交检查点失败");
    }
  }

  async function handleActiveCardClose() {
    if (!activeCard || !sessionId || cardBusyId || streamBusy) return;
    const cardToSave = activeCard;
    setCardBusyId(cardToSave.id);
    setError("");
    try {
      const saved = await saveCard(cardToSave.id, sessionId);
      setCards((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setActiveCard(null);
      if (cardToSave.card_type === "knowledge_card") {
        await runStream(sessionId);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存学习卡片失败");
    } finally {
      setCardBusyId("");
    }
  }

  async function handleDeleteCard(card: StudyCard) {
    if (cardBusyId) return;
    const confirmed = window.confirm(`删除卡片“${card.content.title}”？删除后无法恢复。`);
    if (!confirmed) return;
    setCardBusyId(card.id);
    setError("");
    try {
      await deleteCard(card.id);
      setCards((current) => current.filter((item) => item.id !== card.id));
      setViewingCard((current) => current?.id === card.id ? null : current);
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除学习卡片失败");
    } finally {
      setCardBusyId("");
    }
  }

  async function handleDeleteAllCards() {
    const confirmed = window.confirm(
      "清空全部学习卡片？所有知识卡片和题目卡片都会永久删除，会话、消息和日志会保留。"
    );
    if (!confirmed) return;

    setDeleteAllCardsBusy(true);
    setError("");
    try {
      await deleteAllCards();
      setCards([]);
      setActiveCard(null);
      setViewingCard(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "清空全部学习卡片失败");
    } finally {
      setDeleteAllCardsBusy(false);
    }
  }

  function handleKnowledgeCardExport(selectedCards: StudyCard[], layout: KnowledgeCardExportLayout) {
    setKnowledgeExportOpen(false);
    setKnowledgeCardPrintJob({ cards: selectedCards, layout, id: Date.now() });
  }

  return (
    <>
    <main className="shell">
      <section className="topbar">
        <div className="brand">
          <div className="brandMark">
            <Bot size={22} />
          </div>
          <div>
            <h1>诊断式数学答疑 MVP</h1>
            <p>先找卡点，再从断点附近讲。</p>
          </div>
        </div>
        <div className="modelStrip">
          <button className="secondaryButton" type="button" onClick={openHistory} disabled={startBusy || streamBusy || historyBusy || Boolean(activeCard)}>
            <History size={16} />
            历史会话
          </button>
          <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={startBusy || streamBusy || Boolean(deleteBusyId)}>
            <option value="">选择本次模型</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id} disabled={problemNeedsImage && !profile.is_multimodal}>
                {profile.display_name} · {profile.model}{profile.is_multimodal ? " · 多模态" : ""}
              </option>
            ))}
          </select>
          <button
            className="iconButton dangerIconButton"
            type="button"
            onClick={handleDeleteProfile}
            disabled={!selectedProfile || startBusy || streamBusy || Boolean(sessionId) || Boolean(deleteBusyId)}
            title={deleteButtonTitle}
            aria-label="删除模型配置"
          >
            {deleteBusyId && deleteBusyId === selectedProfileId ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
          </button>
          <button
            className="iconButton"
            type="button"
            onClick={() => {
              setEditingProfile(selectedProfile ?? null);
              setDialogOpen(true);
            }}
            disabled={!selectedProfile || startBusy || streamBusy || Boolean(sessionId) || Boolean(deleteBusyId)}
            title={sessionId ? "当前会话已绑定模型，重新开始前再修改配置" : "修改模型配置"}
            aria-label="修改模型配置"
          >
            <Pencil size={16} />
          </button>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => {
              setEditingProfile(null);
              setDialogOpen(true);
            }}
            disabled={Boolean(deleteBusyId)}
          >
            <Plus size={16} />
            添加模型配置
          </button>
        </div>
      </section>

      <section className="workspace">
        <aside className="inputPanel">
          <div className="panelHeader">
            <h2>题目</h2>
            <span>文本 / 图片输入</span>
          </div>
          <label>
            年级
            <div className="segmented">
              <button className={gradeBand === "junior" ? "active" : ""} type="button" onClick={() => setGradeBand("junior")}>
                初中
              </button>
              <button className={gradeBand === "senior" ? "active" : ""} type="button" onClick={() => setGradeBand("senior")}>
                高中
              </button>
            </div>
          </label>
          <label>
            数学题目
            <textarea
              className="problemBox"
              value={problemText}
              onChange={(event) => setProblemText(event.target.value)}
              placeholder="粘贴一道初中或高中数学题，或用下方按钮上传题目图片自动识别。"
            />
          </label>
          <div className="imageTools">
            <select value={visionProfileId} onChange={(event) => setVisionProfileId(event.target.value)} disabled={imageBusy || multimodalProfiles.length === 0}>
              <option value="">选择图片识别模型</option>
              {multimodalProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.display_name} · {profile.model}
                </option>
              ))}
            </select>
            <input
              ref={imageInputRef}
              className="hiddenFileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => handleImageFile(event.target.files?.[0])}
            />
            <button
              className="secondaryButton"
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={imageBusy || !selectedVisionProfile}
            >
              {imageBusy ? <Loader2 size={16} className="spin" /> : <ImageUp size={16} />}
              上传图片
            </button>
          </div>
          {multimodalProfiles.length === 0 && <p className="emptyHint">要上传图片，请先添加或修改一个“支持图片识别”的模型配置。</p>}
          {diagramImage && (
            <div className="diagramPreview">
              <img src={diagramImage} alt="题目中的图" />
              {diagramNote && <p>{diagramNote}</p>}
            </div>
          )}
          {problemNeedsImage && (
            <p className="emptyHint">已识别为含题图的题目。答疑模型必须选择“多模态”模型，答疑时会发送你上传的原图。</p>
          )}
          <label>
            你已经想到哪一步
            <textarea
              value={initialThought}
              onChange={(event) => setInitialThought(event.target.value)}
              placeholder="例：我知道要看平方项，但不知道为什么最大值是 5。"
            />
          </label>
          <button
            className="primaryButton startButton"
            type="button"
            onClick={handleStart}
            disabled={
              startBusy ||
              streamBusy ||
              Boolean(activeCard) ||
              !problemText.trim() ||
              !selectedProfileId ||
              (problemNeedsImage && (!selectedProfile?.is_multimodal || !originalProblemImage))
            }
          >
            {startBusy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            {sessionId ? "重新开始答疑" : "开始答疑"}
          </button>
          {profiles.length === 0 && (
            <p className="emptyHint">还没有可用模型。先添加一个 OpenAI-compatible 模型配置。</p>
          )}
        </aside>

        <section className="chatPanel">
          <div className="chatHeader">
            <div>
              <h2>答疑过程</h2>
              <p>{selectedProfile ? `当前模型：${selectedProfile.display_name}` : "尚未选择模型"}</p>
            </div>
            {streamBusy && <span className="thinkingBadge">AI 正在回复</span>}
          </div>
          <div className="messages">
            {messages.length === 0 && (
              <div className="welcome">
                <Settings2 size={24} />
                <p>先选择模型并粘贴题目。AI 会先诊断你的思路，再在需要时弹出小检查点。</p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <div className="messageContent"><MathText text={message.text} /></div>
                {message.role === "assistant" && message.action && (
                  <div className="messageActionTag" title={`教学 action：${message.action}`}>
                    {teachingActionLabel(message.action)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="composer">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSend();
              }}
              disabled={!sessionId || streamBusy || Boolean(checkpoint) || Boolean(activeCard)}
              placeholder={sessionId ? "把你的下一步想法发给 AI" : "开始答疑后可以继续回复"}
            />
            <button className="iconButton sendButton" type="button" onClick={handleSend} disabled={!sessionId || streamBusy || Boolean(checkpoint) || Boolean(activeCard) || !input.trim()}>
              <Send size={18} />
            </button>
          </div>
          {error && <div className="errorBox">{error}</div>}
        </section>

        <aside className="debugPanel">
          <div className="panelHeader">
            <h2>学习卡片</h2>
            <span>{cards.length} 张已归档</span>
          </div>
          <div className="cardFilters" aria-label="筛选学习卡片">
            <button type="button" className={cardFilter === "all" ? "active" : ""} onClick={() => setCardFilter("all")}>全部</button>
            <button type="button" className={cardFilter === "knowledge_card" ? "active" : ""} onClick={() => setCardFilter("knowledge_card")}>知识</button>
            <button type="button" className={cardFilter === "problem_card" ? "active" : ""} onClick={() => setCardFilter("problem_card")}>题目</button>
          </div>
          <div className="cardLibraryActions">
            <button
              className="secondaryButton exportCardsButton"
              type="button"
              onClick={() => setKnowledgeExportOpen(true)}
              disabled={knowledgeCards.length === 0}
            >
              <FileDown size={15} />
              导出知识卡片
            </button>
            <button
              className="dangerButton clearLibraryButton"
              type="button"
              onClick={handleDeleteAllCards}
              disabled={deleteAllCardsBusy || Boolean(cardBusyId) || streamBusy || cards.length === 0}
            >
              {deleteAllCardsBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
              清空全部卡片
            </button>
          </div>
          {filteredCards.length === 0 ? (
            <p className="cardLibraryEmpty">全局卡片库在当前筛选下还没有卡片。</p>
          ) : (
            <div className="cardLibraryList" aria-label="已归档学习卡片">
              {filteredCards.map((card) => (
                <div
                  key={card.id}
                  className="cardLibraryItem"
                  role="button"
                  tabIndex={0}
                  onDoubleClick={() => setViewingCard(card)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setViewingCard(card);
                  }}
                  title="双击查看卡片"
                >
                  <div className={`cardLibraryIcon ${card.card_type === "knowledge_card" ? "knowledge" : "problem"}`}>
                    {card.card_type === "knowledge_card" ? <BookOpen size={17} /> : <ClipboardCheck size={17} />}
                  </div>
                  <div className="cardLibraryText">
                    <strong><MathText text={card.content.title} /></strong>
                    <span>{card.card_type === "knowledge_card" ? "知识卡片" : "题目卡片"}</span>
                    <time>{new Date(card.saved_at ?? card.created_at).toLocaleString("zh-CN")}</time>
                  </div>
                  <button
                    className="cardLibraryDelete"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteCard(card);
                    }}
                    disabled={Boolean(cardBusyId)}
                    aria-label={`删除卡片：${card.content.title}`}
                    title="删除卡片"
                  >
                    {cardBusyId === card.id ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="cardLibraryHint">双击卡片查看完整内容。</p>
        </aside>
      </section>

      <ModelConfigDialog
        open={dialogOpen}
        profile={editingProfile}
        onClose={() => setDialogOpen(false)}
        onSaved={(profileId) => refreshProfiles(profileId)}
      />
      {historyOpen && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="恢复历史会话">
          <section className="historyDialog">
            <div className="dialogHeader">
              <div>
                <h2>从 SQLite 恢复会话</h2>
                <p>恢复会复制为新会话，原历史不会被修改。</p>
              </div>
              <button className="iconButton" type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭">
                <X size={17} />
              </button>
            </div>
            {historyBusy && historyItems.length === 0 ? (
              <div className="historyLoading"><Loader2 size={18} className="spin" /> 正在读取 SQLite…</div>
            ) : historyItems.length === 0 ? (
              <p className="emptyHint">SQLite 中还没有可恢复的会话。</p>
            ) : (
              <div className="historyList">
                {historyItems.map((item) => (
                  <div className="historyItemRow" key={item.session_id}>
                    <button
                      type="button"
                      className={`historyItem ${selectedHistoryId === item.session_id ? "active" : ""}`}
                      onClick={() => setSelectedHistoryId(item.session_id)}
                      disabled={Boolean(deleteSessionBusyId)}
                    >
                      <strong>{item.title || "未命名题目"}</strong>
                      <span>{item.model_display_name} · {item.grade_band === "junior" ? "初中" : "高中"}</span>
                      {item.restored_from && <span>恢复分支 · 来源 {item.restored_from}</span>}
                      <span>{item.message_count} 条消息 · {item.checkpoint_count} 个检查点 · {item.state_hint}</span>
                      <time>{new Date(item.updated_at).toLocaleString("zh-CN")}</time>
                    </button>
                    <button
                      className="historyDeleteButton"
                      type="button"
                      onClick={() => handleDeleteSession(item)}
                      disabled={Boolean(deleteSessionBusyId)}
                      title={`删除会话：${item.title || "未命名题目"}`}
                      aria-label={`删除会话：${item.title || "未命名题目"}`}
                    >
                      {deleteSessionBusyId === item.session_id ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="dialogActions">
              <button
                className="dangerButton"
                type="button"
                onClick={handleDeleteAllSessions}
                disabled={historyBusy || deleteAllSessionsBusy || Boolean(deleteSessionBusyId) || historyItems.length === 0}
              >
                {deleteAllSessionsBusy ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                清空全部会话
              </button>
              <button className="secondaryButton" type="button" onClick={() => setHistoryOpen(false)}>取消</button>
              <button className="primaryButton" type="button" onClick={handleRestoreSession} disabled={!selectedHistoryId || historyBusy || deleteAllSessionsBusy || Boolean(deleteSessionBusyId)}>
                {historyBusy ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                恢复为新会话
              </button>
            </div>
          </section>
        </div>
      )}
      <CheckpointModal checkpoint={checkpoint} onChoose={handleCheckpoint} />
      <StudyCardModal
        card={activeCard ?? viewingCard}
        onClose={activeCard ? handleActiveCardClose : () => setViewingCard(null)}
        busy={Boolean(activeCard && (cardBusyId === activeCard.id || streamBusy))}
      />
      <KnowledgeCardExportDialog
        cards={cards}
        open={knowledgeExportOpen}
        onClose={() => setKnowledgeExportOpen(false)}
        onExport={handleKnowledgeCardExport}
      />
    </main>
    {knowledgeCardPrintJob && (
      <KnowledgeCardPrintView cards={knowledgeCardPrintJob.cards} layout={knowledgeCardPrintJob.layout} />
    )}
    </>
  );
}
