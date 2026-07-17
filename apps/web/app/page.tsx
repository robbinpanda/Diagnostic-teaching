"use client";

import {
  ArrowUp,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ImageUp,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckpointModal } from "../components/CheckpointModal";
import { MathText } from "../components/MathText";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
import { StudyCardModal } from "../components/StudyCardModal";
import {
  analyzeProblemImage,
  answerCheckpoint,
  Checkpoint,
  deleteAllCards,
  deleteAllSessions,
  deleteCard,
  deleteModelProfile,
  deleteSession,
  fetchCards,
  fetchProfiles,
  fetchSession,
  fetchSessionHistory,
  intakeSession,
  modelProfileLabel,
  ModelProfile,
  saveCard,
  SessionHistoryItem,
  SessionIntakeResult,
  streamChat,
  StudyCard
} from "../lib/api";

type ChatMessage = {
  id: string;
  role: "student" | "assistant" | "system";
  text: string;
  action?: string;
  imageUrl?: string | null;
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
  return ACTION_LABELS[action] ?? action;
}

function initialContextMessage(problem: string, thought: string) {
  return `题目\n${problem}\n\n我目前想到\n${thought}`;
}

export default function Home() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [gradeBand, setGradeBand] = useState<"junior" | "senior">("junior");
  const [problemText, setProblemText] = useState("");
  const [initialThought, setInitialThought] = useState("");
  const [originalProblemImage, setOriginalProblemImage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [checkpointStartedAt, setCheckpointStartedAt] = useState<number | null>(null);
  const [activeCard, setActiveCard] = useState<StudyCard | null>(null);
  const [viewingCard, setViewingCard] = useState<StudyCard | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [cardFilter, setCardFilter] = useState<"all" | "knowledge_card" | "problem_card">("all");
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [openSessionBusyId, setOpenSessionBusyId] = useState("");
  const [deleteSessionBusyId, setDeleteSessionBusyId] = useState("");
  const [deleteAllSessionsBusy, setDeleteAllSessionsBusy] = useState(false);
  const [deleteAllCardsBusy, setDeleteAllCardsBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [cardBusyId, setCardBusyId] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

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
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: streamBusy ? "auto" : "smooth" });
  }, [messages, streamBusy]);

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
      setError(nextError instanceof Error ? nextError.message : "模型列表加载失败");
    }
  }

  async function refreshCards() {
    try {
      setCards(await fetchCards());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "学习卡片加载失败");
    }
  }

  async function refreshHistory() {
    setHistoryBusy(true);
    try {
      setHistoryItems(await fetchSessionHistory());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "历史会话加载失败");
    } finally {
      setHistoryBusy(false);
    }
  }

  function appendMessage(
    role: ChatMessage["role"],
    text: string,
    action?: string,
    imageUrl?: string | null
  ) {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role, text, action, imageUrl }
    ]);
  }

  function clearCurrentSessionState() {
    setSessionId("");
    setProblemText("");
    setInitialThought("");
    setOriginalProblemImage(null);
    setMessages([]);
    setInput("");
    setCheckpoint(null);
    setCheckpointStartedAt(null);
    setActiveCard(null);
    setViewingCard(null);
    setError("");
  }

  async function handleOpenSession(nextSessionId: string) {
    if (nextSessionId === sessionId || streamBusy || startBusy || activeCard) return;
    setOpenSessionBusyId(nextSessionId);
    setError("");
    try {
      const opened = await fetchSession(nextSessionId);
      setSessionId(opened.session_id);
      setSelectedProfileId(opened.model_profile_id);
      setGradeBand(opened.grade_band);
      setProblemText(opened.problem_text);
      setInitialThought(opened.student_initial_thought);
      setOriginalProblemImage(opened.problem_image_data_url ?? null);
      setMessages([
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
      ]);
      setCheckpoint(opened.pending_checkpoint ?? null);
      setCheckpointStartedAt(opened.pending_checkpoint ? Date.now() : null);
      setActiveCard(opened.pending_card ?? null);
      setViewingCard(null);
      setLeftOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "打开会话失败");
    } finally {
      setOpenSessionBusyId("");
    }
  }

  async function handleDeleteSession(item: SessionHistoryItem) {
    if (!window.confirm(`删除会话“${item.title || "未命名题目"}”？已归档卡片会保留。`)) return;
    setDeleteSessionBusyId(item.session_id);
    setError("");
    try {
      await deleteSession(item.session_id);
      setHistoryItems((current) => current.filter((candidate) => candidate.session_id !== item.session_id));
      if (sessionId === item.session_id) clearCurrentSessionState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除会话失败");
    } finally {
      setDeleteSessionBusyId("");
    }
  }

  async function handleDeleteAllSessions() {
    if (!window.confirm("清空全部会话？会话、消息、检查点和诊断日志会永久删除，已归档卡片会保留。")) return;
    setDeleteAllSessionsBusy(true);
    setError("");
    try {
      await deleteAllSessions();
      setHistoryItems([]);
      clearCurrentSessionState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "清空全部会话失败");
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

  async function runStream(nextSessionId: string, message?: string) {
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
      setMessages((current) => {
        const exists = current.some((item) => item.id === id);
        if (!exists) return [...current, { id, role: "assistant", text: nextText }];
        return current.map((item) => (item.id === id ? { ...item, text: nextText } : item));
      });
    }

    function appendAssistantDelta(text: string) {
      if (!text) return;
      if (retryingAssistant) {
        retryText += text;
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
          const data = event.data as { action?: string; message?: string };
          reconcileAssistantMessage(data.message);
          if (assistantId && data.action) {
            const id = assistantId;
            setMessages((current) => current.map((item) => (
              item.id === id ? { ...item, action: data.action } : item
            )));
          }
        }
        if (event.event === "message_delta") appendAssistantDelta((event.data as { text: string }).text);
        if (event.event === "message_reset") resetAssistantMessage();
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
        appendMessage("system", "这一轮模型没有返回可见内容，请再说一句你的当前想法。");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "答疑请求失败");
    } finally {
      setStreamBusy(false);
      void refreshHistory();
    }
  }

  async function applyIntakeResult(result: SessionIntakeResult) {
    setProblemText(result.problem_text);
    setInitialThought(result.student_initial_thought);
    appendMessage("assistant", result.assistant_message);
    if (result.status === "ready" && result.session_id) {
      setSessionId(result.session_id);
      setCheckpoint(null);
      setCheckpointStartedAt(null);
      setActiveCard(null);
      await refreshHistory();
      await runStream(result.session_id);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || startBusy || streamBusy) return;
    if (!selectedProfileId) {
      setError("请先在输入框下方选择一个模型；如果还没有模型，请打开设置添加。");
      return;
    }
    if (originalProblemImage && !selectedProfile?.is_multimodal) {
      setError("这道题带有原图，请选择支持图片识别的多模态模型。");
      return;
    }
    setInput("");
    appendMessage("student", text, sessionId ? "STUDENT_RESPONSE" : undefined);
    if (sessionId) {
      await runStream(sessionId, text);
      return;
    }

    setStartBusy(true);
    setError("");
    try {
      const result = await intakeSession({
        grade_band: gradeBand,
        subject: "math",
        model_profile_id: selectedProfileId,
        message: text,
        problem_text: problemText,
        student_initial_thought: initialThought,
        problem_image_data_url: originalProblemImage
      });
      await applyIntakeResult(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "创建答疑会话失败");
    } finally {
      setStartBusy(false);
    }
  }

  async function handleImageFile(file?: File) {
    if (!file || sessionId) return;
    const visionProfile = selectedProfile?.is_multimodal ? selectedProfile : multimodalProfiles[0];
    if (!visionProfile) {
      setError("上传图片需要多模态模型，请先在模型设置中添加并标记“支持图片识别”。");
      return;
    }
    setSelectedProfileId(visionProfile.id);
    setImageBusy(true);
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setOriginalProblemImage(dataUrl);
      appendMessage("student", "上传了一张题目图片", undefined, dataUrl);
      const analyzed = await analyzeProblemImage({
        model_profile_id: visionProfile.id,
        image_base64: dataUrl,
        content_type: file.type || "image/png",
        filename: file.name
      });
      const result = await intakeSession({
        grade_band: gradeBand,
        subject: "math",
        model_profile_id: visionProfile.id,
        problem_text: analyzed.problem_text,
        student_initial_thought: analyzed.student_work_summary.trim() || initialThought,
        problem_image_data_url: dataUrl
      });
      await applyIntakeResult(result);
    } catch (nextError) {
      setOriginalProblemImage(null);
      setError(nextError instanceof Error ? nextError.message : "图片识别失败");
    } finally {
      setImageBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleCheckpoint(optionId: string) {
    if (!checkpoint || !sessionId) return;
    const activeCheckpoint = checkpoint;
    const startedAt = checkpointStartedAt;
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    setCheckpoint(null);
    setCheckpointStartedAt(null);
    try {
      const answer = await answerCheckpoint({
        checkpointId: activeCheckpoint.id,
        session_id: sessionId,
        selected_option_id: optionId,
        elapsed_ms: elapsed
      });
      appendMessage("student", answer.student_message, "CHECKPOINT_RESPONSE");
      await runStream(sessionId);
    } catch (nextError) {
      setCheckpoint(activeCheckpoint);
      setCheckpointStartedAt(startedAt);
      setError(nextError instanceof Error ? nextError.message : "提交检查点失败");
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
      if (cardToSave.card_type === "knowledge_card") await runStream(sessionId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存学习卡片失败");
    } finally {
      setCardBusyId("");
    }
  }

  async function handleDeleteCard(card: StudyCard) {
    if (cardBusyId || !window.confirm(`删除卡片“${card.content.title}”？删除后无法恢复。`)) return;
    setCardBusyId(card.id);
    setError("");
    try {
      await deleteCard(card.id);
      setCards((current) => current.filter((item) => item.id !== card.id));
      setViewingCard((current) => current?.id === card.id ? null : current);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除学习卡片失败");
    } finally {
      setCardBusyId("");
    }
  }

  async function handleDeleteAllCards() {
    if (!window.confirm("清空全部学习卡片？会话、消息和日志会保留。")) return;
    setDeleteAllCardsBusy(true);
    setError("");
    try {
      await deleteAllCards();
      setCards([]);
      setActiveCard(null);
      setViewingCard(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "清空学习卡片失败");
    } finally {
      setDeleteAllCardsBusy(false);
    }
  }

  async function handleDeleteProfile() {
    if (!selectedProfile || sessionId) return;
    if (!window.confirm(`删除模型配置“${modelProfileLabel(selectedProfile)}”？`)) return;
    setDeleteBusyId(selectedProfile.id);
    setError("");
    try {
      await deleteModelProfile(selectedProfile.id);
      await refreshProfiles();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除模型配置失败");
    } finally {
      setDeleteBusyId("");
    }
  }

  const composerBlocked = startBusy || streamBusy || imageBusy || Boolean(checkpoint) || Boolean(activeCard);

  return (
    <main className={`appShell ${leftOpen ? "leftOpen" : "leftClosed"} ${rightOpen ? "rightOpen" : "rightClosed"}`}>
      <aside className="sessionSidebar">
        <div className="sidebarBrand">
          <div className="brandGlyph"><Bot size={19} /></div>
          <strong>析题</strong>
          <button className="plainIconButton sidebarCollapse" type="button" onClick={() => setLeftOpen(false)} aria-label="收起会话栏">
            <ChevronLeft size={18} />
          </button>
        </div>

        <button className="newChatButton" type="button" onClick={clearCurrentSessionState} disabled={composerBlocked}>
          <MessageSquarePlus size={18} />
          新建答疑
        </button>

        <div className="sidebarSectionHeader">
          <span>对话</span>
          <button
            className="plainIconButton"
            type="button"
            onClick={handleDeleteAllSessions}
            disabled={deleteAllSessionsBusy || streamBusy || historyItems.length === 0}
            title="清空全部会话"
          >
            {deleteAllSessionsBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
          </button>
        </div>

        <div className="sessionList">
          {historyBusy && historyItems.length === 0 && <div className="sidebarEmpty"><Loader2 size={16} className="spin" /> 正在读取会话</div>}
          {!historyBusy && historyItems.length === 0 && <div className="sidebarEmpty">还没有会话</div>}
          {historyItems.map((item) => (
            <div className={`sessionRow ${sessionId === item.session_id ? "active" : ""}`} key={item.session_id}>
              <button
                className="sessionEntry"
                type="button"
                onClick={() => handleOpenSession(item.session_id)}
                disabled={Boolean(openSessionBusyId) || composerBlocked}
              >
                <strong><MathText text={item.title || "未命名题目"} className="titleMathText" /></strong>
                <span>{item.message_count} 条消息 · {new Date(item.updated_at).toLocaleDateString("zh-CN")}</span>
              </button>
              <button
                className="sessionDeleteButton"
                type="button"
                onClick={() => handleDeleteSession(item)}
                disabled={Boolean(deleteSessionBusyId) || streamBusy}
                aria-label={`删除会话：${item.title}`}
              >
                {deleteSessionBusyId === item.session_id || openSessionBusyId === item.session_id
                  ? <Loader2 size={14} className="spin" />
                  : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>

      </aside>

      <section className="conversationPanel">
        <header className="conversationHeader">
          {!leftOpen && (
            <button className="plainIconButton" type="button" onClick={() => setLeftOpen(true)} aria-label="展开会话栏">
              <ChevronRight size={18} />
            </button>
          )}
          <div className="conversationTitle">
            <strong><MathText text={activeHistory?.title || "新答疑"} className="titleMathText" /></strong>
            <span>{sessionId ? `${gradeBand === "junior" ? "初中" : "高中"}数学 · ${selectedProfile ? modelProfileLabel(selectedProfile) : "原模型不可用"}` : "先发题目，再告诉我你想到哪一步"}</span>
          </div>
          {streamBusy && <span className="thinkingStatus"><Loader2 size={14} className="spin" /> 正在思考</span>}
          <button className="plainIconButton cardPanelToggle" type="button" onClick={() => setRightOpen((value) => !value)} aria-label="切换卡片栏">
            <BookOpen size={18} />
          </button>
        </header>

        <div className="messageViewport">
          <div className="messageColumn">
            {messages.length === 0 && (
              <div className="welcomeState">
                <div className="welcomeGlyph"><Bot size={30} /></div>
                <h1>从你卡住的地方开始</h1>
                <p>在下方一次输入题目和你想到哪一步，也可以先只发题目。信息不完整时，我会继续追问。</p>
                <div className="welcomeExamples">
                  <span>题目：已知……求……</span>
                  <span>我的思路：我做到……但不懂……</span>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <article className={`chatMessage ${message.role}`} key={message.id}>
                <div className="messageAvatar">
                  {message.role === "assistant" ? <Bot size={17} /> : message.role === "student" ? "你" : "·"}
                </div>
                <div className="messageBody">
                  {message.imageUrl && <img className="messageImage" src={message.imageUrl} alt="学生上传的题目" />}
                  <div className="messageText"><MathText text={message.text} /></div>
                  {message.role === "assistant" && message.action && (
                    <span className="actionTag" title={`教学 action：${message.action}`}>{teachingActionLabel(message.action)}</span>
                  )}
                </div>
              </article>
            ))}
            <div ref={messageEndRef} />
          </div>
        </div>

        <div className="composerDock">
          {error && <div className="inlineError"><span>{error}</span><button type="button" onClick={() => setError("")}><X size={15} /></button></div>}
          {!sessionId && originalProblemImage && (
            <div className="attachmentContext">
              <img src={originalProblemImage} alt="已读取的题目图片" />
              <div><strong>题目图片已读取</strong><span>原图会随每轮答疑发送给多模态模型</span></div>
              <button type="button" onClick={() => { setOriginalProblemImage(null); setProblemText(""); }} aria-label="移除图片"><X size={15} /></button>
            </div>
          )}
          <div className="composerCard">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              disabled={composerBlocked}
              placeholder={sessionId ? "继续说说你的想法…" : "输入题目和你想到哪一步，或上传题目图片…"}
              rows={3}
            />
            <div className="composerToolbar">
              <div className="composerActions">
                <input
                  ref={imageInputRef}
                  className="hiddenFileInput"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void handleImageFile(event.target.files?.[0])}
                />
                <button
                  className="toolButton"
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={composerBlocked || Boolean(sessionId)}
                  title="上传题目图片"
                >
                  {imageBusy ? <Loader2 size={17} className="spin" /> : <Paperclip size={17} />}
                </button>
                <select value={gradeBand} onChange={(event) => setGradeBand(event.target.value as typeof gradeBand)} disabled={Boolean(sessionId) || composerBlocked} aria-label="年级">
                  <option value="junior">初中</option>
                  <option value="senior">高中</option>
                </select>
                <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={Boolean(sessionId) || composerBlocked} aria-label="答疑模型">
                  <option value="">选择模型</option>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{modelProfileLabel(profile)}</option>)}
                </select>
                <button
                  className="toolButton"
                  type="button"
                  onClick={() => { setEditingProfile(selectedProfile ?? null); setDialogOpen(true); }}
                  title={selectedProfile ? "修改模型配置" : "添加模型配置"}
                >
                  {selectedProfile ? <Pencil size={16} /> : <Plus size={16} />}
                </button>
                {selectedProfile && !sessionId && (
                  <button className="toolButton danger" type="button" onClick={handleDeleteProfile} disabled={Boolean(deleteBusyId)} title="删除模型配置">
                    {deleteBusyId ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                  </button>
                )}
              </div>
              <button className="sendButton" type="button" onClick={handleSend} disabled={composerBlocked || !input.trim()} aria-label="发送">
                {startBusy || streamBusy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={19} />}
              </button>
            </div>
          </div>
          <p className="composerHint">Enter 发送 · Shift + Enter 换行 · 开始答疑前需同时识别题目与当前思路</p>
        </div>
      </section>

      <aside className="cardSidebar">
        <div className="cardSidebarHeader">
          <div><strong>知识卡片</strong><span>{cards.length} 张已归档</span></div>
          <button className="plainIconButton" type="button" onClick={() => setRightOpen(false)} aria-label="收起卡片栏"><ChevronRight size={18} /></button>
        </div>
        <div className="cardFilters" aria-label="筛选学习卡片">
          <button type="button" className={cardFilter === "all" ? "active" : ""} onClick={() => setCardFilter("all")}>全部</button>
          <button type="button" className={cardFilter === "knowledge_card" ? "active" : ""} onClick={() => setCardFilter("knowledge_card")}>知识</button>
          <button type="button" className={cardFilter === "problem_card" ? "active" : ""} onClick={() => setCardFilter("problem_card")}>题目</button>
        </div>
        <div className="cardList">
          {filteredCards.length === 0 && <div className="cardEmpty"><BookOpen size={21} /><span>还没有卡片</span></div>}
          {filteredCards.map((card) => (
            <div className="cardItem" key={card.id}>
              <button className="cardOpenButton" type="button" onClick={() => setViewingCard(card)}>
                <span className={`cardIcon ${card.card_type === "knowledge_card" ? "knowledge" : "problem"}`}>
                  {card.card_type === "knowledge_card" ? <BookOpen size={16} /> : <ClipboardCheck size={16} />}
                </span>
                <span className="cardText"><strong><MathText text={card.content.title} /></strong><small>{card.card_type === "knowledge_card" ? "知识卡片" : "题目卡片"}</small></span>
              </button>
              <button className="cardDeleteButton" type="button" onClick={() => handleDeleteCard(card)} disabled={Boolean(cardBusyId)} aria-label={`删除卡片：${card.content.title}`}>
                {cardBusyId === card.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
        <button className="clearCardsButton" type="button" onClick={handleDeleteAllCards} disabled={deleteAllCardsBusy || streamBusy || cards.length === 0}>
          {deleteAllCardsBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
          清空卡片
        </button>
      </aside>

      <ModelConfigDialog
        open={dialogOpen}
        profile={editingProfile}
        onClose={() => setDialogOpen(false)}
        onSaved={(profileId) => refreshProfiles(profileId)}
      />
      <CheckpointModal checkpoint={checkpoint} onChoose={handleCheckpoint} />
      <StudyCardModal
        card={activeCard ?? viewingCard}
        onClose={activeCard ? handleActiveCardClose : () => setViewingCard(null)}
        busy={Boolean(activeCard && (cardBusyId === activeCard.id || streamBusy))}
      />
    </main>
  );
}
