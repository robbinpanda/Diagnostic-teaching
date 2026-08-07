"use client";

import { FileDown, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { StudyCard } from "../lib/api";

export type LearningCardExportLayout = "single" | "double" | "triple";

type Props = {
  open: boolean;
  cards: StudyCard[];
  onClose: () => void;
  onExport: (cards: StudyCard[], layout: LearningCardExportLayout) => void;
};

const layoutOptions: Array<{
  value: LearningCardExportLayout;
  label: string;
  description: string;
  columns: number;
}> = [
  { value: "single", label: "单列舒展", description: "适合长推导与批注", columns: 1 },
  { value: "double", label: "双列阅读", description: "兼顾密度与可读性", columns: 2 },
  { value: "triple", label: "三列速览", description: "适合提纲式复习", columns: 3 }
];

export function LearningCardExportDialog({ open, cards, onClose, onExport }: Props) {
  const [layout, setLayout] = useState<LearningCardExportLayout>("double");

  useEffect(() => {
    if (open) setLayout("double");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="modalBackdrop exportDialogBackdrop" role="presentation">
      <section aria-labelledby="learning-card-export-title" aria-modal="true" className="knowledgeExportDialog knowledgeExportLayoutDialog" role="dialog">
        <header className="knowledgeExportHeader">
          <div>
            <span className="knowledgeExportKicker"><FileDown size={14} />EXPORT WORKSPACE</span>
            <h2 id="learning-card-export-title">从知识卡片库导出</h2>
            <p>已在知识卡片库选中 {cards.length} 张卡片，确认 PDF 排版后即可导出。</p>
          </div>
          <button aria-label="关闭导出窗口" className="dialogIconButton" onClick={onClose} type="button"><X size={20} /></button>
        </header>

        <div className="knowledgeExportBody">
          <section className="knowledgeExportSection">
            <div className="knowledgeExportSectionHeader"><div><h3>选择 PDF 排版</h3><span>内容从上到下填充，再续到右侧或下一页。</span></div></div>
            <div className="knowledgeExportLayouts">
              {layoutOptions.map((option) => (
                <label className={`knowledgeExportLayout${layout === option.value ? " selected" : ""}`} key={option.value}>
                  <input checked={layout === option.value} name="knowledge-card-pdf-layout" onChange={() => setLayout(option.value)} type="radio" value={option.value} />
                  <span aria-hidden="true" className="layoutPreview" style={{ gridTemplateColumns: `repeat(${option.columns}, 1fr)` }}>
                    {Array.from({ length: option.columns }, (_, index) => <i key={index} />)}
                  </span>
                  <strong>{option.label}</strong><small>{option.description}</small>
                </label>
              ))}
            </div>
            <p className="knowledgeExportHint">双列是默认选择；题目解答或推导较长时，单列通常更易阅读。</p>
          </section>
        </div>

        <footer className="knowledgeExportFooter">
          <span>将导出 <strong>{cards.length}</strong> 张知识卡片</span>
          <div>
            <button className="secondaryButton" onClick={onClose} type="button">取消</button>
            <button className="primaryButton knowledgeExportSubmit" disabled={cards.length === 0} onClick={() => onExport(cards, layout)} type="button">
              <FileDown size={18} />打开 PDF 打印
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
