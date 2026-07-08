"use client";

import { CheckCircle2, HelpCircle } from "lucide-react";
import type { Checkpoint } from "../lib/api";
import { MathText } from "./MathText";

type Props = {
  checkpoint: Checkpoint | null;
  onChoose: (optionId: string) => void;
};

export function CheckpointModal({ checkpoint, onChoose }: Props) {
  if (!checkpoint) return null;
  const options = [...checkpoint.options, checkpoint.unknown_option];
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="checkpointDialog">
        <div className="checkpointKicker">
          <HelpCircle size={18} />
          先确认一个小点
        </div>
        <h2>
          <MathText text={checkpoint.question} />
        </h2>
        <div className="optionList">
          {options.map((option) => (
            <button key={option.id} className="optionButton" type="button" onClick={() => onChoose(option.id)}>
              <span className="optionBadge">{option.id === "UNKNOWN" ? "?" : option.id}</span>
              <MathText className="optionText" text={option.text} />
            </button>
          ))}
        </div>
        <p className="checkpointHint">
          <CheckCircle2 size={15} />
          不知道也可以选，这会帮助 AI 判断该从哪里补。
        </p>
      </div>
    </div>
  );
}
