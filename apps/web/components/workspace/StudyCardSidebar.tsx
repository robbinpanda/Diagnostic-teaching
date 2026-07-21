"use client";

import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  ClipboardPaste,
  Copy,
  FileDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoveRight,
  Pencil,
  Scissors,
  Trash2,
  X
} from "lucide-react";
import { useState } from "react";

import type { CardFolder, StudyCard } from "../../lib/api";
import {
  countCardsInFolderTree,
  folderBreadcrumbs
} from "../../lib/card-folders";
import type { CardClipboard } from "../../hooks/useStudyCards";
import { MathText } from "../MathText";

type Props = {
  cards: StudyCard[];
  folders: CardFolder[];
  currentFolderId: string | null;
  visibleFolders: CardFolder[];
  visibleCards: StudyCard[];
  clipboard: CardClipboard | null;
  cardBusyId: string;
  folderBusyId: string;
  pasteBusy: boolean;
  deleteAllCardsBusy: boolean;
  composerBlocked: boolean;
  onCollapse: () => void;
  onOpenFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string) => Promise<boolean>;
  onRenameFolder: (folder: CardFolder, name: string) => Promise<boolean>;
  onDeleteFolder: (folder: CardFolder) => void;
  onOpenCard: (card: StudyCard) => void;
  onCopyCard: (card: StudyCard) => void;
  onCutCard: (card: StudyCard) => void;
  onClearClipboard: () => void;
  onPasteCard: () => void;
  onMoveCard: (card: StudyCard) => void;
  onDeleteCard: (card: StudyCard) => void;
  onExport: () => void;
  onDeleteAllCards: () => void;
};

type FolderEditor = { mode: "create" } | { mode: "rename"; folder: CardFolder };

export function StudyCardSidebar({
  cards,
  folders,
  currentFolderId,
  visibleFolders,
  visibleCards,
  clipboard,
  cardBusyId,
  folderBusyId,
  pasteBusy,
  deleteAllCardsBusy,
  composerBlocked,
  onCollapse,
  onOpenFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenCard,
  onCopyCard,
  onCutCard,
  onClearClipboard,
  onPasteCard,
  onMoveCard,
  onDeleteCard,
  onExport,
  onDeleteAllCards
}: Props) {
  const [folderEditor, setFolderEditor] = useState<FolderEditor | null>(null);
  const [folderName, setFolderName] = useState("");
  const breadcrumbs = folderBreadcrumbs(folders, currentFolderId);
  const currentFolder = currentFolderId
    ? folders.find((folder) => folder.id === currentFolderId)
    : null;

  async function submitFolder() {
    const name = folderName.trim();
    if (!name || !folderEditor) return;
    const ok = folderEditor.mode === "create"
      ? await onCreateFolder(name)
      : await onRenameFolder(folderEditor.folder, name);
    if (ok) {
      setFolderEditor(null);
      setFolderName("");
    }
  }

  function startRename(folder: CardFolder) {
    setFolderEditor({ mode: "rename", folder });
    setFolderName(folder.name);
  }

  return (
    <aside className="cardSidebar">
      <div className="cardSidebarHeader">
        <div><strong>学习卡片</strong><span>{cards.length} 张已归档 · {folders.length} 个文件夹</span></div>
        <button className="plainIconButton" type="button" onClick={onCollapse} aria-label="收起卡片栏"><ChevronRight size={18} /></button>
      </div>

      <div className="cardFileToolbar">
        <button
          className="cardFolderBack"
          type="button"
          onClick={() => onOpenFolder(currentFolder?.parent_id ?? null)}
          disabled={!currentFolderId}
          aria-label="返回上一级"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="cardBreadcrumbs" aria-label="当前位置">
          <button type="button" onClick={() => onOpenFolder(null)}>卡片库</button>
          {breadcrumbs.map((folder) => (
            <span key={folder.id}>
              <ChevronRight size={11} />
              <button type="button" onClick={() => onOpenFolder(folder.id)}>{folder.name}</button>
            </span>
          ))}
        </div>
        <button
          className="cardFolderTool"
          type="button"
          onClick={() => { setFolderEditor({ mode: "create" }); setFolderName(""); }}
          aria-label={currentFolderId ? "新建子文件夹" : "新建主文件夹"}
          title={currentFolderId ? "新建子文件夹" : "新建主文件夹"}
        >
          <FolderPlus size={16} />
        </button>
        <button
          className="cardFolderTool"
          type="button"
          onClick={onPasteCard}
          disabled={!clipboard || !currentFolderId || pasteBusy}
          aria-label="粘贴卡片"
          title={currentFolderId ? "粘贴到当前文件夹" : "请先打开一个文件夹"}
        >
          {pasteBusy ? <Loader2 size={16} className="spin" /> : <ClipboardPaste size={16} />}
        </button>
      </div>

      {folderEditor && (
        <div className="folderInlineEditor">
          <Folder size={16} />
          <input
            autoFocus
            maxLength={80}
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitFolder();
              if (event.key === "Escape") setFolderEditor(null);
            }}
            placeholder={folderEditor.mode === "create" ? "文件夹名称" : "新的名称"}
          />
          <button type="button" onClick={() => void submitFolder()} disabled={!folderName.trim() || Boolean(folderBusyId)}>确定</button>
          <button type="button" onClick={() => setFolderEditor(null)} aria-label="取消"><X size={14} /></button>
        </div>
      )}

      {clipboard && (
        <div className="cardClipboardBanner">
          {clipboard.mode === "copy" ? <Copy size={13} /> : <Scissors size={13} />}
          <span>{clipboard.mode === "copy" ? "已复制" : "已剪切"}：{clipboard.card.content.title}</span>
          <button type="button" onClick={onClearClipboard} aria-label="清除剪贴板"><X size={13} /></button>
        </div>
      )}

      <div className="cardFileList">
        {visibleFolders.map((folder) => (
          <div className="cardFolderItem" key={folder.id}>
            <button className="cardFolderOpen" type="button" onClick={() => onOpenFolder(folder.id)}>
              <Folder size={19} />
              <span><strong>{folder.name}</strong><small>{countCardsInFolderTree(cards, folders, folder.id)} 张卡片</small></span>
              <ChevronRight size={14} />
            </button>
            {!folder.is_system && (
              <div className="cardFolderActions">
                <button type="button" onClick={() => startRename(folder)} disabled={Boolean(folderBusyId)} aria-label={`重命名文件夹：${folder.name}`} title="重命名"><Pencil size={13} /></button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`删除空文件夹“${folder.name}”？`)) onDeleteFolder(folder);
                  }}
                  disabled={Boolean(folderBusyId)}
                  aria-label={`删除文件夹：${folder.name}`}
                  title="删除空文件夹"
                >
                  {folderBusyId === folder.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            )}
          </div>
        ))}

        {visibleCards.map((card) => (
          <div className={`cardItem${clipboard?.mode === "cut" && clipboard.card.id === card.id ? " cut" : ""}`} key={card.id}>
            <button className="cardOpenButton" type="button" onClick={() => onOpenCard(card)}>
              <span className={`cardIcon ${card.card_type === "knowledge_card" ? "knowledge" : "problem"}`}>
                {card.card_type === "knowledge_card" ? <BookOpen size={16} /> : <ClipboardCheck size={16} />}
              </span>
              <span className="cardText"><strong><MathText text={card.content.title} /></strong><small>{card.card_type === "knowledge_card" ? "知识卡片" : "题目卡片"}</small></span>
            </button>
            <div className="cardItemActions">
              <button type="button" onClick={() => onCopyCard(card)} aria-label={`复制卡片：${card.content.title}`} title="复制"><Copy size={13} /></button>
              <button type="button" onClick={() => onCutCard(card)} aria-label={`剪切卡片：${card.content.title}`} title="剪切"><Scissors size={13} /></button>
              <button type="button" onClick={() => onMoveCard(card)} aria-label={`移动卡片：${card.content.title}`} title="移动到"><MoveRight size={13} /></button>
              <button type="button" onClick={() => onDeleteCard(card)} disabled={Boolean(cardBusyId)} aria-label={`删除卡片：${card.content.title}`} title="删除">
                {cardBusyId === card.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              </button>
            </div>
          </div>
        ))}

        {visibleFolders.length === 0 && visibleCards.length === 0 && (
          <div className="cardEmpty">
            {currentFolderId ? <FolderOpen size={23} /> : <Folder size={23} />}
            <span>{currentFolderId ? "这个文件夹还是空的" : "从一个文件夹开始整理卡片"}</span>
          </div>
        )}
      </div>

      <div className="cardSidebarActions">
        <button className="exportCardsButton" type="button" onClick={onExport} disabled={cards.length === 0}>
          <FileDown size={15} />
          导出卡片
        </button>
        <button className="clearCardsButton" type="button" onClick={onDeleteAllCards} disabled={deleteAllCardsBusy || composerBlocked || cards.length === 0}>
          {deleteAllCardsBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
          清空卡片
        </button>
      </div>
    </aside>
  );
}
