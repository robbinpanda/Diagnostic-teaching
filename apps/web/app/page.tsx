"use client";

import { Bot, ImageUp, Loader2, Pencil, Plus, Send, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckpointModal } from "../components/CheckpointModal";
import { MathText } from "../components/MathText";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
import {
  answerCheckpoint,
  analyzeProblemImage,
  createSession,
  deleteModelProfile,
  fetchProfiles,
  ModelProfile,
  Checkpoint,
  streamChat
} from "../lib/api";

type ChatMessage = {
  id: string;
  role: "student" | "assistant" | "system";
  text: string;
};

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
  const [stateHint, setStateHint] = useState("未开始");
  const [action, setAction] = useState("-");
  const [waitForStudent, setWaitForStudent] = useState(false);
  const [breakpointText, setBreakpointText] = useState("-");
  const [startBusy, setStartBusy] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
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

  useEffect(() => {
    refreshProfiles();
  }, []);

  useEffect(() => {
    if (visionProfileId && !multimodalProfiles.some((profile) => profile.id === visionProfileId)) {
      setVisionProfileId("");
    }
  }, [multimodalProfiles, visionProfileId]);

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

  function appendMessage(role: ChatMessage["role"], text: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text }]);
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
    message?: string,
    checkpointAnswer?: { checkpoint_id: string; selected_option_id: string; is_correct: boolean; event: string }
  ) {
    setStreamBusy(true);
    setError("");
    let assistantId = "";
    let assistantText = "";
    let receivedVisibleText = false;
    let receivedCheckpoint = false;
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
      setAssistantMessage(assistantText + text);
    }

    function reconcileAssistantMessage(finalText?: string) {
      if (!finalText?.trim()) return;
      if (!assistantText || finalText.startsWith(assistantText) || finalText.length >= assistantText.length) {
        setAssistantMessage(finalText);
      }
    }

    try {
      await streamChat({ session_id: nextSessionId, message, checkpoint_answer: checkpointAnswer }, (event) => {
        if (event.event === "decision") {
          const data = event.data as { state_hint?: string; action?: string; wait_for_student?: boolean; message?: string; breakpoint?: string };
          setStateHint(data.state_hint ?? "-");
          setAction(data.action ?? "-");
          setWaitForStudent(Boolean(data.wait_for_student));
          setBreakpointText(data.breakpoint ?? "-");
          reconcileAssistantMessage(data.message);
        }
        if (event.event === "message_delta") {
          const text = (event.data as { text: string }).text;
          appendAssistantDelta(text);
        }
        if (event.event === "checkpoint_ready") {
          receivedCheckpoint = true;
          setCheckpoint(event.data as Checkpoint);
          setCheckpointStartedAt(Date.now());
        }
        if (event.event === "error") {
          receivedError = true;
          setError((event.data as { message: string }).message);
        }
        if (event.event === "message_done") {
          assistantId = "";
          assistantText = "";
        }
      });
      if (!receivedVisibleText && !receivedCheckpoint && !receivedError) {
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
      setStateHint(session.state_hint);
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
    appendMessage("student", text);
    await runStream(sessionId, text);
  }

  async function handleCheckpoint(optionId: string) {
    if (!checkpoint || !sessionId) return;
    const elapsed = checkpointStartedAt ? Date.now() - checkpointStartedAt : 0;
    const selected = [...checkpoint.options, checkpoint.unknown_option].find((option) => option.id === optionId);
    const optionLabel = selected ? `${selected.id} ${selected.text}` : optionId;
    // 这一句会作为学生最新发言进入 AI 上下文，避免"答完检查点没反应"
    const aiFacing = `我在检查点「${checkpoint.question}」选了：${optionLabel}`;
    setCheckpoint(null);
    setCheckpointStartedAt(null);
    appendMessage("student", aiFacing);
    try {
      const answer = await answerCheckpoint({
        checkpointId: checkpoint.id,
        session_id: sessionId,
        selected_option_id: optionId,
        elapsed_ms: elapsed
      });
      await runStream(sessionId, aiFacing, {
        checkpoint_id: checkpoint.id,
        selected_option_id: optionId,
        is_correct: answer.is_correct,
        event: answer.event
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "提交检查点失败");
    }
  }

  return (
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
                <MathText text={message.text} />
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
              disabled={!sessionId || streamBusy || Boolean(checkpoint)}
              placeholder={sessionId ? "把你的下一步想法发给 AI" : "开始答疑后可以继续回复"}
            />
            <button className="iconButton sendButton" type="button" onClick={handleSend} disabled={!sessionId || streamBusy || !input.trim()}>
              <Send size={18} />
            </button>
          </div>
          {error && <div className="errorBox">{error}</div>}
        </section>

        <aside className="debugPanel">
          <div className="panelHeader">
            <h2>调试面板</h2>
            <span>内部测试</span>
          </div>
          <dl>
            <dt>Session</dt>
            <dd>{sessionId || "-"}</dd>
            <dt>State Hint</dt>
            <dd>{stateHint}</dd>
            <dt>Action</dt>
            <dd>{action}</dd>
            <dt>Wait</dt>
            <dd>{waitForStudent ? "yes" : "no"}</dd>
            <dt>Breakpoint</dt>
            <dd>{breakpointText}</dd>
            <dt>Model</dt>
            <dd>{selectedProfile?.model ?? "-"}</dd>
          </dl>
        </aside>
      </section>

      <ModelConfigDialog
        open={dialogOpen}
        profile={editingProfile}
        onClose={() => setDialogOpen(false)}
        onSaved={(profileId) => refreshProfiles(profileId)}
      />
      <CheckpointModal checkpoint={checkpoint} onChoose={handleCheckpoint} />
    </main>
  );
}
