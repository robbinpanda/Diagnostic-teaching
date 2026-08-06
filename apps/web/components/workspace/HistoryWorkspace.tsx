"use client";

import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionHistoryItem } from "../../lib/api";
import {
  buildHistoryPaperGroups,
  filterHistoryPaperGroups,
  filterHistoryQuestions,
  sortHistoryPaperGroups,
  stableHistoryPaperAccent,
  UNCLASSIFIED_PAPER_ID
} from "../../lib/history-view";
import type {
  HistoryPaperGroup,
  HistorySortMode,
  HistoryView
} from "../../lib/history-view";
import { MathText } from "../MathText";

type Props = {
  view: Exclude<HistoryView, null>;
  items: SessionHistoryItem[];
  overviewQuery: string;
  sortMode: HistorySortMode;
  selectedPaperName: string;
  historyBusy: boolean;
  historyLoadError: string;
  actionError: string;
  leftOpen: boolean;
  activeSessionId: string;
  runningSessionIds: string[];
  openSessionBusyId: string;
  deleteSessionBusyId: string;
  onExpandLeft: () => void;
  onOverviewQueryChange: (value: string) => void;
  onSortModeChange: (mode: HistorySortMode) => void;
  onOpenPaper: (group: HistoryPaperGroup) => void;
  onBackToOverview: () => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (item: SessionHistoryItem) => void;
  onStartNewChat: () => void;
  onRetry: () => void;
  onClearActionError: () => void;
};

const historyDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Shanghai"
});

const historySkeletonIds = Array.from({ length: 6 }, (_, index) => `history-skeleton-${index}`);

function formatHistoryDate(value: string) {
  return historyDateFormatter.format(new Date(value));
}

function historyGradeLabel(group: HistoryPaperGroup) {
  if (group.id === UNCLASSIFIED_PAPER_ID) return "未分类";
  if (group.gradeBands.length > 1) return "混合学段";
  return group.gradeBands[0] === "senior" ? "高中数学" : "初中数学";
}

export function HistoryWorkspace({
  view,
  items,
  overviewQuery,
  sortMode,
  selectedPaperName,
  historyBusy,
  historyLoadError,
  actionError,
  leftOpen,
  activeSessionId,
  runningSessionIds,
  openSessionBusyId,
  deleteSessionBusyId,
  onExpandLeft,
  onOverviewQueryChange,
  onSortModeChange,
  onOpenPaper,
  onBackToOverview,
  onOpenSession,
  onDeleteSession,
  onStartNewChat,
  onRetry,
  onClearActionError
}: Props) {
  const [paperQuery, setPaperQuery] = useState("");
  const groups = useMemo(() => buildHistoryPaperGroups(items), [items]);
  const visibleGroups = useMemo(
    () => sortHistoryPaperGroups(filterHistoryPaperGroups(groups, overviewQuery), sortMode),
    [groups, overviewQuery, sortMode]
  );
  const selectedGroup = view.mode === "paper"
    ? groups.find((group) => group.id === view.paperId)
    : undefined;
  const visibleQuestions = filterHistoryQuestions(selectedGroup?.items ?? [], paperQuery);
  const runningSessions = new Set(runningSessionIds);
  const detailPaperName = selectedGroup?.name || selectedPaperName || "未命名试卷";
  const detailQuestionCount = selectedGroup?.items.length ?? 0;
  const loadFailedWithoutContent = Boolean(historyLoadError) && items.length === 0;

  return (
    <section className="historyWorkspace" aria-label="历史搜题工作区" aria-busy={historyBusy}>
      <header
        className={`historyWorkspaceHeader${view.mode === "paper" ? " historyWorkspaceHeaderDetail" : ""}`}
      >
        {leftOpen ? null : (
          <button
            className="historyWorkspaceNav"
            type="button"
            onClick={onExpandLeft}
            aria-label="展开会话栏"
          >
            <ChevronRight size={18} />
          </button>
        )}

        {view.mode === "paper" ? (
          <button
            className="historyWorkspaceBack"
            type="button"
            onClick={onBackToOverview}
            aria-label="返回全部试卷"
            title="返回全部试卷"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        ) : null}

        <div className="historyWorkspaceTitle">
          <h1>{view.mode === "overview" ? "历史搜题" : detailPaperName}</h1>
          <p>
            {view.mode === "overview"
              ? "按试卷继续你的学习"
              : `${detailQuestionCount} 道题`}
          </p>
        </div>

        <div className="historyWorkspaceToolbar">
          <label className="historyWorkspaceSearch">
            <Search size={17} />
            <span className="srOnly">
              {view.mode === "overview" ? "搜索试卷或题目" : "搜索这份试卷中的题目"}
            </span>
            <input
              type="search"
              value={view.mode === "overview" ? overviewQuery : paperQuery}
              onChange={(event) => {
                if (view.mode === "overview") onOverviewQueryChange(event.target.value);
                else setPaperQuery(event.target.value);
              }}
              placeholder={view.mode === "overview" ? "搜索试卷或题目" : "搜索这份试卷中的题目"}
            />
          </label>
          {view.mode === "overview" ? (
            <select
              className="historyWorkspaceSort"
              aria-label="历史排序"
              value={sortMode}
              onChange={(event) => onSortModeChange(event.target.value as HistorySortMode)}
            >
              <option value="recent">最近更新</option>
              <option value="name">名称排序</option>
            </select>
          ) : null}
        </div>
      </header>

      <div className="historyWorkspaceBody">
        <div className="historyWorkspaceBodyInner">
          {actionError ? (
            <div className="historyWorkspaceAlert" role="alert">
              <span>{actionError}</span>
              <button
                className="historyWorkspaceAction"
                type="button"
                onClick={onClearActionError}
                aria-label="关闭操作错误"
              >
                <X size={16} />
                <span>关闭</span>
              </button>
            </div>
          ) : null}

          {historyLoadError && items.length > 0 ? (
            <div className="historyWorkspaceAlert" role="alert">
              <span>{historyLoadError}</span>
              <button className="historyWorkspaceAction" type="button" onClick={onRetry}>
                <RefreshCw size={16} />
                <span>重新加载</span>
              </button>
            </div>
          ) : null}

          {loadFailedWithoutContent ? (
            <div className="historyWorkspaceState" role="alert">
              <strong>历史答疑加载失败</strong>
              <p>{historyLoadError}</p>
              <button className="historyWorkspaceAction" type="button" onClick={onRetry}>
                <RefreshCw size={17} />
                <span>重新加载</span>
              </button>
            </div>
          ) : view.mode === "overview" ? (
            historyBusy && items.length === 0 ? (
              <div className="historySkeletonGrid" aria-label="正在加载历史试卷">
                {historySkeletonIds.map((id) => (
                  <div className="historyPaperSkeleton" key={id} aria-hidden="true" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="historyWorkspaceState">
                <strong>还没有历史答疑</strong>
                <p>从一道题开始，之后可以按试卷继续学习。</p>
                <button className="historyWorkspaceAction" type="button" onClick={onStartNewChat}>
                  <MessageSquarePlus size={17} />
                  <span>开始答疑</span>
                </button>
              </div>
            ) : visibleGroups.length === 0 ? (
              <div className="historyWorkspaceState">
                <strong>没有匹配的试卷或题目</strong>
                <p>换一个关键词，或清除当前搜索。</p>
                <button
                  className="historyWorkspaceAction"
                  type="button"
                  onClick={() => onOverviewQueryChange("")}
                >
                  <X size={17} />
                  <span>清除搜索</span>
                </button>
              </div>
            ) : (
              <div className="historyPaperGrid">
                {visibleGroups.map((group) => (
                  <button
                    className="historyPaperCard"
                    type="button"
                    key={group.id}
                    data-accent={stableHistoryPaperAccent(group.id)}
                    onClick={() => onOpenPaper(group)}
                    aria-label={`打开试卷：${group.name}`}
                  >
                    <span className="historyPaperPreview">
                      <span className="historyPaperTab" aria-hidden="true" />
                      <span className="historyGradeBadge">{historyGradeLabel(group)}</span>
                      <strong className="historyPaperCoverTitle">{group.name}</strong>
                      <span className="historyPaperPreviewList">
                        {group.items.slice(0, 3).map((item) => (
                          <span className="historyPaperQuestionPreview" key={item.session_id}>
                            <MathText text={item.title || "未命名题目"} />
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="historyPaperMeta">
                      <strong>{group.name}</strong>
                      <span>{group.items.length} 道题 · 更新于 {formatHistoryDate(group.updatedAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : historyBusy && items.length === 0 ? (
            <div className="historyWorkspaceState">
              <Loader2 size={20} className="spin" />
              <strong>正在加载历史答疑</strong>
            </div>
          ) : !selectedGroup ? (
            <div className="historyWorkspaceState">
              <strong>这份试卷暂无历史题目</strong>
              <p>它可能刚刚在其他位置被清空。</p>
              <button className="historyWorkspaceAction" type="button" onClick={onBackToOverview}>
                <ArrowLeft size={17} />
                <span>返回全部试卷</span>
              </button>
            </div>
          ) : visibleQuestions.length === 0 && paperQuery.trim() ? (
            <div className="historyWorkspaceState">
              <strong>没有匹配的题目</strong>
              <p>换一个关键词，或清除当前搜索。</p>
              <button className="historyWorkspaceAction" type="button" onClick={() => setPaperQuery("")}>
                <X size={17} />
                <span>清除搜索</span>
              </button>
            </div>
          ) : (
            <div className="historyQuestionList">
              {visibleQuestions.map((item) => {
                const title = item.title || "未命名题目";
                const isRunning = runningSessions.has(item.session_id);
                const deleteDisabled = Boolean(deleteSessionBusyId)
                  || Boolean(openSessionBusyId)
                  || isRunning
                  || item.session_id === activeSessionId;
                const openDisabled = Boolean(openSessionBusyId) || Boolean(deleteSessionBusyId);

                return (
                  <div className="historyQuestionRow" key={item.session_id}>
                    <button
                      className="historyQuestionOpen"
                      type="button"
                      onClick={() => onOpenSession(item.session_id)}
                      disabled={openDisabled}
                    >
                      <span className="historyQuestionTitle">
                        <strong><MathText text={title} /></strong>
                      </span>
                      <span className="historyQuestionMeta">
                        {isRunning ? (
                          <span>
                            <Loader2 size={13} className="spin" />
                            正在思考
                          </span>
                        ) : null}
                        {openSessionBusyId === item.session_id ? (
                          <span>
                            <Loader2 size={13} className="spin" />
                            正在打开
                          </span>
                        ) : null}
                        <span>{item.message_count} 条消息</span>
                        {item.checkpoint_count > 0 ? <span>{item.checkpoint_count} 个检查点</span> : null}
                        <span>更新于 {formatHistoryDate(item.updated_at)}</span>
                      </span>
                    </button>
                    <button
                      className="historyQuestionDelete"
                      type="button"
                      onClick={() => onDeleteSession(item)}
                      disabled={deleteDisabled}
                      aria-label={`删除会话：${title}`}
                    >
                      {deleteSessionBusyId === item.session_id
                        ? <Loader2 size={17} className="spin" />
                        : <Trash2 size={17} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
