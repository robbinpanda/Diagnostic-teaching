"use client";

import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Files,
  Loader2,
  MessageSquarePlus,
  NotebookTabs,
  Search,
  Trash2
} from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionHistoryItem } from "../../lib/api";
import { MathText } from "../MathText";

export type WorkspaceContentNavigation =
  | "start"
  | "history"
  | "knowledge"
  | "mistake_collection"
  | "mistake_sets";
export type WorkspaceNavigation = WorkspaceContentNavigation;

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

type PaperGroup = {
  id: string;
  name: string;
  items: SessionHistoryItem[];
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
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
  const [expandedPaperIds, setExpandedPaperIds] = useState<Set<string>>(new Set());
  const normalizedQuery = historyQuery.trim().toLocaleLowerCase("zh-CN");

  const paperGroups = useMemo(() => {
    const groups = new Map<string, PaperGroup>();
    for (const item of historyItems) {
      const id = item.paper_id || "unclassified";
      const name = item.paper_name || "未分类题目";
      const matches = !normalizedQuery
        || name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
        || (item.title || "未命名题目").toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      if (!matches) continue;
      const group = groups.get(id) || { id, name, items: [] };
      group.items.push(item);
      groups.set(id, group);
    }
    return [...groups.values()];
  }, [historyItems, normalizedQuery]);

  function navigate(navigation: WorkspaceNavigation) {
    onNavigate?.(navigation);
    if (navigation === "start") onNewChat();
  }

  function togglePaper(paperId: string) {
    setExpandedPaperIds((current) => {
      const next = new Set(current);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
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
        <button className={`primaryNavButton ${activeNavigation === "start" ? "active" : ""}`} type="button" onClick={() => navigate("start")} aria-current={activeNavigation === "start" ? "page" : undefined} title="开始答疑">
          <MessageSquarePlus size={20} />
          <span className="sidebarNavLabel">开始答疑</span>
        </button>
        <div className={`historyNavigationGroup ${historyExpanded ? "expanded" : ""}`}>
          <div className={`historyNavigationRow ${activeNavigation === "history" ? "active" : ""}`}>
            <div className="primaryNavButton historyNavigationMain" aria-label="历史搜题导航">
              <Clock3 size={20} />
              <span className="sidebarNavLabel">历史搜题</span>
            </div>
            <button
              className="historyTreeToggle"
              type="button"
              onClick={() => setHistoryExpanded((value) => !value)}
              aria-expanded={historyExpanded}
              aria-label={historyExpanded ? "收起历史搜题" : "展开历史搜题"}
              title={historyExpanded ? "收起历史搜题" : "展开历史搜题"}
            >
              {historyExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            </button>
          </div>

          {historyExpanded ? (
            <section className="historyTree" aria-label="按试卷分组的历史题目">
          <div className="historySection">
            <label className="historySearch">
              <Search size={15} />
              <span className="srOnly">搜索历史答疑</span>
              <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索试卷或题目" />
            </label>
          </div>

          <div className="paperTreeScroll">
            {historyBusy && historyItems.length === 0 ? <div className="sidebarEmpty"><Loader2 size={16} className="spin" /> 正在读取题目</div> : null}
            {!historyBusy && historyItems.length === 0 ? <div className="sidebarEmpty">还没有答疑记录</div> : null}
            {!historyBusy && historyItems.length > 0 && paperGroups.length === 0 ? <div className="sidebarEmpty">没有匹配的试卷或题目</div> : null}
            {paperGroups.map((group) => {
              const open = Boolean(normalizedQuery)
                || expandedPaperIds.has(group.id)
                || group.items.some((item) => item.session_id === activeSessionId);
              return (
                <div className="paperGroup" key={group.id}>
                  <button className="paperGroupButton" type="button" onClick={() => togglePaper(group.id)} aria-expanded={open}>
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <span>{group.name}</span>
                    <small>{group.items.length}</small>
                  </button>
                  {open ? (
                    <div className="paperQuestionList">
                      {group.items.map((item) => {
                        const isRunning = runningSessions.has(item.session_id);
                        const fullTitle = item.title || "未命名题目";
                        return (
                          <div className={`sessionRow ${activeSessionId === item.session_id ? "active" : ""}`} key={item.session_id}>
                            <button className="sessionEntry" type="button" onClick={() => onOpenSession(item.session_id)} disabled={openSessionBusyId === item.session_id} title={fullTitle}>
                              {isRunning ? <Loader2 size={12} className="spin sessionRunningIcon" aria-label="正在思考" /> : null}
                              <strong><MathText text={fullTitle} className="titleMathText" /></strong>
                            </button>
                            <button className="sessionDeleteButton" type="button" onClick={() => onDeleteSession(item)} disabled={Boolean(deleteSessionBusyId) || Boolean(openSessionBusyId) || isRunning || activeSessionId === item.session_id} aria-label={`删除会话：${item.title}`}>
                              {deleteSessionBusyId === item.session_id || openSessionBusyId === item.session_id
                                ? <Loader2 size={14} className="spin" />
                                : <Trash2 size={14} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="historyDangerZone">
            <button
              className="clearSessionsButton"
              type="button"
              onClick={onDeleteAllSessions}
              disabled={deleteAllSessionsBusy || runningSessions.size > 0 || historyItems.length === 0}
            >
              {deleteAllSessionsBusy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              清空全部会话
            </button>
          </div>
            </section>
          ) : null}
        </div>
        <button className={`primaryNavButton ${activeNavigation === "knowledge" ? "active" : ""}`} type="button" onClick={() => navigate("knowledge")} aria-current={activeNavigation === "knowledge" ? "page" : undefined} title="知识卡片库">
          <BookOpen size={20} />
          <span className="sidebarNavLabel">知识卡片库</span>
        </button>
        <button
          className={`primaryNavButton ${activeNavigation === "mistake_collection" ? "active" : ""}`}
          type="button"
          onClick={() => navigate("mistake_collection")}
          aria-current={activeNavigation === "mistake_collection" ? "page" : undefined}
          title="错题卡片库"
        >
          <Files size={20} />
          <span className="sidebarNavLabel">错题卡片库</span>
        </button>
        <button
          className={`primaryNavButton ${activeNavigation === "mistake_sets" ? "active" : ""}`}
          type="button"
          onClick={() => navigate("mistake_sets")}
          aria-current={activeNavigation === "mistake_sets" ? "page" : undefined}
          title="错题集"
        >
          <NotebookTabs size={20} />
          <span className="sidebarNavLabel">错题集</span>
        </button>
      </nav>

      <div className="sidebarFooterNote">
        <span className="statusDot" />
        <span>本地安全存储</span>
      </div>
    </aside>
  );
}
