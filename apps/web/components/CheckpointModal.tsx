"use client";

import { CheckCircle2, HelpCircle, Loader2, MessageSquareText, XCircle } from "lucide-react";
import { useState } from "react";
import type { AnsweredCheckpoint, Checkpoint } from "../lib/api";
import { MathText } from "./MathText";

type Props = {
  checkpoint: Checkpoint | null;
  onSubmit?: (optionId: string) => void;
  onSubmitFreeText?: (text: string) => void;
  busy?: boolean;
  answer?: Pick<AnsweredCheckpoint, "selected_option_id" | "is_correct">;
};

const FREE_TEXT_OPTION_ID = "FREE_TEXT";

export function CheckpointModal({
  checkpoint,
  onSubmit,
  onSubmitFreeText,
  busy = false,
  answer
}: Props) {
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [freeText, setFreeText] = useState("");

  if (!checkpoint) return null;
  const answered = Boolean(answer);
  const visibleSelection = answer?.selected_option_id ?? selectedOptionId;
  const options = [
    ...checkpoint.options,
    checkpoint.unknown_option,
    { id: FREE_TEXT_OPTION_ID, text: "我想自己输入回答" }
  ];
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
              <span className="optionBadge">
                {option.id === "UNKNOWN"
                  ? "?"
                  : option.id === FREE_TEXT_OPTION_ID
                    ? <MessageSquareText size={14} />
                    : option.id}
              </span>
              <MathText className="optionText" text={option.text} />
              <span className="optionSelectionMark" aria-hidden="true">
                {selected && answered && !answer?.is_correct ? <XCircle size={18} /> : null}
                {selected && (!answered || answer?.is_correct) ? <CheckCircle2 size={18} /> : null}
              </span>
            </button>
          );
        })}
        {!answered && selectedOptionId === FREE_TEXT_OPTION_ID && (
          <textarea
            className="checkpointCustomInput"
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="写下你的想法、推导或想追问的地方…"
            disabled={busy}
            rows={2}
            autoFocus
          />
        )}
      </div>
      {!answered && (
        <div className="checkpointFooter">
          <p className="checkpointHint">
            <CheckCircle2 size={15} />
            共五种回复方式；也可以自行输入完整想法。
          </p>
          <button
            className="checkpointSubmitButton"
            type="button"
            onClick={() => {
              if (selectedOptionId === FREE_TEXT_OPTION_ID) {
                if (freeText.trim()) onSubmitFreeText?.(freeText.trim());
              } else if (selectedOptionId) {
                onSubmit?.(selectedOptionId);
              }
            }}
            disabled={
              !selectedOptionId
              || busy
              || (selectedOptionId === FREE_TEXT_OPTION_ID && !freeText.trim())
            }
          >
            {busy ? <Loader2 size={16} className="spin" /> : null}
            {busy ? "提交中" : "提交答案"}
          </button>
        </div>
      )}
    </section>
  );
}
