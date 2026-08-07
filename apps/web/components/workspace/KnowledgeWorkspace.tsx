"use client";

import { ArrowLeft, BookOpen, CheckSquare2, ChevronRight, FileDown, FolderInput, Search } from "lucide-react";
import { useMemo, useState, type Ref } from "react";

import type { CardFolder, StudyCard } from "../../lib/api";
import { buildKnowledgePaperGroups, type KnowledgePaperGroup } from "../../lib/knowledge-view";
import { stableHistoryPaperAccent } from "../../lib/history-view";
import { MathText } from "../MathText";


export type KnowledgeView =
  | { mode: "overview" }
  | { mode: "paper"; groupId: string };

type Props = {
  workspaceRef?: Ref<HTMLElement>;
  view: KnowledgeView;
  cards: StudyCard[];
  folders: CardFolder[];
  leftOpen: boolean;
  onExpandLeft: () => void;
  onOpenGroup: (group: KnowledgePaperGroup) => void;
  onBackToOverview: () => void;
  onOpenCard: (card: StudyCard, origin: DOMRectReadOnly, trigger: HTMLButtonElement) => void;
  onMoveCard: (card: StudyCard) => void;
  selectionMode?: boolean;
  selectedCardIds?: string[];
  onToggleSelectionMode?: () => void;
  onToggleCardSelection?: (cardId: string) => void;
  onToggleGroupSelection?: (cardIds: string[]) => void;
  onExportSelection?: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Shanghai"
});


export function KnowledgeWorkspace({
  workspaceRef,
  view,
  cards,
  folders,
  leftOpen,
  onExpandLeft,
  onOpenGroup,
  onBackToOverview,
  onOpenCard,
  onMoveCard,
  selectionMode = false,
  selectedCardIds = [],
  onToggleSelectionMode = () => undefined,
  onToggleCardSelection = () => undefined,
  onToggleGroupSelection = () => undefined,
  onExportSelection = () => undefined
}: Props) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => buildKnowledgePaperGroups(cards, folders), [cards, folders]);
  const selectedGroup = view.mode === "paper" ? groups.find((group) => group.id === view.groupId) : undefined;
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const visibleGroups = normalized
    ? groups.filter((group) => group.name.toLocaleLowerCase("zh-CN").includes(normalized)
      || group.cards.some((card) => card.content.title.toLocaleLowerCase("zh-CN").includes(normalized)))
    : groups;
  const visibleCards = selectedGroup
    ? selectedGroup.cards.filter((card) => !normalized
      || card.content.title.toLocaleLowerCase("zh-CN").includes(normalized)
      || (card.content.type === "knowledge_card"
        && card.content.knowledge_point.toLocaleLowerCase("zh-CN").includes(normalized)))
    : [];

  return (
    <section ref={workspaceRef} className="historyWorkspace" aria-label="知识卡片库工作区">
      <header className={`historyWorkspaceHeader${view.mode === "paper" ? " historyWorkspaceHeaderDetail" : ""}`}>
        {leftOpen ? null : (
          <button className="historyWorkspaceNav" type="button" onClick={onExpandLeft} aria-label="展开会话栏">
            <ChevronRight size={18} />
          </button>
        )}
        {view.mode === "paper" ? (
          <button className="historyWorkspaceBack" type="button" onClick={onBackToOverview} aria-label="返回知识卡片库全部试卷">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <div className="historyWorkspaceTitle">
          <h1>{selectedGroup?.name || "知识卡片库"}</h1>
          <p>{selectedGroup ? `${selectedGroup.cards.length} 个知识点` : "按试卷整理已收纳知识卡片"}</p>
        </div>
        <div className="historyWorkspaceToolbar">
          <div className="historySelectionActions">
            <button
              className={`historyWorkspaceAction${selectionMode ? " active" : ""}`}
              type="button"
              onClick={onToggleSelectionMode}
              disabled={groups.length === 0}
              aria-pressed={selectionMode}
            >
              <CheckSquare2 size={16} />
              {selectionMode ? "退出多选" : "多选"}
            </button>
            <button
              className="historyWorkspaceAction historyExportAction"
              type="button"
              onClick={onExportSelection}
              disabled={selectedCardIds.length === 0}
            >
              <FileDown size={16} />
              导出{selectedCardIds.length > 0 ? ` (${selectedCardIds.length})` : ""}
            </button>
          </div>
          <label className="historyWorkspaceSearch">
            <Search size={17} />
            <span className="srOnly">搜索试卷或知识点</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索试卷或知识点" />
          </label>
        </div>
      </header>
      <div className="historyWorkspaceBody">
        <div className="historyWorkspaceBodyInner">
          {groups.length === 0 ? (
            <div className="historyWorkspaceState"><strong>还没有已收纳知识卡片</strong><p>答疑中保存知识卡片后，会按试卷出现在这里。</p></div>
          ) : view.mode === "overview" ? (
            visibleGroups.length === 0 ? (
              <div className="historyWorkspaceState"><strong>没有匹配的试卷或知识点</strong><p>换一个关键词后重试。</p></div>
            ) : (
              <div className="historyPaperGrid">
                {visibleGroups.map((group) => {
                  const groupIds = group.cards.map((card) => card.id);
                  const selectedCount = groupIds.filter((id) => selectedCardIds.includes(id)).length;
                  const allSelected = selectedCount === groupIds.length && groupIds.length > 0;
                  return (
                    <div className="historyPaperCardShell" key={group.id}>
                      <button className="historyPaperCard" type="button" data-accent={stableHistoryPaperAccent(group.id)} onClick={() => onOpenGroup(group)} aria-label={`打开知识试卷：${group.name}`}>
                        <span className="historyPaperPreview">
                          <span className="historyPaperTab" aria-hidden="true" />
                          <span className="historyGradeBadge"><BookOpen size={13} /> 知识归档</span>
                          <strong className="historyPaperCoverTitle">{group.name}</strong>
                          <span className="historyPaperPreviewList">
                            {group.cards.slice(0, 3).map((card) => (
                              <span className="historyPaperQuestionPreview" key={card.id}><MathText text={card.content.title} /></span>
                            ))}
                          </span>
                        </span>
                        <span className="historyPaperMeta"><strong>{group.name}</strong><span>{group.cards.length} 个知识点 · 更新于 {dateFormatter.format(new Date(group.updatedAt))}</span></span>
                      </button>
                      {selectionMode ? (
                        <button
                          className="historyPaperSelect"
                          type="button"
                          onClick={() => onToggleGroupSelection(groupIds)}
                          aria-pressed={allSelected}
                          aria-label={`${allSelected ? "取消选择" : "选择整卷"}：${group.name}`}
                        >
                          <CheckSquare2 size={16} />
                          {allSelected ? "取消整卷" : "选择整卷"}
                          {selectedCount > 0 ? <small>{selectedCount}/{group.cards.length}</small> : null}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : !selectedGroup ? (
            <div className="historyWorkspaceState"><strong>这份知识归档已经不存在</strong><button className="historyWorkspaceAction" type="button" onClick={onBackToOverview}>返回知识卡片库</button></div>
          ) : visibleCards.length === 0 ? (
            <div className="historyWorkspaceState"><strong>没有匹配的知识点</strong><p>清除搜索后查看全部内容。</p></div>
          ) : (
            <div className="historyQuestionList knowledgePointList">
              {visibleCards.map((card) => (
                <div className={`historyQuestionRow${selectionMode ? " selectionMode" : ""}`} key={card.id}>
                  {selectionMode ? (
                    <button
                      className="historyQuestionSelect"
                      type="button"
                      onClick={() => onToggleCardSelection(card.id)}
                      aria-pressed={selectedCardIds.includes(card.id)}
                      aria-label={`${selectedCardIds.includes(card.id) ? "取消选择" : "选择知识卡片"}：${card.content.title}`}
                    >
                      <CheckSquare2 size={18} />
                    </button>
                  ) : null}
                  <button className="historyQuestionOpen" type="button" onClick={(event) => onOpenCard(card, event.currentTarget.getBoundingClientRect(), event.currentTarget)}>
                    <span className="historyQuestionTitle"><strong><MathText text={card.content.title} /></strong></span>
                    <span className="historyQuestionMeta">
                      {card.content.type === "knowledge_card" ? <span><MathText text={card.content.knowledge_point} /></span> : null}
                      <span>保存于 {dateFormatter.format(new Date(card.saved_at || card.created_at))}</span>
                    </span>
                  </button>
                  <button className="historyQuestionDelete knowledgePointMove" type="button" onClick={() => onMoveCard(card)} aria-label={`更换试卷：${card.content.title}`} title="更换试卷">
                    <FolderInput size={17} />
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
