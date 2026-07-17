"use client";

import type { StudyCard } from "../lib/api";

import type { LearningCardExportLayout } from "./LearningCardExportDialog";
import { MathText } from "./MathText";

type Props = {
  cards: StudyCard[];
  layout: LearningCardExportLayout;
};

const LAYOUT_META: Record<
  LearningCardExportLayout,
  { label: string; page: string; columns: number }
> = {
  single: { label: "单列舒展", page: "A4 portrait", columns: 1 },
  double: { label: "双列阅读", page: "A4 portrait", columns: 2 },
  triple: { label: "三列速览", page: "A4 landscape", columns: 3 },
};

function TextList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="printEmptyLine">{emptyText}</p>;
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>
          <MathText text={item} />
        </li>
      ))}
    </ul>
  );
}

export function LearningCardPrintView({ cards, layout }: Props) {
  if (cards.length === 0) {
    return null;
  }

  const meta = LAYOUT_META[layout];
  const exportedAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  return (
    <section
      aria-label="学习卡片 PDF 打印稿"
      className={`knowledgeCardPrintRoot printLayout-${layout}`}
    >
      <style>{`@media print { @page { size: ${meta.page}; margin: 11mm; background: #ffffff; } }`}</style>
      <header className="knowledgeCardPrintHeader">
        <div>
          <span>学习卡片集</span>
          <h1>我的数学学习卡片</h1>
        </div>
        <p>
          {cards.length} 张 · {meta.label} · {exportedAt}
        </p>
      </header>

      <div className="knowledgeCardPrintColumns" style={{ columnCount: meta.columns }}>
        {cards.map((card, index) => {
          const content = card.content;
          const isKnowledgeCard = content.type === "knowledge_card";

          return (
            <article
              className={`knowledgeCardPrintCard ${
                isKnowledgeCard ? "knowledgeCard" : "problemCard"
              }`}
              key={card.id}
            >
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{isKnowledgeCard ? "知识卡片" : "题目卡片"}</small>
                  <h2>
                    <MathText text={content.title} />
                  </h2>
                </div>
              </header>

              {content.type === "knowledge_card" ? (
                <>
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
                          <strong>
                            <MathText text={step.title} />
                          </strong>
                          <MathText text={step.content} />
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section>
                    <h3>什么时候用</h3>
                    <TextList
                      emptyText="本卡未记录额外适用场景。"
                      items={content.when_to_use}
                    />
                  </section>
                  <section>
                    <h3>容易踩的坑</h3>
                    <TextList
                      emptyText="本卡没有额外需要提醒的坑点。"
                      items={content.common_mistakes}
                    />
                  </section>
                  <section className="printProblemConnection">
                    <h3>回到当前题</h3>
                    <MathText text={content.connection_to_problem} />
                  </section>
                </>
              ) : (
                <>
                  <section className="printProblemLead">
                    <h3>题目摘要</h3>
                    <MathText text={content.problem_summary} />
                  </section>
                  <section>
                    <h3>解题路线</h3>
                    <MathText text={content.solution_overview} />
                  </section>
                  <section>
                    <h3>完整解答</h3>
                    <ol className="printSolutionStepList">
                      {content.solution_steps.map((step, stepIndex) => (
                        <li key={`${stepIndex}-${step.title}`}>
                          <strong>
                            {step.step}. <MathText text={step.title} />
                          </strong>
                          <MathText text={step.reasoning} />
                          <div className="printStepResult">
                            <MathText text={step.result} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section>
                    <h3>怎么想到</h3>
                    <TextList
                      emptyText="本卡未记录额外思考提示。"
                      items={content.how_to_think}
                    />
                  </section>
                  <section>
                    <h3>容易踩的坑</h3>
                    <TextList
                      emptyText="本卡没有额外需要提醒的坑点。"
                      items={content.pitfalls}
                    />
                  </section>
                  <section className="printFinalAnswer">
                    <h3>最终答案</h3>
                    <MathText text={content.final_answer} />
                  </section>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
