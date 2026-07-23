"use client";

import {
  BookOpen,
  CheckSquare,
  ChevronRight,
  ClipboardCheck,
  FileDown,
  Folder,
  FolderOpen,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { CardFolder, StudyCard } from "../lib/api";
import {
  childFolders,
  countCardsInFolderTree,
  descendantFolderIds,
  folderBreadcrumbs
} from "../lib/card-folders";
import { MathText } from "./MathText";

export type LearningCardExportLayout = "single" | "double" | "triple";

type Props = {
  open: boolean;
  cards: StudyCard[];
  folders: CardFolder[];
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

function getCardTime(card: StudyCard) {
  const timestamp = Date.parse(card.saved_at || card.created_at);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function FolderTreeBranch({
  folders,
  cards,
  parentId,
  selectedFolderId,
  onOpen,
  depth = 0
}: {
  folders: CardFolder[];
  cards: StudyCard[];
  parentId: string | null;
  selectedFolderId: string | null;
  onOpen: (folderId: string) => void;
  depth?: number;
}) {
  return childFolders(folders, parentId).map((folder) => (
    <div className="exportFolderBranch" key={folder.id}>
      <button
        className={`exportFolderTreeItem${selectedFolderId === folder.id ? " active" : ""}`}
        type="button"
        onClick={() => onOpen(folder.id)}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        {selectedFolderId === folder.id ? <FolderOpen size={15} /> : <Folder size={15} />}
        <span>{folder.name}</span>
        <small>{countCardsInFolderTree(cards, folders, folder.id)}</small>
      </button>
      <FolderTreeBranch
        folders={folders}
        cards={cards}
        parentId={folder.id}
        selectedFolderId={selectedFolderId}
        onOpen={onOpen}
        depth={depth + 1}
      />
    </div>
  ));
}

export function LearningCardExportDialog({ open, cards, folders, onClose, onExport }: Props) {
  const learningCards = useMemo(
    () => cards
      .map((card, index) => ({ card, index }))
      .sort((left, right) => getCardTime(right.card) - getCardTime(left.card) || left.index - right.index)
      .map(({ card }) => card),
    [cards]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LearningCardExportLayout>("double");

  useEffect(() => {
    if (!open) return;
    setSelectedIds(learningCards.map((card) => card.id));
    setSelectedFolderId(null);
    setLayout("double");
  }, [learningCards, open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const cardsById = useMemo(
    () => new Map(learningCards.map((card) => [card.id, card])),
    [learningCards]
  );
  const selectedCards = useMemo(
    () => selectedIds.flatMap((id) => {
      const card = cardsById.get(id);
      return card ? [card] : [];
    }),
    [cardsById, selectedIds]
  );
  const visibleFolders = childFolders(folders, selectedFolderId);
  const visibleCards = selectedFolderId
    ? learningCards.filter((card) => card.folder_id === selectedFolderId)
    : [];
  const scopeCards = selectedFolderId
    ? learningCards.filter((card) => {
        const ids = descendantFolderIds(folders, selectedFolderId);
        return Boolean(card.folder_id && ids.has(card.folder_id));
      })
    : learningCards;
  const scopeFullySelected = scopeCards.length > 0 && scopeCards.every((card) => selectedIds.includes(card.id));
  const breadcrumbs = folderBreadcrumbs(folders, selectedFolderId);

  if (!open) return null;

  function toggleCard(cardId: string) {
    setSelectedIds((current) => current.includes(cardId)
      ? current.filter((id) => id !== cardId)
      : [...current, cardId]);
  }

  function toggleScope() {
    const scopeIds = new Set(scopeCards.map((card) => card.id));
    setSelectedIds((current) => scopeFullySelected
      ? current.filter((id) => !scopeIds.has(id))
      : [...current, ...scopeCards.map((card) => card.id).filter((id) => !current.includes(id))]);
  }

  return (
    <div className="modalBackdrop exportDialogBackdrop" role="presentation">
      <section aria-labelledby="learning-card-export-title" aria-modal="true" className="knowledgeExportDialog" role="dialog">
        <header className="knowledgeExportHeader">
          <div>
            <span className="knowledgeExportKicker"><FileDown size={14} />EXPORT WORKSPACE</span>
            <h2 id="learning-card-export-title">从卡片库导出</h2>
            <p>像浏览文件一样进入文件夹，选择要打印的学习卡片。</p>
          </div>
          <button aria-label="关闭导出窗口" className="dialogIconButton" onClick={onClose} type="button"><X size={20} /></button>
        </header>

        <div className="knowledgeExportBody">
          <section className="knowledgeExportSection exportFileSection">
            <div className="knowledgeExportSectionHeader">
              <div>
                <h3>1. 从文件夹中选择</h3>
                <span>{selectedIds.length > 0 ? `已选 ${selectedIds.length} / ${learningCards.length} 张，数字为 PDF 顺序` : "还没有选择卡片"}</span>
              </div>
              <button className="textButton" disabled={learningCards.length === 0} onClick={() => setSelectedIds([])} type="button">清除选择</button>
            </div>

            <div className="exportFileBrowser">
              <nav className="exportFolderTree" aria-label="导出文件夹">
                <button className={`exportFolderTreeItem root${selectedFolderId === null ? " active" : ""}`} type="button" onClick={() => setSelectedFolderId(null)}>
                  {selectedFolderId === null ? <FolderOpen size={15} /> : <Folder size={15} />}
                  <span>全部卡片</span><small>{learningCards.length}</small>
                </button>
                <FolderTreeBranch folders={folders} cards={learningCards} parentId={null} selectedFolderId={selectedFolderId} onOpen={setSelectedFolderId} />
              </nav>

              <div className="exportFolderContents">
                <div className="exportFolderPath">
                  <button type="button" onClick={() => setSelectedFolderId(null)}>全部卡片</button>
                  {breadcrumbs.map((folder) => (
                    <span key={folder.id}><ChevronRight size={11} /><button type="button" onClick={() => setSelectedFolderId(folder.id)}>{folder.name}</button></span>
                  ))}
                  <button className="exportSelectFolder" type="button" onClick={toggleScope} disabled={scopeCards.length === 0}>
                    <CheckSquare size={14} />{scopeFullySelected ? "取消此处全部" : "选择此处全部"}
                  </button>
                </div>

                <div className="knowledgeExportCardList">
                  {visibleFolders.map((folder) => (
                    <button className="exportFolderTile" key={folder.id} type="button" onClick={() => setSelectedFolderId(folder.id)}>
                      <Folder size={18} /><span>{folder.name}</span><small>{countCardsInFolderTree(learningCards, folders, folder.id)} 张</small>
                    </button>
                  ))}
                  {visibleCards.map((card) => {
                    const selectedIndex = selectedIds.indexOf(card.id);
                    const selected = selectedIndex >= 0;
                    const isKnowledgeCard = card.content.type === "knowledge_card";
                    const summary = card.content.type === "knowledge_card"
                      ? card.content.knowledge_point
                      : card.content.problem_summary;
                    return (
                      <label className={`knowledgeExportCardOption${selected ? " selected" : ""}`} key={card.id}>
                        <input checked={selected} onChange={() => toggleCard(card.id)} type="checkbox" />
                        <span className="knowledgeExportCheckbox" aria-hidden="true">{selected ? selectedIndex + 1 : ""}</span>
                        <span className={`knowledgeExportCardIcon ${isKnowledgeCard ? "knowledge" : "problem"}`}>
                          {isKnowledgeCard ? <BookOpen size={18} /> : <ClipboardCheck size={18} />}
                        </span>
                        <span className="knowledgeExportCardCopy">
                          <strong>{card.content.title}</strong>
                          <span className="knowledgeExportCardSummary"><em>{isKnowledgeCard ? "知识卡片" : "题目卡片"}</em><small><MathText text={summary} /></small></span>
                        </span>
                      </label>
                    );
                  })}
                  {visibleFolders.length === 0 && visibleCards.length === 0 && (
                    <div className="knowledgeExportEmpty">这个位置没有可导出的卡片。</div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="knowledgeExportSection">
            <div className="knowledgeExportSectionHeader"><div><h3>2. 选择 PDF 排版</h3><span>内容从上到下填充，再续到右侧或下一页。</span></div></div>
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
          <span>将导出 <strong>{selectedCards.length}</strong> 张学习卡片</span>
          <div>
            <button className="secondaryButton" onClick={onClose} type="button">取消</button>
            <button className="primaryButton knowledgeExportSubmit" disabled={selectedCards.length === 0} onClick={() => onExport(selectedCards, layout)} type="button">
              <FileDown size={18} />打开 PDF 打印
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
