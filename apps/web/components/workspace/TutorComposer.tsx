"use client";

import { ArrowUp, Loader2, Mic, Paperclip, Pencil, Plus, Square, X } from "lucide-react";
import type { RefObject } from "react";
import type { SpeechInputPhase } from "../../hooks/useSpeechInput";
import type { ModelProfile, ReasoningEffort } from "../../lib/api";
import { GradeBandPicker } from "./GradeBandPicker";
import { ModelProfilePicker } from "./ModelProfilePicker";
import { ReasoningEffortPicker } from "./ReasoningEffortPicker";

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
  speechPhase: SpeechInputPhase;
  speechElapsedSeconds: number;
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
  onToggleSpeech: () => void;
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
  speechPhase,
  speechElapsedSeconds,
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
  onStop,
  onToggleSpeech
}: Props) {
  const speechBusy = speechPhase !== "idle";
  const speechTitle = speechPhase === "requesting"
    ? "正在启动本地实时语音服务"
    : speechPhase === "recording"
      ? `停止实时转写（${speechElapsedSeconds.toFixed(1)} 秒）`
      : speechPhase === "transcribing"
        ? "SenseVoiceSmall 正在确认最终文字"
        : "使用本地 SenseVoiceSmall 实时语音输入";
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
              if (!speechBusy) onSend();
            }
          }}
          disabled={composerBlocked || speechBusy}
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
              disabled={composerBlocked || speechBusy || Boolean(sessionId)}
              title="上传题目图片"
            >
              {imageBusy ? <Loader2 size={17} className="spin" /> : <Paperclip size={17} />}
            </button>
            <button
              className={`toolButton speechButton${speechPhase === "recording" ? " recording" : ""}`}
              type="button"
              onClick={onToggleSpeech}
              disabled={
                speechPhase === "requesting"
                || speechPhase === "transcribing"
                || (composerBlocked && speechPhase !== "recording")
              }
              aria-label={speechTitle}
              aria-pressed={speechPhase === "recording"}
              title={speechTitle}
            >
              {speechPhase === "requesting" || speechPhase === "transcribing"
                ? <Loader2 size={17} className="spin" />
                : speechPhase === "recording"
                  ? <Square size={13} />
                  : <Mic size={17} />}
            </button>
            <GradeBandPicker
              value={gradeBand}
              disabled={Boolean(sessionId) || composerBlocked || speechBusy}
              onChange={onGradeBandChange}
            />
            <ModelProfilePicker
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              disabled={Boolean(sessionId) || composerBlocked || speechBusy}
              canManage={!sessionId}
              deleteBusy={deleteBusy}
              onChange={onProfileChange}
              onAdd={onAddProfile}
              onDelete={onDeleteProfiles}
            />
            {selectedProfile && selectedProfile.reasoning_effort_options.length > 1 && (
              <ReasoningEffortPicker
                profile={selectedProfile}
                busy={reasoningBusy}
                disabled={streamBusy}
                onChange={onReasoningEffortChange}
              />
            )}
            <button
              className="toolButton"
              type="button"
              onClick={onEditProfile}
              disabled={speechBusy}
              title={selectedProfile?.managed ? "查看模型配置" : selectedProfile ? "修改模型配置" : "添加模型配置"}
            >
              {selectedProfile ? <Pencil size={16} /> : <Plus size={16} />}
            </button>
          </div>
          <button
            className="sendButton"
            type="button"
            onClick={streamBusy ? onStop : onSend}
            disabled={streamBusy ? stopBusy : composerBlocked || speechBusy || !input.trim()}
            aria-label={streamBusy ? "停止生成" : "发送"}
            title={streamBusy ? "停止生成" : "发送"}
          >
            {streamBusy ? (stopBusy ? <Loader2 size={18} className="spin" /> : <Square size={14} />) : startBusy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={19} />}
          </button>
        </div>
      </div>
      <p className={`composerHint${speechPhase === "recording" ? " recording" : ""}`}>
        {speechPhase === "requesting"
          ? "正在启动麦克风和本地 SenseVoiceSmall…"
          : speechPhase === "recording"
            ? `实时转写中 ${speechElapsedSeconds.toFixed(1)} 秒 · 不限时 · 思考停顿 2.5 秒后确认 · 再点一次停止`
            : speechPhase === "transcribing"
              ? "SenseVoiceSmall 正在确认最后一段语音…"
              : "Enter 发送 · 麦克风本地准实时转写 · 文字自动拆题 · 图片确认框选后按题目数创建答疑"}
      </p>
    </div>
  );
}
