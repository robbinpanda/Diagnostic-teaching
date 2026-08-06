"use client";

import { FolderOpen, Loader2, Plus, X } from "lucide-react";
import { useId, useState } from "react";

import type { CardFolder } from "../lib/api";
import { flattenCardFolders } from "../lib/card-folders";

type Props = {
  folders: CardFolder[];
  value: string;
  onChange: (folderId: string) => void;
  disabled?: boolean;
  label?: string;
  onCreatePaperFolder?: (name: string) => Promise<string | null>;
};

export function FolderLocationSelect({
  folders,
  value,
  onChange,
  disabled = false,
  label = "保存位置",
  onCreatePaperFolder
}: Props) {
  const options = flattenCardFolders(folders);
  const selectId = useId();
  const [creating, setCreating] = useState(false);
  const [paperName, setPaperName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  async function createPaperFolder() {
    const name = paperName.trim();
    if (!name || !onCreatePaperFolder || createBusy) return;
    setCreateBusy(true);
    try {
      const folderId = await onCreatePaperFolder(name);
      if (!folderId) return;
      onChange(folderId);
      setPaperName("");
      setCreating(false);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="folderLocationSelect">
      <label htmlFor={selectId}><FolderOpen size={15} />{label}</label>
      <div className="folderLocationControl">
        <select
          id={selectId}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || options.length === 0}
        >
          {options.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {`${"　".repeat(folder.depth)}${folder.depth ? "└ " : ""}${folder.name}`}
            </option>
          ))}
        </select>
        {onCreatePaperFolder ? (
          <button
            className="folderLocationCreateToggle"
            type="button"
            onClick={() => setCreating((value) => !value)}
            disabled={disabled || createBusy}
            aria-expanded={creating}
          >
            {creating ? <X size={15} /> : <Plus size={15} />}
            {creating ? "取消新建" : "新建试卷文件夹"}
          </button>
        ) : null}
      </div>
      {creating ? (
        <div className="folderLocationCreateRow">
          <input
            aria-label="新试卷文件夹名称"
            value={paperName}
            onChange={(event) => setPaperName(event.target.value)}
            maxLength={80}
            placeholder="输入试卷名称"
            disabled={disabled || createBusy}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void createPaperFolder();
            }}
          />
          <button className="secondaryButton" type="button" onClick={() => void createPaperFolder()} disabled={disabled || createBusy || !paperName.trim()}>
            {createBusy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}
            创建并选择
          </button>
        </div>
      ) : null}
    </div>
  );
}
