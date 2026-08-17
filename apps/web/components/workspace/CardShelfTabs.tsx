"use client";

import type { CSSProperties } from "react";
import type { StudyCard } from "../../lib/api";
import { cardThemeProperties } from "../../lib/card-theme";

type Props = {
  cards: StudyCard[];
  sessionId: string;
  activeCardId?: string | null;
  onOpenCard: (
    card: StudyCard,
    origin: DOMRectReadOnly,
    trigger: HTMLButtonElement
  ) => void;
};

export function CardShelfTabs({ cards, sessionId, activeCardId, onOpenCard }: Props) {
  const savedSessionCards = [...cards]
    .filter((card) => Boolean(sessionId) && card.session_id === sessionId && Boolean(card.saved_at))
    .sort((left, right) => (right.saved_at || "").localeCompare(left.saved_at || ""));
  const problemCards = savedSessionCards.filter((card) => card.card_type === "problem_card").slice(0, 1);
  const knowledgeCards = savedSessionCards.filter((card) => card.card_type === "knowledge_card").slice(0, 3);
  const recentCards = [...problemCards, ...knowledgeCards];

  if (recentCards.length === 0) return null;

  let knowledgeIndex = 0;

  return (
    <nav className="cardShelfTabs" aria-label="最近收纳的学习卡片">
      {recentCards.map((card, index) => {
        const knowledge = card.card_type === "knowledge_card";
        if (knowledge) knowledgeIndex += 1;
        const startsKnowledgeStack = knowledge && knowledgeIndex === 1 && problemCards.length > 0;
        const angle = [-7, 5, -4, 7][index] ?? 0;
        const offset = [0, 10, 3, 12][index] ?? 0;
        const activeSource = activeCardId === card.id;
        const style = {
          ...cardThemeProperties(card, knowledge ? knowledgeIndex - 1 : undefined),
          "--shelf-angle": `${angle}deg`,
          "--shelf-offset": `${offset}px`,
          "--shelf-index": index
        } as CSSProperties;
        return (
          <button
            className={`${knowledge ? "knowledgeTab" : "problemTab"}${startsKnowledgeStack ? " firstKnowledgeTab" : ""}${activeSource ? " shelfCardSourceHidden" : ""}`}
            key={card.id}
            type="button"
            style={style}
            data-shelf-card-id={card.id}
            onClick={(event) => onOpenCard(card, event.currentTarget.getBoundingClientRect(), event.currentTarget)}
            title={`查看${knowledge ? "知识" : "题目"}卡片：${card.content.title}`}
            aria-label={`查看${knowledge ? "知识" : "题目"}卡片：${card.content.title}`}
          >
            <span>{knowledge ? card.content.title : "题目卡片"}</span>
          </button>
        );
      })}
    </nav>
  );
}
