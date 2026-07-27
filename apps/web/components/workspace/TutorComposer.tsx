"use client";

import { ArrowUp, Loader2, Paperclip, Pencil, Plus, Square, X } from "lucide-react";
import type { RefObject } from "react";
import type { ModelProfile, ReasoningEffort } from "../../lib/api";
import { ModelProfilePicker } from "./ModelProfilePicker";

type Props = {
  error: string | null;
  sessionId: string;
  originalProblemImage: string | null;
  input: string;
  composerBlocked: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  imageBusy: boolean;
  gradeBand: "junior" | "senior";
  selectedProfileId: string;
  selectedProfile?: ModelProfile;
  profiles: ModelProfile[];
  deleteBusy: boolean;
  reasoningBusy: boolean;
  streamBusy: boolean;
  stopBusy: boolean;
  startBusy: boolean;
  onClearError: () => void;
  onRemoveImage: () => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onImageFile: (file?: File) => void;
  onGradeBandChange: (value: "junior" | "senior") => void;
  onProfileChange: (profileId: string) => void;
  onAddProfile: () => void;
  onEditProfile: () => void;
  onDeleteProfiles: (profileIds: string[]) => Promise<boolean>;
  onReasoningEffortChange: (profileId: string, effort: ReasoningEffort) => Promise<boolean>;
  onStop: () => void;
};

export function TutorComposer({
  error,
  sessionId,
  originalProblemImage,
  input,
  composerBlocked,
  imageInputRef,
  imageBusy,
  gradeBand,
  selectedProfileId,
  selectedProfile,
  profiles,
  deleteBusy,
  reasoningBusy,
  streamBusy,
  stopBusy,
  startBusy,
  onClearError,
  onRemoveImage,
  onInputChange,
  onSend,
  onImageFile,
  onGradeBandChange,
  onProfileChange,
  onAddProfile,
  onEditProfile,
  onDeleteProfiles,
  onReasoningEffortChange,
  onStop
}: Props) {
  return (
    <div className="composerDock">
      {error && <div className="inlineError"><span>{error}</span><button type="button" onClick={onClearError}><X size={15} /></button></div>}
      {!sessionId && originalProblemImage && (
        <div className="attachmentContext">
          <img src={originalProblemImage} alt="已读取的题目图片" />
          <div><strong>题目图片已读取</strong><span>原图会随每轮答疑发送给多模态模型</span></div>
          <button type="button" onClick={onRemoveImage} aria-label="移除图片"><X size={15} /></button>
        </div>
      )}
      <div className="composerCard">
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          disabled={composerBlocked}
          placeholder={sessionId ? "继续说说你的想法…" : "输入一道或多道题目，或上传题目图片…"}
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
              disabled={composerBlocked || Boolean(sessionId)}
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
            {selectedProfile && selectedProfile.reasoning_effort_options.length > 1 && (
              <label
                className="reasoningEffortControl"
                title={selectedProfile.reasoning_control_description}
              >
                <span>推理</span>
                <select
                  value={selectedProfile.reasoning_effort}
                  onChange={(event) => void onReasoningEffortChange(
                    selectedProfile.id,
                    event.target.value as ReasoningEffort
                  )}
                  disabled={streamBusy || reasoningBusy}
                  aria-label="推理强度"
                >
                  {selectedProfile.reasoning_effort_options.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort === "minimal"
                        ? "超低"
                        : effort === "low"
                          ? "低"
                          : effort === "medium"
                            ? "中"
                            : "高"}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            onClick={streamBusy ? onStop : onSend}
            disabled={streamBusy ? stopBusy : composerBlocked || !input.trim()}
            aria-label={streamBusy ? "停止生成" : "发送"}
            title={streamBusy ? "停止生成" : "发送"}
          >
            {streamBusy ? (stopBusy ? <Loader2 size={18} className="spin" /> : <Square size={14} />) : startBusy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={19} />}
          </button>
        </div>
      </div>
      <p className="composerHint">Enter 发送 · 文字自动拆题 · 图片确认框选后按题目数创建答疑</p>
    </div>
  );
}
