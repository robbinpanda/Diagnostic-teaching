import type { KnowledgeCardContent, ProblemCardContent } from "../lib/api";
import { MathText } from "./MathText";

type Props = {
  content: KnowledgeCardContent | ProblemCardContent;
  index: number;
  practiceMode?: boolean;
  incomplete?: boolean;
  label?: string;
};

function TextList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) return <p className="printEmptyLine">{emptyText}</p>;
  return (
    <ul>
      {items.map((item, index) => <li key={`${index}-${item}`}><MathText text={item} /></li>)}
    </ul>
  );
}

export function StudyCardPrintCard({ content, index, practiceMode = false, incomplete = false, label }: Props) {
  const isKnowledgeCard = content.type === "knowledge_card";

  return (
    <article className={`knowledgeCardPrintCard ${isKnowledgeCard ? "knowledgeCard" : "problemCard"}`}>
      <header>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div>
          <small>{label || (isKnowledgeCard ? "知识卡片" : "题目卡片")}</small>
          <h2 className={!isKnowledgeCard && practiceMode ? "practiceHiddenTitle" : undefined}>
            <MathText text={content.title} />
          </h2>
        </div>
      </header>

      {content.type === "knowledge_card" ? (
        <>
          <section className="printKnowledgeLead">
            <h3>关键关系</h3>
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
            <TextList emptyText="本卡未记录额外适用场景。" items={content.when_to_use} />
          </section>
          <section>
            <h3>容易踩的坑</h3>
            <TextList emptyText="本卡没有额外需要提醒的坑点。" items={content.common_mistakes} />
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
          {practiceMode ? (
            <section className="printPracticeArea" aria-label="解析内容已遮住">
              <strong>练习模式 · 解析已遮住</strong>
              {Array.from({ length: 6 }, (_, line) => <i key={line} />)}
            </section>
          ) : incomplete ? (
            <section className="printIncompleteLine">
              <p>本题尚未生成完整题目卡片，暂无可导出的解析内容。</p>
            </section>
          ) : (
            <>
              <section>
                <h3>解题思路</h3>
                <MathText text={content.solution_overview} />
              </section>
              <section>
                <h3>关键步骤</h3>
                <ol className="printSolutionStepList">
                  {content.solution_steps.map((step) => (
                    <li key={`${step.step}-${step.title}`}>
                      <strong>{step.step}. <MathText text={step.title} /></strong>
                      <MathText text={step.reasoning} />
                      <div className="printStepResult"><MathText text={step.result} /></div>
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h3>如何想到这些步骤</h3>
                <TextList emptyText="本卡未记录额外思考提示。" items={content.how_to_think} />
              </section>
              <section>
                <h3>易错提醒</h3>
                <TextList emptyText="本卡没有额外需要提醒的坑点。" items={content.pitfalls} />
              </section>
              <section className="printFinalAnswer">
                <h3>最终答案</h3>
                <MathText text={content.final_answer} />
              </section>
            </>
          )}
        </>
      )}
    </article>
  );
}
