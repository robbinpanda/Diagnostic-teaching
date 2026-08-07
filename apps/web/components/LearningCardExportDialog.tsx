"use client";

import { Columns2, FileDown, X } from "lucide-react";
import { useEffect } from "react";

import type { StudyCard } from "../lib/api";

type Props = {
  open: boolean;
  cards: StudyCard[];
  onClose: () => void;
  onExport: (cards: StudyCard[]) => void;
};

export function LearningCardExportDialog({ open, cards, onClose, onExport }: Props) {
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
            <p>已选中 {cards.length} 张知识卡片，内容将按答疑卡片的字段紧凑导出。</p>
          </div>
          <button aria-label="关闭导出窗口" className="dialogIconButton" onClick={onClose} type="button"><X size={20} /></button>
        </header>

        <div className="knowledgeExportBody">
          <section className="knowledgeExportSection exportFixedLayoutSummary">
            <Columns2 size={28} />
            <div><h3>固定 A4 纵向双列</h3><p>每张卡片保持完整字段，采用更小的间距与字号以减少页数。</p></div>
          </section>
        </div>

        <footer className="knowledgeExportFooter">
          <span>将导出 <strong>{cards.length}</strong> 张知识卡片</span>
          <div>
            <button className="secondaryButton" onClick={onClose} type="button">取消</button>
            <button className="primaryButton knowledgeExportSubmit" disabled={cards.length === 0} onClick={() => onExport(cards)} type="button">
              <FileDown size={18} />打开 PDF 打印
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
