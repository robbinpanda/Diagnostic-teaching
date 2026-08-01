"use client";

import { ArrowUp, Loader2, Paperclip, Pencil, Plus, Square, X } from "lucide-react";
import type { RefObject } from "react";
import type { ModelProfile } from "../../lib/api";
import { ModelProfilePicker } from "./ModelProfilePicker";

type ClipboardItemLike = Pick<DataTransferItem, "kind" | "type" | "getAsFile">;

export function getPastedImageFiles(items: ArrayLike<ClipboardItemLike>): File[] {
  return Array.from(items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

type Props = {
  error: string | null;
  sessionId: string;
  pendingImageUrl: string | null;
  input: string;
  composerBlocked: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  imageBusy: boolean;
  gradeBand: "junior" | "senior";
  selectedProfileId: string;
  selectedProfile?: ModelProfile;
  profiles: ModelProfile[];
  deleteBusy: boolean;
  streamBusy: boolean;
  stopBusy: boolean;
  startBusy: boolean;
  onClearError: () => void;
  onRemoveImage: () => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onImageFile: (file?: File) => void;
  onPasteImages: (files: File[]) => void;
  onGradeBandChange: (value: "junior" | "senior") => void;
  onProfileChange: (profileId: string) => void;
  onAddProfile: () => void;
  onEditProfile: () => void;
  onDeleteProfiles: (profileIds: string[]) => Promise<boolean>;
  onStop: () => void;
};

export function TutorComposer({
  error,
  sessionId,
  pendingImageUrl,
  input,
  composerBlocked,
  imageInputRef,
  imageBusy,
  gradeBand,
  selectedProfileId,
  selectedProfile,
  profiles,
  deleteBusy,
  streamBusy,
  stopBusy,
  startBusy,
  onClearError,
  onRemoveImage,
  onInputChange,
  onSend,
  onImageFile,
  onPasteImages,
  onGradeBandChange,
  onProfileChange,
  onAddProfile,
  onEditProfile,
  onDeleteProfiles,
  onStop
}: Props) {
  return (
    <div className="composerDock">
      {error && <div className="inlineError"><span>{error}</span><button type="button" onClick={onClearError}><X size={15} /></button></div>}
      {!sessionId && pendingImageUrl && (
        <div className="attachmentContext">
          <img src={pendingImageUrl} alt="待发送的题目图片" />
          <div><strong>题目图片待发送</strong><span>点击发送后识别并确认题目范围</span></div>
          <button type="button" onClick={onRemoveImage} aria-label="移除图片"><X size={15} /></button>
        </div>
      )}
      <div className="composerCard">
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onPaste={(event) => {
            const imageFiles = getPastedImageFiles(event.clipboardData.items);
            if (!imageFiles.length) return;
            event.preventDefault();
            onPasteImages(imageFiles);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          disabled={composerBlocked || Boolean(pendingImageUrl)}
          placeholder={sessionId ? "继续说说你的想法…" : "输入一道或多道题目，或粘贴/上传题目图片…"}
          rows={3}
        />
        <div className="composerToolbar">
          <div className="composerActions">
            <input
              ref={imageInputRef}
              className="hiddenFileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => onImageFile(event.target.files?.[0])}
            />
            <button
              className="toolButton"
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={composerBlocked || Boolean(sessionId) || Boolean(pendingImageUrl)}
              title="上传题目图片"
            >
              {imageBusy ? <Loader2 size={17} className="spin" /> : <Paperclip size={17} />}
            </button>
            <select value={gradeBand} onChange={(event) => onGradeBandChange(event.target.value as typeof gradeBand)} disabled={Boolean(sessionId) || composerBlocked} aria-label="年级">
              <option value="junior">初中</option>
              <option value="senior">高中</option>
            </select>
            <ModelProfilePicker
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              disabled={Boolean(sessionId) || composerBlocked}
              canManage={!sessionId}
              deleteBusy={deleteBusy}
              onChange={onProfileChange}
              onAdd={onAddProfile}
              onDelete={onDeleteProfiles}
            />
            <button
              className="toolButton"
              type="button"
              onClick={onEditProfile}
              title={selectedProfile?.managed ? "查看模型配置" : selectedProfile ? "修改模型配置" : "添加模型配置"}
            >
              {selectedProfile ? <Pencil size={16} /> : <Plus size={16} />}
            </button>
          </div>
          <button
            className="sendButton"
            type="button"
            onClick={streamBusy && !input.trim() ? onStop : onSend}
            disabled={streamBusy && !input.trim()
              ? stopBusy
              : composerBlocked || (!input.trim() && !pendingImageUrl)}
            aria-label={streamBusy && !input.trim() ? "停止生成" : streamBusy ? "发送并打断讲解" : "发送"}
            title={streamBusy && !input.trim() ? "停止生成" : streamBusy ? "发送并打断讲解" : "发送"}
          >
            {streamBusy && !input.trim()
              ? (stopBusy ? <Loader2 size={18} className="spin" /> : <Square size={14} />)
              : startBusy
                ? <Loader2 size={18} className="spin" />
                : <ArrowUp size={19} />}
          </button>
        </div>
      </div>
      <p className="composerHint">Enter 发送 · 支持粘贴或上传图片 · 图片确认框选后按题目数创建答疑</p>
    </div>
  );
}
