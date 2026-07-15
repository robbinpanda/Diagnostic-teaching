"use client";

import { BookOpen, ClipboardCheck, Loader2, X } from "lucide-react";
import type { StudyCard } from "../lib/api";
import { MathText } from "./MathText";

type Props = {
  card: StudyCard | null;
  onClose: () => void;
  busy?: boolean;
};

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="cardEmptyLine">本卡没有额外需要提醒的坑点。</p>;
  return (
    <ul className="cardTextList">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}><MathText text={item} /></li>
      ))}
    </ul>
  );
}

export function StudyCardModal({ card, onClose, busy = false }: Props) {
  if (!card) return null;
  const content = card.content;
  const isKnowledge = content.type === "knowledge_card";

  return (
    <div className="modalBackdrop cardBackdrop" role="dialog" aria-modal="true" aria-label={content.title}>
      <article className={`studyCardDialog ${isKnowledge ? "knowledgeCard" : "problemCard"}`}>
        <header className="studyCardHeader">
          <div>
            <div className="studyCardKicker">
              {isKnowledge ? <BookOpen size={19} /> : <ClipboardCheck size={19} />}
              {isKnowledge ? "知识卡片" : "题目卡片"}
            </div>
            <h2><MathText text={content.title} /></h2>
          </div>
          <button
            className="cardCloseButton"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭卡片"
            title="关闭卡片"
          >
            {busy ? <Loader2 size={28} className="spin" /> : <X size={32} strokeWidth={2.4} />}
          </button>
        </header>

        {isKnowledge ? (
          <div className="studyCardBody">
            <section className="cardLeadSection">
              <span>本卡知识点</span>
              <MathText text={content.knowledge_point} />
            </section>
            <section>
              <h3>核心原理</h3>
              <MathText text={content.core_idea} />
            </section>
            <section>
              <h3>原理怎么推出</h3>
              <ol className="cardStepList">
                {content.derivation_steps.map((item, index) => (
                  <li key={`${index}-${item.title}`}>
                    <strong>{item.title}</strong>
                    <MathText text={item.content} />
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3>什么时候用</h3>
              <TextList items={content.when_to_use} />
            </section>
            <section>
              <h3>容易踩的坑</h3>
              <TextList items={content.common_mistakes} />
            </section>
            <section className="cardConnection">
              <h3>回到当前题</h3>
              <MathText text={content.connection_to_problem} />
            </section>
          </div>
        ) : (
          <div className="studyCardBody">
            <section className="cardLeadSection">
              <span>题目摘要</span>
              <MathText text={content.problem_summary} />
            </section>
            <section>
              <h3>上帝视角路线</h3>
              <MathText text={content.solution_overview} />
            </section>
            <section>
              <h3>完整解答流程</h3>
              <ol className="cardStepList problemStepList">
                {content.solution_steps.map((item) => (
                  <li key={`${item.step}-${item.title}`}>
                    <div className="problemStepTitle"><span>{item.step}</span><strong>{item.title}</strong></div>
                    <p className="stepReason"><MathText text={item.reasoning} /></p>
                    <div className="stepResult"><MathText text={item.result} /></div>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3>如何想到这些步骤</h3>
              <TextList items={content.how_to_think} />
            </section>
            <section>
              <h3>需要注意的坑</h3>
              <TextList items={content.pitfalls} />
            </section>
            <section className="cardFinalAnswer">
              <h3>最终答案</h3>
              <MathText text={content.final_answer} />
            </section>
          </div>
        )}
      </article>
    </div>
  );
}
