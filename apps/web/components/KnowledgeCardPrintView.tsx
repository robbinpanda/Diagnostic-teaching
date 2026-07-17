"use client";

import type { StudyCard } from "../lib/api";
import type { KnowledgeCardExportLayout } from "./KnowledgeCardExportDialog";
import { MathText } from "./MathText";

type Props = {
  cards: StudyCard[];
  layout: KnowledgeCardExportLayout;
};

const LAYOUT_META: Record<KnowledgeCardExportLayout, { label: string; page: string; columns: number }> = {
  single: { label: "单列讲义", page: "A4 portrait", columns: 1 },
  double: { label: "双列阅读", page: "A4 portrait", columns: 2 },
  triple: { label: "三列速览", page: "A4 landscape", columns: 3 }
};

function TextList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) return <p className="printEmptyLine">{emptyText}</p>;
  return (
    <ul>
      {items.map((item, index) => <li key={`${index}-${item}`}><MathText text={item} /></li>)}
    </ul>
  );
}

export function KnowledgeCardPrintView({ cards, layout }: Props) {
  if (cards.length === 0) return null;
  const meta = LAYOUT_META[layout];
  const exportedAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());

  return (
    <section className={`knowledgeCardPrintRoot printLayout-${layout}`} aria-label="知识卡片 PDF 打印稿">
      <style>{`@media print { @page { size: ${meta.page}; margin: 11mm; } }`}</style>
      <header className="knowledgeCardPrintHeader">
        <div>
          <span>知识卡片集</span>
          <h1>我的数学知识卡片</h1>
        </div>
        <p>{cards.length} 张 · {meta.label} · {exportedAt}</p>
      </header>

      <div className="knowledgeCardPrintColumns" style={{ columnCount: meta.columns }}>
        {cards.map((card, index) => {
          const content = card.content;
          if (content.type !== "knowledge_card") return null;
          return (
            <article className="knowledgeCardPrintCard" key={card.id}>
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>知识卡片</small>
                  <h2><MathText text={content.title} /></h2>
                </div>
              </header>

              <section className="printKnowledgeLead">
                <h3>知识点</h3>
                <MathText text={content.knowledge_point} />
              </section>
              <section>
                <h3>核心原理</h3>
                <MathText text={content.core_idea} />
              </section>
              <section>
                <h3>原理怎么推出</h3>
                <ol className="printDerivationList">
                  {content.derivation_steps.map((step, stepIndex) => (
                    <li key={`${stepIndex}-${step.title}`}>
                      <strong><MathText text={step.title} /></strong>
                      <MathText text={step.content} />
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h3>什么时候用</h3>
                <TextList items={content.when_to_use} emptyText="本卡未记录额外适用场景。" />
              </section>
              <section>
                <h3>容易踩的坑</h3>
                <TextList items={content.common_mistakes} emptyText="本卡没有额外需要提醒的坑点。" />
              </section>
              <section className="printProblemConnection">
                <h3>回到当前题</h3>
                <MathText text={content.connection_to_problem} />
              </section>
            </article>
          );
        })}
      </div>
    </section>
  );
}
