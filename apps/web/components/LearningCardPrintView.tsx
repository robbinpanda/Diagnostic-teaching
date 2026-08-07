"use client";

import type { StudyCard } from "../lib/api";
import { StudyCardPrintCard } from "./StudyCardPrintCard";

type Props = { cards: StudyCard[] };

export function LearningCardPrintView({ cards }: Props) {
  if (cards.length === 0) return null;

  const exportedAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());

  return (
    <section aria-label="知识卡片 PDF 打印稿" className="knowledgeCardPrintRoot printLayout-double">
      <style>{"@media print { @page { size: A4 portrait; margin: 9mm; background: #ffffff; } }"}</style>
      <header className="knowledgeCardPrintHeader">
        <div><span>知识卡片集</span><h1>我的数学知识卡片</h1></div>
        <p>{cards.length} 张 · 固定双列 · {exportedAt}</p>
      </header>
      <div className="knowledgeCardPrintColumns" style={{ columnCount: 2 }}>
        {cards.map((card, index) => <StudyCardPrintCard content={card.content} index={index} key={card.id} />)}
      </div>
    </section>
  );
}
