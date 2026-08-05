"use client";

import {
  BookOpen,
  ChevronLeft,
  Clock3,
  Loader2,
  MessageSquarePlus,
  NotebookTabs,
  Search,
  Trash2
} from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionHistoryItem } from "../../lib/api";
import { MathText } from "../MathText";

export type WorkspaceNavigation = "start" | "history" | "knowledge" | "mistakes";

type Props = {
  historyItems: SessionHistoryItem[];
  activeSessionId: string;
  historyBusy: boolean;
  openSessionBusyId: string;
  deleteSessionBusyId: string;
  deleteAllSessionsBusy: boolean;
  runningSessionIds: string[];
  activeNavigation?: WorkspaceNavigation;
  onCollapse: () => void;
  onNewChat: () => void;
  onNavigate?: (navigation: WorkspaceNavigation) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (item: SessionHistoryItem) => void;
  onDeleteAllSessions: () => void;
};

export function SessionSidebar({
  historyItems,
  activeSessionId,
  historyBusy,
  openSessionBusyId,
  deleteSessionBusyId,
  deleteAllSessionsBusy,
  runningSessionIds,
  activeNavigation = "start",
  onCollapse,
  onNewChat,
  onNavigate,
  onOpenSession,
  onDeleteSession,
  onDeleteAllSessions
}: Props) {
  const runningSessions = new Set(runningSessionIds);
  const [historyQuery, setHistoryQuery] = useState("");
  const normalizedQuery = historyQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredHistoryItems = useMemo(
    () => normalizedQuery
      ? historyItems.filter((item) => (item.title || "未命名题目").toLocaleLowerCase("zh-CN").includes(normalizedQuery))
      : historyItems,
    [historyItems, normalizedQuery]
  );

  function navigate(navigation: WorkspaceNavigation) {
    onNavigate?.(navigation);
    if (navigation === "start") onNewChat();
  }

  return (
    <aside className="sessionSidebar">
      <div className="sidebarLead">
        <span>学习空间</span>
        <button className="plainIconButton sidebarCollapse" type="button" onClick={onCollapse} aria-label="收起导航栏" title="收起导航栏">
          <ChevronLeft size={18} />
        </button>
      </div>

      <nav className="primaryNavigation" aria-label="主要导航">
        <button className={activeNavigation === "start" ? "active" : ""} type="button" onClick={() => navigate("start")} title="开始答疑">
          <MessageSquarePlus size={20} />
          <span className="sidebarNavLabel">开始答疑</span>
        </button>
        <button className={activeNavigation === "history" ? "active" : ""} type="button" onClick={() => navigate("history")} title="历史搜题">
          <Clock3 size={20} />
          <span className="sidebarNavLabel">历史搜题</span>
        </button>
        <button className={activeNavigation === "knowledge" ? "active" : ""} type="button" onClick={() => navigate("knowledge")} title="知识库">
          <BookOpen size={20} />
          <span className="sidebarNavLabel">知识库</span>
        </button>
        <button className={activeNavigation === "mistakes" ? "active" : ""} type="button" onClick={() => navigate("mistakes")} title="错题库">
          <NotebookTabs size={20} />
          <span className="sidebarNavLabel">错题库</span>
        </button>
      </nav>

      <div className="historySection">
        <div className="sidebarSectionHeader">
          <span>最近答疑</span>
          <button
            className="plainIconButton"
            type="button"
            onClick={onDeleteAllSessions}
            disabled={deleteAllSessionsBusy || runningSessions.size > 0 || historyItems.length === 0}
            title="清空全部会话"
            aria-label="清空全部会话"
          >
            {deleteAllSessionsBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
          </button>
        </div>
        <label className="historySearch">
          <Search size={15} />
          <span className="srOnly">搜索历史答疑</span>
          <input
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            placeholder="搜索历史答疑"
          />
        </label>
      </div>

      <div className="sessionList">
        {historyBusy && historyItems.length === 0 && <div className="sidebarEmpty"><Loader2 size={16} className="spin" /> 正在读取会话</div>}
        {!historyBusy && historyItems.length === 0 && <div className="sidebarEmpty">还没有答疑记录</div>}
        {!historyBusy && historyItems.length > 0 && filteredHistoryItems.length === 0 && <div className="sidebarEmpty">没有匹配的答疑</div>}
        {filteredHistoryItems.map((item) => {
          const isRunning = runningSessions.has(item.session_id);
          return (
          <div className={`sessionRow ${activeSessionId === item.session_id ? "active" : ""}`} key={item.session_id}>
            <button
              className="sessionEntry"
              type="button"
              onClick={() => onOpenSession(item.session_id)}
              disabled={openSessionBusyId === item.session_id}
            >
              <strong><MathText text={item.title || "未命名题目"} className="titleMathText" /></strong>
              <span>
                {isRunning && <><Loader2 size={11} className="spin" /> 正在思考 · </>}
                {item.message_count} 条消息 · {new Date(item.updated_at).toLocaleDateString("zh-CN")}
              </span>
            </button>
            <button
              className="sessionDeleteButton"
              type="button"
              onClick={() => onDeleteSession(item)}
              disabled={Boolean(deleteSessionBusyId) || isRunning}
              aria-label={`删除会话：${item.title}`}
            >
              {deleteSessionBusyId === item.session_id || openSessionBusyId === item.session_id
                ? <Loader2 size={14} className="spin" />
                : <Trash2 size={14} />}
            </button>
          </div>
          );
        })}
      </div>

      <div className="sidebarFooterNote">
        <span className="statusDot" />
        <span>本地安全存储</span>
      </div>
    </aside>
  );
}
