"use client";

import { Check, ChevronDown, Gauge, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelProfile, ReasoningEffort } from "../../lib/api";

type Props = {
  profile: ModelProfile;
  busy: boolean;
  disabled: boolean;
  onChange: (profileId: string, effort: ReasoningEffort) => Promise<boolean>;
};

const EFFORT_COPY: Record<ReasoningEffort, { label: string; description: string }> = {
  none: {
    label: "关闭",
    description: "请求供应商关闭推理；仅在该配置实测支持时显示"
  },
  low: {
    label: "低",
    description: "较少推理，兼顾回复速度与必要复核"
  },
  high: {
    label: "高",
    description: "充分推理并仔细检查，优先回答质量"
  }
};

export function ReasoningEffortPicker({
  profile,
  busy,
  disabled,
  onChange
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedCopy = EFFORT_COPY[profile.reasoning_effort];

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
    setOpen(false);
  }, [profile.id]);

  useEffect(() => {
    if (disabled || busy) setOpen(false);
  }, [busy, disabled]);

  function selectEffort(effort: ReasoningEffort) {
    setOpen(false);
    if (effort !== profile.reasoning_effort) {
      void onChange(profile.id, effort);
    }
  }

  return (
    <div
      className={`reasoningPicker${open ? " open" : ""}`}
      ref={rootRef}
      title={profile.reasoning_control_description}
    >
      <button
        className="modelPickerTrigger reasoningPickerTrigger"
        type="button"
        disabled={disabled || busy}
        aria-label={`推理强度：${selectedCopy.label}`}
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
        <span className="reasoningPickerCurrent">
          <span className="reasoningPickerIcon" aria-hidden="true">
            {busy ? <Loader2 size={13} className="spin" /> : <Gauge size={13} />}
          </span>
          <span className="reasoningPickerCurrentLabel">
            推理 · <strong>{selectedCopy.label}</strong>
          </span>
        </span>
        <ChevronDown className="modelPickerChevron" size={15} aria-hidden="true" />
      </button>

      <div className="modelPickerMenu reasoningPickerMenu" hidden={!open}>
        <div className="modelPickerMenuHeader">
          <div className="modelPickerHeaderCopy">
            <strong>选择推理强度</strong>
            <span>调整回复速度与思考深度</span>
          </div>
        </div>

        <div className="modelPickerOptions reasoningPickerOptions" role="listbox" aria-label="推理强度">
          {profile.reasoning_effort_options.map((effort) => {
            const selected = effort === profile.reasoning_effort;
            const copy = EFFORT_COPY[effort];
            return (
              <button
                className={`modelPickerOption reasoningPickerOption${selected ? " selected" : ""}`}
                key={effort}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectEffort(effort)}
              >
                <span className={`modelPickerOptionMark${selected ? " selected" : ""}`} aria-hidden="true">
                  {selected && <Check size={13} />}
                </span>
                <span className="modelPickerOptionBody">
                  <span className="reasoningPickerOptionHeading">
                    <span className="modelPickerOptionLabel">{copy.label}</span>
                    {effort === "low" && <span className="reasoningRecommendedBadge">默认</span>}
                  </span>
                  <span className="modelPickerOptionMeta">{copy.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="reasoningPickerNote">
          {profile.reasoning_control_description}
        </div>
      </div>
    </div>
  );
}
