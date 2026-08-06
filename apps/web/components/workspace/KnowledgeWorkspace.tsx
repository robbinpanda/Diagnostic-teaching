"use client";

import { ArrowLeft, BookOpen, ChevronRight, FolderInput, Search } from "lucide-react";
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
  onMoveCard
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
    <section ref={workspaceRef} className="historyWorkspace" aria-label="知识库工作区">
      <header className={`historyWorkspaceHeader${view.mode === "paper" ? " historyWorkspaceHeaderDetail" : ""}`}>
        {leftOpen ? null : (
          <button className="historyWorkspaceNav" type="button" onClick={onExpandLeft} aria-label="展开会话栏">
            <ChevronRight size={18} />
          </button>
        )}
        {view.mode === "paper" ? (
          <button className="historyWorkspaceBack" type="button" onClick={onBackToOverview} aria-label="返回知识库全部试卷">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <div className="historyWorkspaceTitle">
          <h1>{selectedGroup?.name || "知识库"}</h1>
          <p>{selectedGroup ? `${selectedGroup.cards.length} 个知识点` : "按试卷整理已收纳知识卡片"}</p>
        </div>
        <label className="historyWorkspaceSearch">
          <Search size={17} />
          <span className="srOnly">搜索试卷或知识点</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索试卷或知识点" />
        </label>
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
                {visibleGroups.map((group) => (
                  <button className="historyPaperCard" type="button" key={group.id} data-accent={stableHistoryPaperAccent(group.id)} onClick={() => onOpenGroup(group)} aria-label={`打开知识试卷：${group.name}`}>
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
                ))}
              </div>
            )
          ) : !selectedGroup ? (
            <div className="historyWorkspaceState"><strong>这份知识归档已经不存在</strong><button className="historyWorkspaceAction" type="button" onClick={onBackToOverview}>返回知识库</button></div>
          ) : visibleCards.length === 0 ? (
            <div className="historyWorkspaceState"><strong>没有匹配的知识点</strong><p>清除搜索后查看全部内容。</p></div>
          ) : (
            <div className="historyQuestionList knowledgePointList">
              {visibleCards.map((card) => (
                <div className="historyQuestionRow" key={card.id}>
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
