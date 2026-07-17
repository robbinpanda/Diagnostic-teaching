"use client";

import { BookOpen, Check, FileDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StudyCard } from "../lib/api";
import { MathText } from "./MathText";

export type KnowledgeCardExportLayout = "single" | "double" | "triple";

type Props = {
  cards: StudyCard[];
  open: boolean;
  onClose: () => void;
  onExport: (cards: StudyCard[], layout: KnowledgeCardExportLayout) => void;
};

const LAYOUT_OPTIONS: Array<{
  id: KnowledgeCardExportLayout;
  columns: number;
  name: string;
  description: string;
}> = [
  {
    id: "single",
    columns: 1,
    name: "单列讲义",
    description: "A4 竖版，留白最多，适合细读"
  },
  {
    id: "double",
    columns: 2,
    name: "双列阅读",
    description: "A4 竖版，阅读与纸张利用率均衡"
  },
  {
    id: "triple",
    columns: 3,
    name: "三列速览",
    description: "A4 横版，保持列宽，适合集中复习"
  }
];

export function KnowledgeCardExportDialog({ cards, open, onClose, onExport }: Props) {
  const knowledgeCards = useMemo(
    () => cards.filter((card) => card.card_type === "knowledge_card"),
    [cards]
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<KnowledgeCardExportLayout>("double");

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(knowledgeCards.map((card) => card.id)));
    setLayout("double");
  }, [knowledgeCards, open]);

  if (!open) return null;

  const selectedCards = knowledgeCards.filter((card) => selectedIds.has(card.id));
  const allSelected = knowledgeCards.length > 0 && selectedCards.length === knowledgeCards.length;

  function toggleCard(cardId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  return (
    <div className="modalBackdrop exportDialogBackdrop" role="dialog" aria-modal="true" aria-labelledby="knowledge-export-title">
      <section className="knowledgeExportDialog">
        <header className="knowledgeExportHeader">
          <div>
            <span className="knowledgeExportKicker"><FileDown size={16} /> PDF 导出</span>
            <h2 id="knowledge-export-title">导出知识卡片</h2>
            <p>选择卡片和排版后，会打开系统打印面板；选择“另存为 PDF”即可。</p>
          </div>
          <button className="dialogIconButton" type="button" onClick={onClose} aria-label="关闭导出设置">
            <X size={22} />
          </button>
        </header>

        <div className="knowledgeExportBody">
          <section className="knowledgeExportSection">
            <div className="knowledgeExportSectionHeader">
              <div>
                <h3>1. 选择知识卡片</h3>
                <span>已选 {selectedCards.length} / {knowledgeCards.length} 张，按知识库当前顺序导出</span>
              </div>
              <button
                className="textButton"
                type="button"
                onClick={() => setSelectedIds(allSelected ? new Set() : new Set(knowledgeCards.map((card) => card.id)))}
                disabled={knowledgeCards.length === 0}
              >
                {allSelected ? "取消全选" : "全选"}
              </button>
            </div>

            {knowledgeCards.length === 0 ? (
              <p className="knowledgeExportEmpty">还没有已归档的知识卡片可供导出。</p>
            ) : (
              <div className="knowledgeExportCardList">
                {knowledgeCards.map((card) => {
                  const content = card.content;
                  if (content.type !== "knowledge_card") return null;
                  const selected = selectedIds.has(card.id);
                  return (
                    <label key={card.id} className={`knowledgeExportCardOption ${selected ? "selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleCard(card.id)}
                      />
                      <span className="knowledgeExportCheckbox" aria-hidden="true">
                        {selected && <Check size={14} strokeWidth={3} />}
                      </span>
                      <span className="knowledgeExportCardIcon"><BookOpen size={17} /></span>
                      <span className="knowledgeExportCardCopy">
                        <strong><MathText text={content.title} /></strong>
                        <small><MathText text={content.knowledge_point} /></small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          <section className="knowledgeExportSection">
            <div className="knowledgeExportSectionHeader">
              <div>
                <h3>2. 选择排版</h3>
                <span>卡片会从上到下填满一列，再自然流向右侧</span>
              </div>
            </div>
            <div className="knowledgeExportLayouts">
              {LAYOUT_OPTIONS.map((option) => (
                <label key={option.id} className={`knowledgeExportLayout ${layout === option.id ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="knowledge-export-layout"
                    value={option.id}
                    checked={layout === option.id}
                    onChange={() => setLayout(option.id)}
                  />
                  <span className="layoutPreview" aria-hidden="true">
                    {Array.from({ length: option.columns }, (_, index) => <i key={index} />)}
                  </span>
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </label>
              ))}
            </div>
          </section>
        </div>

        <footer className="knowledgeExportFooter">
          <span>特别长的卡片只会在内容分区之间续排，避免文字或公式被截断。</span>
          <div>
            <button className="secondaryButton" type="button" onClick={onClose}>取消</button>
            <button
              className="primaryButton"
              type="button"
              disabled={selectedCards.length === 0}
              onClick={() => onExport(selectedCards, layout)}
            >
              <FileDown size={16} />
              导出 {selectedCards.length || ""} 张卡片
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
