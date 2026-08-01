"use client";

import { BookOpen, ChevronRight, Image as ImageIcon, Loader2 } from "lucide-react";
import type { ModelProfile } from "../../lib/api";
import { modelProfileLabel } from "../../lib/api";
import { MathText } from "../MathText";

type Props = {
  leftOpen: boolean;
  title: string;
  sessionId: string;
  gradeBand: "junior" | "senior";
  selectedProfile?: ModelProfile;
  streamBusy: boolean;
  problemImageUrl?: string | null;
  onExpandLeft: () => void;
  onToggleCards: () => void;
  onViewProblemImage: () => void;
};

export function ConversationHeader({
  leftOpen,
  title,
  sessionId,
  gradeBand,
  selectedProfile,
  streamBusy,
  problemImageUrl,
  onExpandLeft,
  onToggleCards,
  onViewProblemImage
}: Props) {
  const subtitle = sessionId
    ? `${gradeBand === "junior" ? "初中" : "高中"}数学 · ${selectedProfile ? modelProfileLabel(selectedProfile) : "原模型不可用"}`
    : "先发题目，再告诉我你想到哪一步";

  return (
    <header className="conversationHeader">
      {!leftOpen && (
        <button className="plainIconButton" type="button" onClick={onExpandLeft} aria-label="展开会话栏">
          <ChevronRight size={18} />
        </button>
      )}
      <div className="conversationTitle">
        <strong><MathText text={title || "新答疑"} className="titleMathText" /></strong>
        <span>{subtitle}</span>
      </div>
      {streamBusy && <span className="thinkingStatus"><Loader2 size={14} className="spin" /> 正在思考</span>}
      {problemImageUrl && (
        <button className="viewProblemButton" type="button" onClick={onViewProblemImage}>
          <ImageIcon size={16} />
          <span>查看题目</span>
        </button>
      )}
      <button className="plainIconButton cardPanelToggle" type="button" onClick={onToggleCards} aria-label="切换卡片栏">
        <BookOpen size={18} />
      </button>
    </header>
  );
}
