"use client";

import {
  ArrowLeft,
  CheckCircle2,
  CheckSquare2,
  ChevronRight,
  FileDown,
  Loader2,
  MessageSquarePlus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useMemo, useState, type Ref } from "react";

import type { CardFolder, StudyCard } from "../../lib/api";
import type { HistorySortMode, HistoryView } from "../../lib/history-view";
import { stableHistoryPaperAccent } from "../../lib/history-view";
import { buildProblemPaperGroups, type ProblemPaperGroup } from "../../lib/problem-view";
import { MathText } from "../MathText";


type Props = {
  view: Exclude<HistoryView, null>;
  workspaceRef?: Ref<HTMLElement>;
  cards: StudyCard[];
  folders: CardFolder[];
  overviewQuery: string;
  sortMode: HistorySortMode;
  actionError: string;
  notice?: string;
  leftOpen: boolean;
  cardBusyId: string;
  selectionMode?: boolean;
  selectedCardIds?: string[];
  exportBusy?: boolean;
  onExpandLeft: () => void;
  onOverviewQueryChange: (value: string) => void;
  onSortModeChange: (mode: HistorySortMode) => void;
  onOpenPaper: (group: ProblemPaperGroup) => void;
  onBackToOverview: () => void;
  onOpenCard: (card: StudyCard, origin: DOMRectReadOnly, trigger: HTMLButtonElement) => void;
  onDeleteCard: (card: StudyCard) => void;
  onToggleSelectionMode?: () => void;
  onToggleCardSelection?: (cardId: string) => void;
  onToggleGroupSelection?: (cardIds: string[]) => void;
  onExportSelection?: () => void;
  onStartNewChat: () => void;
  onClearActionError: () => void;
  onClearNotice?: () => void;
};


const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Shanghai"
});


export function HistoryWorkspace({
  view,
  workspaceRef,
  cards,
  folders,
  overviewQuery,
  sortMode,
  actionError,
  notice = "",
  leftOpen,
  cardBusyId,
  selectionMode = false,
  selectedCardIds = [],
  exportBusy = false,
  onExpandLeft,
  onOverviewQueryChange,
  onSortModeChange,
  onOpenPaper,
  onBackToOverview,
  onOpenCard,
  onDeleteCard,
  onToggleSelectionMode = () => undefined,
  onToggleCardSelection = () => undefined,
  onToggleGroupSelection = () => undefined,
  onExportSelection = () => undefined,
  onStartNewChat,
  onClearActionError,
  onClearNotice
}: Props) {
  const [paperQuery, setPaperQuery] = useState("");
  const groups = useMemo(() => buildProblemPaperGroups(cards, folders), [cards, folders]);
  const selectedGroup = view.mode === "paper"
    ? groups.find((group) => group.id === view.paperId)
    : undefined;
  const query = view.mode === "overview" ? overviewQuery : paperQuery;
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const filteredGroups = normalized
    ? groups.filter((group) => group.name.toLocaleLowerCase("zh-CN").includes(normalized)
      || group.cards.some((card) => card.content.title.toLocaleLowerCase("zh-CN").includes(normalized)))
    : groups;
  const visibleGroups = [...filteredGroups].sort((left, right) => sortMode === "name"
    ? left.name.localeCompare(right.name, "zh-CN")
    : right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name, "zh-CN"));
  const visibleCards = selectedGroup
    ? selectedGroup.cards.filter((card) => !normalized
      || card.content.title.toLocaleLowerCase("zh-CN").includes(normalized)
      || (card.content.type === "problem_card"
        && card.content.problem_summary.toLocaleLowerCase("zh-CN").includes(normalized)))
    : [];

  return (
    <section ref={workspaceRef} className="historyWorkspace" aria-label="错题卡片库工作区">
      <header className={`historyWorkspaceHeader${view.mode === "paper" ? " historyWorkspaceHeaderDetail" : ""}`}>
        {leftOpen ? null : (
          <button className="historyWorkspaceNav" type="button" onClick={onExpandLeft} aria-label="展开会话栏">
            <ChevronRight size={18} />
          </button>
        )}
        {view.mode === "paper" ? (
          <button className="historyWorkspaceBack" type="button" onClick={onBackToOverview} aria-label="返回错题卡片库全部试卷" title="返回全部试卷">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <div className="historyWorkspaceTitle">
          <h1>{selectedGroup?.name || "错题卡片库"}</h1>
          <p>{selectedGroup ? `${selectedGroup.cards.length} 张题目卡片` : "卡片入库后永久保留，与答疑会话相互独立"}</p>
        </div>
        <div className="historyWorkspaceToolbar">
          <div className="historySelectionActions">
            <button className={`historyWorkspaceAction${selectionMode ? " active" : ""}`} type="button" onClick={onToggleSelectionMode} disabled={groups.length === 0} aria-pressed={selectionMode}>
              <CheckSquare2 size={16} />{selectionMode ? "退出多选" : "多选"}
            </button>
            <button className="historyWorkspaceAction historyExportAction" type="button" onClick={onExportSelection} disabled={selectedCardIds.length === 0 || exportBusy}>
              {exportBusy ? <Loader2 className="spin" size={16} /> : <FileDown size={16} />}
              导出{selectedCardIds.length > 0 ? ` (${selectedCardIds.length})` : ""}
            </button>
          </div>
          <label className="historyWorkspaceSearch">
            <Search size={17} />
            <span className="srOnly">搜索试卷或题目卡片</span>
            <input
              type="search"
              value={query}
              onChange={(event) => view.mode === "overview"
                ? onOverviewQueryChange(event.target.value)
                : setPaperQuery(event.target.value)}
              placeholder={view.mode === "overview" ? "搜索试卷或题目卡片" : "搜索这份试卷中的卡片"}
            />
          </label>
          {view.mode === "overview" ? (
            <select className="historyWorkspaceSort" aria-label="错题卡片库排序" value={sortMode} onChange={(event) => onSortModeChange(event.target.value as HistorySortMode)}>
              <option value="recent">最近更新</option>
              <option value="name">名称排序</option>
            </select>
          ) : null}
        </div>
      </header>

      <div className="historyWorkspaceBody">
        <div className="historyWorkspaceBodyInner">
          {notice ? (
            <div className="historyWorkspaceAlert historyWorkspaceNotice" role="status">
              <span><CheckCircle2 size={16} />{notice}</span>
              <button className="historyWorkspaceAction" type="button" onClick={onClearNotice} aria-label="关闭提示"><X size={16} /><span>关闭</span></button>
            </div>
          ) : null}
          {actionError ? (
            <div className="historyWorkspaceAlert" role="alert">
              <span>{actionError}</span>
              <button className="historyWorkspaceAction" type="button" onClick={onClearActionError} aria-label="关闭操作错误"><X size={16} /><span>关闭</span></button>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="historyWorkspaceState">
              <strong>还没有题目卡片</strong>
              <p>完成答疑并归档题目卡片后才会出现在这里；未生成或未入库的题目不会显示。</p>
              <button className="historyWorkspaceAction" type="button" onClick={onStartNewChat}><MessageSquarePlus size={17} /><span>开始答疑</span></button>
            </div>
          ) : view.mode === "overview" ? (
            visibleGroups.length === 0 ? (
              <div className="historyWorkspaceState"><strong>没有匹配的试卷或题目卡片</strong><p>换一个关键词后重试。</p></div>
            ) : (
              <div className="historyPaperGrid">
                {visibleGroups.map((group) => {
                  const groupIds = group.cards.map((card) => card.id);
                  const selectedCount = groupIds.filter((id) => selectedCardIds.includes(id)).length;
                  const allSelected = selectedCount === groupIds.length && groupIds.length > 0;
                  return (
                    <div className="historyPaperCardShell" key={group.id}>
                      <button className="historyPaperCard" type="button" data-accent={stableHistoryPaperAccent(group.id)} onClick={() => onOpenPaper(group)} aria-label={`打开题目卡片归档：${group.name}`}>
                        <span className="historyPaperPreview">
                          <span className="historyPaperTab" aria-hidden="true" />
                          <span className="historyGradeBadge">题目卡片</span>
                          <strong className="historyPaperCoverTitle">{group.name}</strong>
                          <span className="historyPaperPreviewList">
                            {group.cards.slice(0, 3).map((card) => <span className="historyPaperQuestionPreview" key={card.id}><MathText text={card.content.title} /></span>)}
                          </span>
                        </span>
                        <span className="historyPaperMeta"><strong>{group.name}</strong><span>{group.cards.length} 张卡片 · 更新于 {dateFormatter.format(new Date(group.updatedAt))}</span></span>
                      </button>
                      {selectionMode ? (
                        <button className="historyPaperSelect" type="button" onClick={() => onToggleGroupSelection(groupIds)} aria-pressed={allSelected} aria-label={`${allSelected ? "取消选择" : "选择整卷"}：${group.name}`}>
                          <CheckSquare2 size={16} />{allSelected ? "取消整卷" : "选择整卷"}{selectedCount > 0 ? <small>{selectedCount}/{group.cards.length}</small> : null}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : !selectedGroup ? (
            <div className="historyWorkspaceState"><strong>这份题目卡片归档已经不存在</strong><button className="historyWorkspaceAction" type="button" onClick={onBackToOverview}>返回错题卡片库</button></div>
          ) : visibleCards.length === 0 ? (
            <div className="historyWorkspaceState"><strong>没有匹配的题目卡片</strong><p>清除搜索后查看全部内容。</p></div>
          ) : (
            <div className="historyQuestionList">
              {visibleCards.map((card) => (
                <div className={`historyQuestionRow${selectionMode ? " selectionMode" : ""}`} key={card.id}>
                  {selectionMode ? (
                    <button className="historyQuestionSelect" type="button" onClick={() => onToggleCardSelection(card.id)} aria-pressed={selectedCardIds.includes(card.id)} aria-label={`${selectedCardIds.includes(card.id) ? "取消选择" : "选择题目卡片"}：${card.content.title}`}>
                      <CheckSquare2 size={18} />
                    </button>
                  ) : null}
                  <button className="historyQuestionOpen" type="button" onClick={(event) => onOpenCard(card, event.currentTarget.getBoundingClientRect(), event.currentTarget)} disabled={Boolean(cardBusyId)}>
                    <span className="historyQuestionTitle"><strong><MathText text={card.content.title} /></strong></span>
                    <span className="historyQuestionMeta">
                      {card.content.type === "problem_card" ? <span><MathText text={card.content.problem_summary} /></span> : null}
                      <span>保存于 {dateFormatter.format(new Date(card.saved_at || card.created_at))}</span>
                    </span>
                  </button>
                  <button className="historyQuestionDelete" type="button" onClick={() => onDeleteCard(card)} disabled={Boolean(cardBusyId)} aria-label={`删除题目卡片：${card.content.title}`}>
                    {cardBusyId === card.id ? <Loader2 size={17} className="spin" /> : <Trash2 size={17} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
