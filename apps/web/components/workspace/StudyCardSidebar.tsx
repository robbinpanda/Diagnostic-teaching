"use client";

import { BookOpen, ChevronRight, ClipboardCheck, FileDown, Loader2, Trash2 } from "lucide-react";
import type { StudyCard } from "../../lib/api";
import { MathText } from "../MathText";

export type StudyCardFilter = "all" | "knowledge_card" | "problem_card";

type Props = {
  cards: StudyCard[];
  filteredCards: StudyCard[];
  filter: StudyCardFilter;
  cardBusyId: string;
  deleteAllCardsBusy: boolean;
  composerBlocked: boolean;
  onCollapse: () => void;
  onFilterChange: (filter: StudyCardFilter) => void;
  onOpenCard: (card: StudyCard) => void;
  onDeleteCard: (card: StudyCard) => void;
  onExport: () => void;
  onDeleteAllCards: () => void;
};

export function StudyCardSidebar({
  cards,
  filteredCards,
  filter,
  cardBusyId,
  deleteAllCardsBusy,
  composerBlocked,
  onCollapse,
  onFilterChange,
  onOpenCard,
  onDeleteCard,
  onExport,
  onDeleteAllCards
}: Props) {
  return (
    <aside className="cardSidebar">
      <div className="cardSidebarHeader">
        <div><strong>知识卡片</strong><span>{cards.length} 张已归档</span></div>
        <button className="plainIconButton" type="button" onClick={onCollapse} aria-label="收起卡片栏"><ChevronRight size={18} /></button>
      </div>
      <div className="cardFilters" aria-label="筛选学习卡片">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => onFilterChange("all")}>全部</button>
        <button type="button" className={filter === "knowledge_card" ? "active" : ""} onClick={() => onFilterChange("knowledge_card")}>知识</button>
        <button type="button" className={filter === "problem_card" ? "active" : ""} onClick={() => onFilterChange("problem_card")}>题目</button>
      </div>
      <div className="cardList">
        {filteredCards.length === 0 && <div className="cardEmpty"><BookOpen size={21} /><span>还没有卡片</span></div>}
        {filteredCards.map((card) => (
          <div className="cardItem" key={card.id}>
            <button className="cardOpenButton" type="button" onClick={() => onOpenCard(card)}>
              <span className={`cardIcon ${card.card_type === "knowledge_card" ? "knowledge" : "problem"}`}>
                {card.card_type === "knowledge_card" ? <BookOpen size={16} /> : <ClipboardCheck size={16} />}
              </span>
              <span className="cardText"><strong><MathText text={card.content.title} /></strong><small>{card.card_type === "knowledge_card" ? "知识卡片" : "题目卡片"}</small></span>
            </button>
            <button className="cardDeleteButton" type="button" onClick={() => onDeleteCard(card)} disabled={Boolean(cardBusyId)} aria-label={`删除卡片：${card.content.title}`}>
              {cardBusyId === card.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        ))}
      </div>
      <div className="cardSidebarActions">
        <button className="exportCardsButton" type="button" onClick={onExport} disabled={cards.length === 0}>
          <FileDown size={15} />
          导出卡片
        </button>
        <button className="clearCardsButton" type="button" onClick={onDeleteAllCards} disabled={deleteAllCardsBusy || composerBlocked || cards.length === 0}>
          {deleteAllCardsBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
          清空卡片
        </button>
      </div>
    </aside>
  );
}
