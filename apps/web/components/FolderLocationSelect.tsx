"use client";

import { FolderOpen, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";

import type { CardFolder } from "../lib/api";
import { flattenCardFolders } from "../lib/card-folders";
import { RoundedSelect } from "./RoundedSelect";

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
      <div className="folderLocationLabel"><FolderOpen size={15} aria-hidden="true" /><span>{label}</span></div>
      <div className="folderLocationControl">
        <RoundedSelect
          className="folderLocationPicker"
          label={label}
          value={value}
          onChange={onChange}
          disabled={disabled || options.length === 0}
          options={options.map((folder) => ({
            value: folder.id,
            label: folder.name,
            depth: folder.depth
          }))}
        />
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
