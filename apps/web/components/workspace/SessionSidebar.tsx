"use client";

import { Bot, ChevronLeft, Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import type { SessionHistoryItem } from "../../lib/api";
import { MathText } from "../MathText";

type Props = {
  historyItems: SessionHistoryItem[];
  activeSessionId: string;
  historyBusy: boolean;
  openSessionBusyId: string;
  deleteSessionBusyId: string;
  deleteAllSessionsBusy: boolean;
  sessionNavigationBusy: boolean;
  streamBusy: boolean;
  onCollapse: () => void;
  onNewChat: () => void;
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
  sessionNavigationBusy,
  streamBusy,
  onCollapse,
  onNewChat,
  onOpenSession,
  onDeleteSession,
  onDeleteAllSessions
}: Props) {
  return (
    <aside className="sessionSidebar">
      <div className="sidebarBrand">
        <div className="brandGlyph"><Bot size={19} /></div>
        <strong>析题</strong>
        <button className="plainIconButton sidebarCollapse" type="button" onClick={onCollapse} aria-label="收起会话栏">
          <ChevronLeft size={18} />
        </button>
      </div>

      <button className="newChatButton" type="button" onClick={onNewChat} disabled={sessionNavigationBusy}>
        <MessageSquarePlus size={18} />
        新建答疑
      </button>

      <div className="sidebarSectionHeader">
        <span>对话</span>
        <button
          className="plainIconButton"
          type="button"
          onClick={onDeleteAllSessions}
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
          <div className={`sessionRow ${activeSessionId === item.session_id ? "active" : ""}`} key={item.session_id}>
            <button
              className="sessionEntry"
              type="button"
              onClick={() => onOpenSession(item.session_id)}
              disabled={Boolean(openSessionBusyId) || sessionNavigationBusy}
            >
              <strong><MathText text={item.title || "未命名题目"} className="titleMathText" /></strong>
              <span>{item.message_count} 条消息 · {new Date(item.updated_at).toLocaleDateString("zh-CN")}</span>
            </button>
            <button
              className="sessionDeleteButton"
              type="button"
              onClick={() => onDeleteSession(item)}
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
  );
}
