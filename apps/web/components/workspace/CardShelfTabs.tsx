"use client";

import { BookOpen, ClipboardCheck } from "lucide-react";
import type { StudyCard } from "../../lib/api";

type Props = {
  cards: StudyCard[];
  onOpenCard: (card: StudyCard) => void;
};

export function CardShelfTabs({ cards, onOpenCard }: Props) {
  const recentCards = [...cards]
    .filter((card) => Boolean(card.saved_at))
    .sort((left, right) => (right.saved_at || "").localeCompare(left.saved_at || ""))
    .slice(0, 4);

  if (recentCards.length === 0) return null;

  return (
    <nav className="cardShelfTabs" aria-label="最近收纳的学习卡片">
      {recentCards.map((card, index) => {
        const knowledge = card.card_type === "knowledge_card";
        return (
          <button
            className={knowledge ? "knowledgeTab" : "problemTab"}
            key={card.id}
            type="button"
            onClick={() => onOpenCard(card)}
            title={`查看${knowledge ? "知识" : "题目"}卡片：${card.content.title}`}
            aria-label={`查看${knowledge ? "知识" : "题目"}卡片：${card.content.title}`}
          >
            {knowledge ? <BookOpen size={14} /> : <ClipboardCheck size={14} />}
            <span>{card.content.title}</span>
            <small>{index + 1}</small>
          </button>
        );
      })}
    </nav>
  );
}
