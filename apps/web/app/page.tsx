"use client";

import { Bot, Loader2, Plus, Send, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CheckpointModal } from "../components/CheckpointModal";
import { ModelConfigDialog } from "../components/ModelConfigDialog";
import {
  answerCheckpoint,
  createSession,
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
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [checkpointStartedAt, setCheckpointStartedAt] = useState<number | null>(null);
  const [phase, setPhase] = useState("未开始");
  const [action, setAction] = useState("-");
  const [breakpointText, setBreakpointText] = useState("-");
  const [startBusy, setStartBusy] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  useEffect(() => {
    refreshProfiles();
  }, []);

  async function refreshProfiles(selectId?: string) {
    try {
      const nextProfiles = await fetchProfiles();
      setProfiles(nextProfiles);
      if (selectId) {
        setSelectedProfileId(selectId);
      } else if (!selectedProfileId && nextProfiles.length === 1) {
        setSelectedProfileId(nextProfiles[0].id);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "模型列表加载失败");
    }
  }

  function appendMessage(role: ChatMessage["role"], text: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text }]);
  }

  async function runStream(nextSessionId: string, message?: string) {
    setStreamBusy(true);
    setError("");
    let assistantId = "";
    let receivedVisibleText = false;
    let receivedCheckpoint = false;
    let receivedError = false;
    try {
      await streamChat({ session_id: nextSessionId, message }, (event) => {
        if (event.event === "decision") {
          const data = event.data as { phase?: string; action?: string; breakpoint?: string };
          setPhase(data.phase ?? "-");
          setAction(data.action ?? "-");
          setBreakpointText(data.breakpoint ?? "-");
        }
        if (event.event === "message_delta") {
          const text = (event.data as { text: string }).text;
          if (text.trim()) receivedVisibleText = true;
          setMessages((current) => {
            if (!assistantId) {
              assistantId = crypto.randomUUID();
              return [...current, { id: assistantId, role: "assistant", text }];
            }
            return current.map((item) => (item.id === assistantId ? { ...item, text: item.text + text } : item));
          });
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
    setStartBusy(true);
    setError("");
    setMessages([]);
    try {
      const session = await createSession({
        grade_band: gradeBand,
        subject: "math",
        model_profile_id: selectedProfileId,
        problem_text: problemText,
        student_initial_thought: initialThought
      });
      setSessionId(session.session_id);
      setPhase(session.phase);
      appendMessage("system", `已创建答疑会话，使用模型：${selectedProfile?.display_name ?? selectedProfileId}`);
      setStartBusy(false);
      await runStream(session.session_id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建会话失败");
    } finally {
      setStartBusy(false);
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
    setCheckpoint(null);
    appendMessage("student", `检查点选择：${selected?.text ?? optionId}`);
    try {
      await answerCheckpoint({
        checkpointId: checkpoint.id,
        session_id: sessionId,
        selected_option_id: optionId,
        elapsed_ms: elapsed
      });
      await runStream(sessionId);
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
          <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={startBusy || streamBusy}>
            <option value="">选择本次模型</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.display_name} · {profile.model}
              </option>
            ))}
          </select>
          <button className="secondaryButton" type="button" onClick={() => setDialogOpen(true)}>
            <Plus size={16} />
            添加模型配置
          </button>
        </div>
      </section>

      <section className="workspace">
        <aside className="inputPanel">
          <div className="panelHeader">
            <h2>题目</h2>
            <span>文本输入</span>
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
              placeholder="粘贴一道初中或高中数学题。现在先不支持图片。"
            />
          </label>
          <label>
            你已经想到哪一步
            <textarea
              value={initialThought}
              onChange={(event) => setInitialThought(event.target.value)}
              placeholder="例：我知道要看平方项，但不知道为什么最大值是 5。"
            />
          </label>
          <button className="primaryButton startButton" type="button" onClick={handleStart} disabled={startBusy || streamBusy || !problemText.trim() || !selectedProfileId}>
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
                {message.text}
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
            <dt>Phase</dt>
            <dd>{phase}</dd>
            <dt>Action</dt>
            <dd>{action}</dd>
            <dt>Breakpoint</dt>
            <dd>{breakpointText}</dd>
            <dt>Model</dt>
            <dd>{selectedProfile?.model ?? "-"}</dd>
          </dl>
        </aside>
      </section>

      <ModelConfigDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(profileId) => refreshProfiles(profileId)}
      />
      <CheckpointModal checkpoint={checkpoint} onChoose={handleCheckpoint} />
    </main>
  );
}
