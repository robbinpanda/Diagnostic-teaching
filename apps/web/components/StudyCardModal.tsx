"use client";

import { BookOpen, Check, ClipboardCheck, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CardFolder, StudyCard } from "../lib/api";
import { defaultFolderForCard, folderBreadcrumbs } from "../lib/card-folders";
import { FolderLocationSelect } from "./FolderLocationSelect";
import { MathText } from "./MathText";

type Props = {
  card: StudyCard | null;
  folders: CardFolder[];
  onClose: () => void;
  onSave?: (folderId: string) => void;
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

export function StudyCardModal({ card, folders, onClose, onSave, busy = false }: Props) {
  const [folderId, setFolderId] = useState("");

  useEffect(() => {
    if (card) setFolderId(card.folder_id || defaultFolderForCard(folders, card));
  }, [card, folders]);

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
            onClick={() => onSave ? onSave(folderId) : onClose()}
            disabled={busy}
            aria-label={onSave ? "保存并关闭卡片" : "关闭卡片"}
            title={onSave ? "保存并关闭" : "关闭卡片"}
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
                    <strong><MathText text={item.title} /></strong>
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
                    <div className="problemStepTitle"><span>{item.step}</span><strong><MathText text={item.title} /></strong></div>
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
        <footer className="studyCardFooter">
          {onSave ? (
            <>
              <FolderLocationSelect
                folders={folders}
                value={folderId}
                onChange={setFolderId}
                disabled={busy}
              />
              <button
                className="primaryButton studyCardSaveButton"
                type="button"
                onClick={() => onSave(folderId)}
                disabled={busy}
              >
                {busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                保存卡片
              </button>
            </>
          ) : (
            <>
              <span className="savedCardLocation">
                位于：{folderBreadcrumbs(folders, card.folder_id ?? null).map((folder) => folder.name).join(" / ") || "未分类"}
              </span>
              <button className="secondaryButton" type="button" onClick={onClose}>关闭</button>
            </>
          )}
        </footer>
      </article>
    </div>
  );
}
