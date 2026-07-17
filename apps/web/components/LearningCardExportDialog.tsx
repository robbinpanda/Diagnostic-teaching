"use client";

import { BookOpen, ClipboardCheck, FileDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { StudyCard } from "../lib/api";

import { MathText } from "./MathText";

export type LearningCardExportLayout = "single" | "double" | "triple";

type LearningCardExportDialogProps = {
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
  {
    value: "single",
    label: "单列舒展",
    description: "适合长推导与批注",
    columns: 1,
  },
  {
    value: "double",
    label: "双列阅读",
    description: "兼顾密度与可读性",
    columns: 2,
  },
  {
    value: "triple",
    label: "三列速览",
    description: "适合提纲式复习",
    columns: 3,
  },
];

function getCardTime(card: StudyCard) {
  const timestamp = Date.parse(card.saved_at || card.created_at);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function LearningCardExportDialog({
  open,
  cards,
  onClose,
  onExport,
}: LearningCardExportDialogProps) {
  const learningCards = useMemo(
    () =>
      cards
        .map((card, index) => ({ card, index }))
        .sort(
          (left, right) =>
            getCardTime(right.card) - getCardTime(left.card) || left.index - right.index,
        )
        .map(({ card }) => card),
    [cards],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [layout, setLayout] = useState<LearningCardExportLayout>("double");

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedIds(learningCards.map((card) => card.id));
    setLayout("double");
  }, [learningCards, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const cardsById = useMemo(
    () => new Map(learningCards.map((card) => [card.id, card])),
    [learningCards],
  );
  const selectedCards = useMemo(
    () =>
      selectedIds.flatMap((id) => {
        const card = cardsById.get(id);
        return card ? [card] : [];
      }),
    [cardsById, selectedIds],
  );
  const allSelected =
    learningCards.length > 0 && selectedIds.length === learningCards.length;

  if (!open) {
    return null;
  }

  function toggleCard(cardId: string) {
    setSelectedIds((current) =>
      current.includes(cardId)
        ? current.filter((id) => id !== cardId)
        : [...current, cardId],
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : learningCards.map((card) => card.id));
  }

  return (
    <div className="modalBackdrop exportDialogBackdrop" role="presentation">
      <section
        aria-labelledby="learning-card-export-title"
        aria-modal="true"
        className="knowledgeExportDialog"
        role="dialog"
      >
        <header className="knowledgeExportHeader">
          <div>
            <span className="knowledgeExportKicker">
              <FileDown size={14} />
              PRINT STUDIO
            </span>
            <h2 id="learning-card-export-title">导出学习卡片</h2>
            <p>知识卡片和题目卡片可以混合选择，再按阅读场景决定 PDF 排版。</p>
          </div>
          <button
            aria-label="关闭导出窗口"
            className="dialogIconButton"
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </header>

        <div className="knowledgeExportBody">
          <section className="knowledgeExportSection">
            <div className="knowledgeExportSectionHeader">
              <div>
                <h3>1. 选择学习卡片</h3>
                <span>
                  {allSelected
                    ? `已按归档时间选择全部 ${selectedIds.length} 张（最新在前）`
                    : selectedIds.length > 0
                      ? `已选 ${selectedIds.length} / ${learningCards.length} 张，编号就是 PDF 顺序`
                      : "未选择卡片；点击后会按选择先后编号"}
                </span>
              </div>
              <button
                className="textButton"
                disabled={learningCards.length === 0}
                onClick={toggleAll}
                type="button"
              >
                {allSelected ? "取消全选" : "全选"}
              </button>
            </div>

            {learningCards.length === 0 ? (
              <div className="knowledgeExportEmpty">还没有可导出的学习卡片。</div>
            ) : (
              <div className="knowledgeExportCardList">
                {learningCards.map((card) => {
                  const selectedIndex = selectedIds.indexOf(card.id);
                  const selected = selectedIndex >= 0;
                  const isKnowledgeCard = card.content.type === "knowledge_card";
                  const summary = card.content.type === "knowledge_card"
                    ? card.content.knowledge_point
                    : card.content.problem_summary;

                  return (
                    <label
                      className={`knowledgeExportCardOption${selected ? " selected" : ""}`}
                      key={card.id}
                    >
                      <input
                        checked={selected}
                        onChange={() => toggleCard(card.id)}
                        type="checkbox"
                      />
                      <span className="knowledgeExportCheckbox" aria-hidden="true">
                        {selected ? selectedIndex + 1 : ""}
                      </span>
                      <span
                        className={`knowledgeExportCardIcon ${
                          isKnowledgeCard ? "knowledge" : "problem"
                        }`}
                      >
                        {isKnowledgeCard ? (
                          <BookOpen size={18} />
                        ) : (
                          <ClipboardCheck size={18} />
                        )}
                      </span>
                      <span className="knowledgeExportCardCopy">
                        <strong>{card.content.title}</strong>
                        <span className="knowledgeExportCardSummary">
                          <em>{isKnowledgeCard ? "知识卡片" : "题目卡片"}</em>
                          <small>
                            <MathText text={summary} />
                          </small>
                        </span>
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
                <h3>2. 选择 PDF 排版</h3>
                <span>内容先从上到下填满左列，再自动续到右侧或下一页。</span>
              </div>
            </div>
            <div className="knowledgeExportLayouts">
              {layoutOptions.map((option) => (
                <label
                  className={`knowledgeExportLayout${
                    layout === option.value ? " selected" : ""
                  }`}
                  key={option.value}
                >
                  <input
                    checked={layout === option.value}
                    name="knowledge-card-pdf-layout"
                    onChange={() => setLayout(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span
                    aria-hidden="true"
                    className="layoutPreview"
                    style={{ gridTemplateColumns: `repeat(${option.columns}, 1fr)` }}
                  >
                    {Array.from({ length: option.columns }, (_, index) => (
                      <i key={index} />
                    ))}
                  </span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </label>
              ))}
            </div>
            <p className="knowledgeExportHint">
              双列是默认选择；若题目解答或推导较长，单列通常更易阅读。打印窗口中还可以切换纸张尺寸、横竖方向和页边距。
            </p>
          </section>
        </div>

        <footer className="knowledgeExportFooter">
          <span>
            将导出 <strong>{selectedCards.length}</strong> 张学习卡片
          </span>
          <div>
            <button
              className="secondaryButton"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="primaryButton knowledgeExportSubmit"
              disabled={selectedCards.length === 0}
              onClick={() => onExport(selectedCards, layout)}
              type="button"
            >
              <FileDown size={18} />
              打开 PDF 打印
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
