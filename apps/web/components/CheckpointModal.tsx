"use client";

import { CheckCircle2, HelpCircle, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import type { AnsweredCheckpoint, Checkpoint } from "../lib/api";
import { MathText } from "./MathText";

type Props = {
  checkpoint: Checkpoint | null;
  onSubmit?: (optionId: string) => void;
  busy?: boolean;
  answer?: Pick<AnsweredCheckpoint, "selected_option_id" | "is_correct">;
};

export function CheckpointModal({ checkpoint, onSubmit, busy = false, answer }: Props) {
  const [selectedOptionId, setSelectedOptionId] = useState("");

  if (!checkpoint) return null;
  const answered = Boolean(answer);
  const visibleSelection = answer?.selected_option_id ?? selectedOptionId;
  const options = [...checkpoint.options, checkpoint.unknown_option];
  const questionId = `checkpoint-question-${checkpoint.id}`;

  return (
    <section className="inlineInteraction checkpointDialog" role="group" aria-labelledby={questionId}>
      <div className="checkpointKicker">
        <HelpCircle size={18} />
        {answered ? "我的检查点作答" : "对话中的检查点"}
      </div>
      <h2 id={questionId}>
        <MathText text={checkpoint.question} />
      </h2>
      <div className="optionList">
        {options.map((option) => {
          const selected = visibleSelection === option.id;
          const resultClass = answered && selected
            ? (answer?.is_correct ? "correct" : "incorrect")
            : "";
          return (
            <button
              key={option.id}
              className={`optionButton ${selected ? "selected" : ""} ${resultClass}`.trim()}
              type="button"
              onClick={() => setSelectedOptionId(option.id)}
              disabled={busy || answered}
              aria-pressed={selected}
            >
              <span className="optionBadge">{option.id === "UNKNOWN" ? "?" : option.id}</span>
              <MathText className="optionText" text={option.text} />
              <span className="optionSelectionMark" aria-hidden="true">
                {selected && answered && !answer?.is_correct ? <XCircle size={18} /> : null}
                {selected && (!answered || answer?.is_correct) ? <CheckCircle2 size={18} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {!answered && (
        <div className="checkpointFooter">
          <p className="checkpointHint">
            <CheckCircle2 size={15} />
            先选择，再提交；不知道也可以选。
          </p>
          <button
            className="checkpointSubmitButton"
            type="button"
            onClick={() => selectedOptionId && onSubmit?.(selectedOptionId)}
            disabled={!selectedOptionId || busy}
          >
            {busy ? <Loader2 size={16} className="spin" /> : null}
            {busy ? "提交中" : "提交答案"}
          </button>
        </div>
      )}
    </section>
  );
}
