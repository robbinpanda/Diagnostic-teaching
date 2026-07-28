"use client";

import { Check, ChevronDown, GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type GradeBand = "junior" | "senior";

type Props = {
  value: GradeBand;
  disabled: boolean;
  onChange: (value: GradeBand) => void;
};

const GRADE_COPY: Record<GradeBand, { label: string; description: string }> = {
  junior: {
    label: "初中",
    description: "侧重基础概念、直观解释与规范步骤"
  },
  senior: {
    label: "高中",
    description: "允许使用高中知识、综合方法与完整推导"
  }
};

export function GradeBandPicker({ value, disabled, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedCopy = GRADE_COPY[value];

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function selectGrade(nextValue: GradeBand) {
    setOpen(false);
    if (nextValue !== value) onChange(nextValue);
  }

  return (
    <div className={`gradeBandPicker${open ? " open" : ""}`} ref={rootRef}>
      <button
        className="modelPickerTrigger gradeBandPickerTrigger"
        type="button"
        disabled={disabled}
        aria-label={`学习阶段：${selectedCopy.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="gradeBandPickerCurrent">
          <span className="gradeBandPickerIcon" aria-hidden="true">
            <GraduationCap size={13} />
          </span>
          <strong>{selectedCopy.label}</strong>
        </span>
        <ChevronDown className="modelPickerChevron" size={15} aria-hidden="true" />
      </button>

      <div className="modelPickerMenu gradeBandPickerMenu" hidden={!open}>
        <div className="modelPickerMenuHeader">
          <div className="modelPickerHeaderCopy">
            <strong>选择学习阶段</strong>
            <span>帮助导师调整知识范围与讲解方式</span>
          </div>
        </div>

        <div className="modelPickerOptions gradeBandPickerOptions" role="listbox" aria-label="学习阶段">
          {(Object.keys(GRADE_COPY) as GradeBand[]).map((grade) => {
            const selected = grade === value;
            const copy = GRADE_COPY[grade];
            return (
              <button
                className={`modelPickerOption gradeBandPickerOption${selected ? " selected" : ""}`}
                key={grade}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectGrade(grade)}
              >
                <span className={`modelPickerOptionMark${selected ? " selected" : ""}`} aria-hidden="true">
                  {selected && <Check size={13} />}
                </span>
                <span className="modelPickerOptionBody">
                  <span className="modelPickerOptionLabel">{copy.label}</span>
                  <span className="modelPickerOptionMeta">{copy.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="reasoningPickerNote">
          学习阶段会固定到新建答疑；进入答疑后不能切换。
        </div>
      </div>
    </div>
  );
}
