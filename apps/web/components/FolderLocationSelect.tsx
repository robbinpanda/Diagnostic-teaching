"use client";

import { FolderOpen } from "lucide-react";

import type { CardFolder } from "../lib/api";
import { flattenCardFolders } from "../lib/card-folders";

type Props = {
  folders: CardFolder[];
  value: string;
  onChange: (folderId: string) => void;
  disabled?: boolean;
  label?: string;
};

export function FolderLocationSelect({
  folders,
  value,
  onChange,
  disabled = false,
  label = "保存位置"
}: Props) {
  const options = flattenCardFolders(folders);
  return (
    <label className="folderLocationSelect">
      <span><FolderOpen size={15} />{label}</span>
      <select
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
    </label>
  );
}
