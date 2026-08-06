"use client";

import { FolderInput, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CardFolder, StudyCard } from "../lib/api";
import { defaultFolderForCard } from "../lib/card-folders";
import { FolderLocationSelect } from "./FolderLocationSelect";

type Props = {
  card: StudyCard | null;
  folders: CardFolder[];
  busy?: boolean;
  onClose: () => void;
  onMove: (card: StudyCard, folderId: string) => void;
  onCreatePaperFolder?: (name: string) => Promise<string | null>;
};

export function CardMoveDialog({ card, folders, busy = false, onClose, onMove, onCreatePaperFolder }: Props) {
  const [folderId, setFolderId] = useState("");

  useEffect(() => {
    if (card) setFolderId(card.folder_id || defaultFolderForCard(folders, card));
  }, [card, folders]);

  if (!card) return null;

  return (
    <div className="modalBackdrop cardMoveBackdrop" role="presentation">
      <section className="cardMoveDialog" role="dialog" aria-modal="true" aria-labelledby="card-move-title">
        <header>
          <div>
            <span>移动学习卡片</span>
            <h2 id="card-move-title">{card.content.title}</h2>
          </div>
          <button className="dialogIconButton" type="button" onClick={onClose} disabled={busy} aria-label="关闭移动窗口">
            <X size={19} />
          </button>
        </header>
        <p>选择目标文件夹，卡片内容和来源记录不会改变。</p>
        <FolderLocationSelect
          folders={folders}
          cardType={card.card_type}
          value={folderId}
          onChange={setFolderId}
          disabled={busy}
          label="移动到"
          onCreatePaperFolder={onCreatePaperFolder}
        />
        <footer>
          <button className="secondaryButton" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="primaryButton" type="button" onClick={() => onMove(card, folderId)} disabled={busy || !folderId || folderId === card.folder_id}>
            {busy ? <Loader2 size={17} className="spin" /> : <FolderInput size={17} />}
            移动
          </button>
        </footer>
      </section>
    </div>
  );
}
